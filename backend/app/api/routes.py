from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.app import __version__
from backend.app.api.auth import require_http_token, websocket_is_authorized
from backend.app.core.config import Settings


class EventEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str
    version: str = Field(pattern=r"^1\.0$")
    session_id: str = Field(min_length=1)
    request_id: str = Field(min_length=1)
    timestamp: str
    data: dict[str, Any]


def create_router(settings: Settings) -> APIRouter:
    router = APIRouter()
    protected = [Depends(require_http_token(settings))]

    @router.get("/health", dependencies=protected)
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @router.get("/version", dependencies=protected)
    async def version() -> dict[str, str]:
        return {"version": __version__, "protocol_version": "1.0"}

    @router.websocket("/ws/v1")
    async def websocket_echo(websocket: WebSocket) -> None:
        if not websocket_is_authorized(websocket, settings):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await websocket.accept(subprotocol="agent.v1")
        try:
            while True:
                payload: Any = None
                try:
                    payload = await websocket.receive_json()
                    incoming = EventEnvelope.model_validate(payload)
                except (json.JSONDecodeError, ValidationError, TypeError, ValueError):
                    session_id = payload.get("session_id", "unknown") if isinstance(payload, dict) else "unknown"
                    request_id = payload.get("request_id", "unknown") if isinstance(payload, dict) else "unknown"
                    await websocket.send_json(
                        {
                            "type": "error",
                            "version": "1.0",
                            "session_id": session_id or "unknown",
                            "request_id": request_id or "unknown",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "data": {
                                "error_code": "INVALID_EVENT",
                                "message": "Invalid event envelope",
                                "recoverable": True,
                                "request_id": request_id or "unknown",
                            },
                        }
                    )
                    continue
                if incoming.type == "diagnostics.echo.request":
                    outgoing = incoming.model_copy(
                        update={
                            "type": "diagnostics.echo.response",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "data": {"echo": incoming.data},
                        }
                    )
                    await websocket.send_json(outgoing.model_dump())
                else:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "version": "1.0",
                            "session_id": incoming.session_id,
                            "request_id": incoming.request_id,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "data": {
                                "error_code": "UNSUPPORTED_EVENT",
                                "message": f"Unsupported event: {incoming.type}",
                                "recoverable": True,
                                "request_id": incoming.request_id,
                            },
                        }
                    )
        except WebSocketDisconnect:
            return

    return router
