from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.app import __version__
from backend.app.agent.runtime import AgentRuntime
from backend.app.api.auth import require_http_token, websocket_is_authorized
from backend.app.core.config import Settings
from backend.app.providers import ProviderError


class EventEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str
    version: str = Field(pattern=r"^1\.0$")
    session_id: str = Field(min_length=1)
    request_id: str = Field(min_length=1)
    timestamp: str
    data: dict[str, Any]


class ClientMessageData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1)
    character_id: str = Field(pattern=r"^(BLACK|WHITE)$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def event_payload(
    event_type: str,
    *,
    session_id: str,
    request_id: str,
    data: dict[str, Any],
) -> dict[str, Any]:
    return {
        "type": event_type,
        "version": "1.0",
        "session_id": session_id,
        "request_id": request_id,
        "timestamp": utc_now(),
        "data": data,
    }


def error_payload(
    *,
    session_id: str,
    request_id: str,
    error_code: str,
    message: str,
    recoverable: bool,
) -> dict[str, Any]:
    return event_payload(
        "error",
        session_id=session_id,
        request_id=request_id,
        data={
            "error_code": error_code,
            "message": message,
            "recoverable": recoverable,
            "request_id": request_id,
        },
    )


def create_router(settings: Settings, agent_runtime: AgentRuntime) -> APIRouter:
    router = APIRouter()
    protected = [Depends(require_http_token(settings))]

    @router.get("/health", dependencies=protected)
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @router.get("/version", dependencies=protected)
    async def version() -> dict[str, str]:
        return {"version": __version__, "protocol_version": "1.0"}

    @router.websocket("/ws/v1")
    async def websocket_agent(websocket: WebSocket) -> None:
        if not websocket_is_authorized(websocket, settings):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await websocket.accept(subprotocol="agent.v1")
        send_lock = asyncio.Lock()
        active_requests: dict[str, asyncio.Task[None]] = {}

        async def send(payload: dict[str, Any]) -> bool:
            try:
                async with send_lock:
                    await websocket.send_json(payload)
                return True
            except (RuntimeError, WebSocketDisconnect):
                return False

        async def send_error(
            incoming: EventEnvelope,
            error_code: str,
            message: str,
            recoverable: bool,
        ) -> None:
            await send(
                error_payload(
                    session_id=incoming.session_id,
                    request_id=incoming.request_id,
                    error_code=error_code,
                    message=message,
                    recoverable=recoverable,
                )
            )

        async def run_agent(incoming: EventEnvelope, message: ClientMessageData) -> None:
            try:
                await send(
                    event_payload(
                        "agent.state",
                        session_id=incoming.session_id,
                        request_id=incoming.request_id,
                        data={"state": "thinking"},
                    )
                )
                chunks: list[str] = []
                async for delta in agent_runtime.stream_response(
                    session_id=incoming.session_id,
                    character_id=message.character_id,
                    content=message.content,
                ):
                    chunks.append(delta)
                    if not await send(
                        event_payload(
                            "assistant.delta",
                            session_id=incoming.session_id,
                            request_id=incoming.request_id,
                            data={"delta": delta},
                        )
                    ):
                        return
                await send(
                    event_payload(
                        "assistant.message",
                        session_id=incoming.session_id,
                        request_id=incoming.request_id,
                        data={"content": "".join(chunks).strip()},
                    )
                )
            except asyncio.CancelledError:
                await send(
                    event_payload(
                        "request.cancelled",
                        session_id=incoming.session_id,
                        request_id=incoming.request_id,
                        data={},
                    )
                )
            except ProviderError as error:
                await send_error(incoming, error.error_code, error.message, error.recoverable)
            except Exception:
                await send_error(
                    incoming,
                    "PROVIDER_UNAVAILABLE",
                    "The agent could not complete the request",
                    True,
                )
            finally:
                await send(
                    event_payload(
                        "agent.state",
                        session_id=incoming.session_id,
                        request_id=incoming.request_id,
                        data={"state": "idle"},
                    )
                )

        try:
            while True:
                payload: Any = None
                try:
                    payload = await websocket.receive_json()
                    incoming = EventEnvelope.model_validate(payload)
                except (json.JSONDecodeError, ValidationError, TypeError, ValueError):
                    session_id = payload.get("session_id", "unknown") if isinstance(payload, dict) else "unknown"
                    request_id = payload.get("request_id", "unknown") if isinstance(payload, dict) else "unknown"
                    await send(
                        error_payload(
                            session_id=session_id or "unknown",
                            request_id=request_id or "unknown",
                            error_code="INVALID_EVENT",
                            message="Invalid event envelope",
                            recoverable=True,
                        )
                    )
                    continue

                if incoming.type == "diagnostics.echo.request":
                    await send(
                        event_payload(
                            "diagnostics.echo.response",
                            session_id=incoming.session_id,
                            request_id=incoming.request_id,
                            data={"echo": incoming.data},
                        )
                    )
                    continue

                if incoming.type == "request.cancel":
                    task = active_requests.get(incoming.request_id)
                    if task and not task.done():
                        task.cancel()
                    else:
                        await send_error(incoming, "REQUEST_NOT_ACTIVE", "No active request matches request_id", True)
                    continue

                if incoming.type != "client.message":
                    await send_error(incoming, "UNSUPPORTED_EVENT", f"Unsupported event: {incoming.type}", True)
                    continue

                if any(not task.done() for task in active_requests.values()):
                    await send_error(incoming, "REQUEST_BUSY", "The session already has an active request", True)
                    continue

                try:
                    message = ClientMessageData.model_validate(incoming.data)
                except ValidationError:
                    await send_error(incoming, "INVALID_EVENT", "Invalid client.message data", True)
                    continue

                task = asyncio.create_task(run_agent(incoming, message))
                active_requests[incoming.request_id] = task
                task.add_done_callback(
                    lambda _completed, request_id=incoming.request_id: active_requests.pop(request_id, None)
                )
        except WebSocketDisconnect:
            pass
        finally:
            tasks = list(active_requests.values())
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

    return router
