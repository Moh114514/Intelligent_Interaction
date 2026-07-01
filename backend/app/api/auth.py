from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, WebSocket, status

from backend.app.core.config import Settings


def require_http_token(settings: Settings):
    async def dependency(authorization: str | None = Header(default=None)) -> None:
        prefix = "Bearer "
        supplied = authorization[len(prefix) :] if authorization and authorization.startswith(prefix) else ""
        if not hmac.compare_digest(supplied, settings.auth_token):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    return dependency


def websocket_is_authorized(websocket: WebSocket, settings: Settings) -> bool:
    raw = websocket.headers.get("sec-websocket-protocol", "")
    protocols = [item.strip() for item in raw.split(",") if item.strip()]
    return "agent.v1" in protocols and any(
        hmac.compare_digest(item, settings.auth_token) for item in protocols
    )
