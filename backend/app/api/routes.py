from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.app import __version__
from backend.app.agent.runtime import AgentRuntime, ConfirmationDecision
from backend.app.api.auth import require_http_token, websocket_is_authorized
from backend.app.core.config import Settings
from backend.app.providers import ProviderError
from backend.app.tools.models import ToolCall


class EventEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str
    version: str = Field(pattern=r"^1.0$")
    session_id: str = Field(min_length=1)
    request_id: str = Field(min_length=1)
    timestamp: str
    data: dict[str, Any]


class ClientMessageData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1)
    character_id: str = Field(pattern=r"^(BLACK|WHITE)$")


class ToolConfirmationResponseData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirmation_id: str = Field(min_length=1)
    approved: bool


@dataclass
class PendingConfirmation:
    confirmation_id: str
    future: asyncio.Future[bool]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def event_payload(event_type: str, *, session_id: str, request_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": event_type,
        "version": "1.0",
        "session_id": session_id,
        "request_id": request_id,
        "timestamp": utc_now(),
        "data": data,
    }


def error_payload(*, session_id: str, request_id: str, error_code: str, message: str, recoverable: bool) -> dict[str, Any]:
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
        pending_confirmations: dict[str, PendingConfirmation] = {}

        async def send(payload: dict[str, Any]) -> bool:
            try:
                async with send_lock:
                    await websocket.send_json(payload)
                return True
            except (RuntimeError, WebSocketDisconnect):
                return False

        async def send_event(incoming: EventEnvelope, event_type: str, data: dict[str, Any]) -> bool:
            return await send(event_payload(event_type, session_id=incoming.session_id, request_id=incoming.request_id, data=data))

        async def send_error(incoming: EventEnvelope, error_code: str, message: str, recoverable: bool) -> None:
            await send(error_payload(session_id=incoming.session_id, request_id=incoming.request_id, error_code=error_code, message=message, recoverable=recoverable))

        async def run_agent(incoming: EventEnvelope, message: ClientMessageData) -> None:
            async def confirm_tool(call: ToolCall, summary: str) -> ConfirmationDecision:
                confirmation_id = str(uuid4())
                future: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
                pending_confirmations[incoming.request_id] = PendingConfirmation(confirmation_id, future)
                expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.tool_confirmation_timeout_seconds)
                await send_event(incoming, "agent.state", {"state": "confirming"})
                await send_event(
                    incoming,
                    "tool.confirmation_required",
                    {
                        "confirmation_id": confirmation_id,
                        "tool_call_id": call.id,
                        "tool_name": call.name,
                        "risk_level": "L2",
                        "summary": summary,
                        "expires_at": expires_at.isoformat(),
                    },
                )
                try:
                    approved = await asyncio.wait_for(future, timeout=settings.tool_confirmation_timeout_seconds)
                except (asyncio.TimeoutError, TimeoutError):
                    return "timed_out"
                finally:
                    pending_confirmations.pop(incoming.request_id, None)
                if approved:
                    await send_event(incoming, "agent.state", {"state": "acting"})
                    return "approved"
                return "denied"

            try:
                await send_event(incoming, "agent.state", {"state": "thinking"})
                chunks: list[str] = []
                async for output in agent_runtime.stream_response(
                    session_id=incoming.session_id,
                    request_id=incoming.request_id,
                    character_id=message.character_id,
                    content=message.content,
                    confirm_tool=confirm_tool,
                ):
                    if output.kind == "delta":
                        delta = str(output.data["delta"])
                        chunks.append(delta)
                        if not await send_event(incoming, "assistant.delta", {"delta": delta}):
                            return
                    elif output.kind == "state":
                        await send_event(incoming, "agent.state", output.data)
                    elif output.kind == "tool_result":
                        await send_event(incoming, "tool.result", output.data)
                await send_event(incoming, "assistant.message", {"content": "".join(chunks).strip()})
            except asyncio.CancelledError:
                pending = pending_confirmations.pop(incoming.request_id, None)
                if pending and not pending.future.done():
                    pending.future.cancel()
                await send_event(incoming, "request.cancelled", {})
            except ProviderError as error:
                await send_error(incoming, error.error_code, error.message, error.recoverable)
            except Exception:
                await send_error(incoming, "AGENT_UNAVAILABLE", "The agent could not complete the request", True)
            finally:
                await send_event(incoming, "agent.state", {"state": "idle"})

        try:
            while True:
                payload: Any = None
                try:
                    payload = await websocket.receive_json()
                    incoming = EventEnvelope.model_validate(payload)
                except (json.JSONDecodeError, ValidationError, TypeError, ValueError):
                    session_id = payload.get("session_id", "unknown") if isinstance(payload, dict) else "unknown"
                    request_id = payload.get("request_id", "unknown") if isinstance(payload, dict) else "unknown"
                    await send(error_payload(session_id=session_id or "unknown", request_id=request_id or "unknown", error_code="INVALID_EVENT", message="Invalid event envelope", recoverable=True))
                    continue

                if incoming.type == "diagnostics.echo.request":
                    await send_event(incoming, "diagnostics.echo.response", {"echo": incoming.data})
                    continue

                if incoming.type == "request.cancel":
                    task = active_requests.get(incoming.request_id)
                    if task and not task.done():
                        task.cancel()
                    else:
                        await send_error(incoming, "REQUEST_NOT_ACTIVE", "No active request matches request_id", True)
                    continue

                if incoming.type == "tool.confirmation_response":
                    pending = pending_confirmations.get(incoming.request_id)
                    try:
                        response = ToolConfirmationResponseData.model_validate(incoming.data)
                    except ValidationError:
                        await send_error(incoming, "INVALID_CONFIRMATION", "Invalid confirmation response", True)
                        continue
                    if pending is None or pending.confirmation_id != response.confirmation_id or pending.future.done():
                        await send_error(incoming, "INVALID_CONFIRMATION", "Confirmation is missing, expired, or mismatched", True)
                        continue
                    pending.future.set_result(response.approved)
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
                task.add_done_callback(lambda _completed, request_id=incoming.request_id: active_requests.pop(request_id, None))
        except WebSocketDisconnect:
            pass
        finally:
            tasks = list(active_requests.values())
            for task in tasks:
                task.cancel()
            for pending in pending_confirmations.values():
                if not pending.future.done():
                    pending.future.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

    return router
