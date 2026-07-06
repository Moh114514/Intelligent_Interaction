from __future__ import annotations
import json
import re
from pathlib import Path
from typing import Any, Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from backend.app.api.auth import require_http_token
from backend.app.core.config import Settings
from backend.app.memory import SQLiteStore
from backend.app.agent.text import strip_role_prefix

DEFAULT_CONFIG = {
    "active_session_id": None,
    "avatar_mode": "three",
    "css_character": "BLACK",
    "volume": 0.7,
}

class SessionCreate(BaseModel):
    id: str | None = Field(default=None, min_length=1, max_length=128)

class SessionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=80)
    archived: bool | None = None

class ConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    active_session_id: str | None = Field(default=None, max_length=128)
    avatar_mode: Literal["three", "css"] | None = None
    css_character: Literal["BLACK", "WHITE"] | None = None
    volume: float | None = Field(default=None, ge=0, le=1)

def public_session(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"], "title": row["title"], "summary": row["summary"],
        "archived": row["archived_at"] is not None, "archived_at": row["archived_at"],
        "created_at": row["created_at"], "updated_at": row["updated_at"],
    }

def sanitize_log_message(value: Any) -> str:
    text = str(value)
    text = re.sub(r"(?i)(bearer|api[_ -]?key|access[_ -]?token|secret)\s*[:=]?\s*[^\s,;]+", r"\1=<redacted>", text)
    text = re.sub(r"(?i)[A-Z]:\\Users\\[^\\\s]+", r"<user-profile>", text)
    text = re.sub(r"([?&])[^\s]+", r"\1<redacted>", text)
    return text[:500]

def read_safe_logs(log_dir: Path, request_id: str | None, limit: int) -> list[dict[str, Any]]:
    path = log_dir / "backend.log"
    if not path.is_file():
        return []
    result: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        for line in reversed(lines):
            try:
                item = json.loads(line)
            except (ValueError, TypeError):
                continue
            if request_id and item.get("request_id") != request_id:
                continue
            safe = {key: item[key] for key in ("timestamp", "level", "logger", "request_id") if key in item}
            safe["message"] = sanitize_log_message(item.get("message", ""))
            result.append(safe)
            if len(result) >= limit:
                break
    except OSError:
        return []
    return result

def create_memory_router(settings: Settings, store: SQLiteStore) -> APIRouter:
    router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_http_token(settings))])

    @router.post("/sessions")
    async def create_session(payload: SessionCreate) -> dict[str, Any]:
        return public_session(store.create_session(payload.id))

    @router.get("/sessions")
    async def list_sessions(archived: bool = False) -> list[dict[str, Any]]:
        return [public_session(row) for row in store.list_sessions(archived)]

    @router.patch("/sessions/{session_id}")
    async def update_session(session_id: str, payload: SessionUpdate) -> dict[str, Any]:
        row = store.update_session(session_id, title=payload.title, archived=payload.archived)
        if not row:
            raise HTTPException(404, "Session not found")
        return public_session(row)

    @router.get("/sessions/{session_id}/messages")
    async def messages(session_id: str) -> list[dict[str, Any]]:
        if not store.get_session(session_id):
            raise HTTPException(404, "Session not found")
        rows = store.get_messages(session_id)
        for row in rows:
            if row["role"] == "assistant":
                row["content"] = strip_role_prefix(row["content"])
        return rows

    @router.get("/config")
    async def get_config() -> dict[str, Any]:
        return {**DEFAULT_CONFIG, **store.get_settings()}

    @router.put("/config")
    async def put_config(payload: ConfigUpdate) -> dict[str, Any]:
        values = payload.model_dump(exclude_none=True)
        if payload.active_session_id is not None and not store.get_session(payload.active_session_id):
            raise HTTPException(422, "Unknown active session")
        return {**DEFAULT_CONFIG, **store.update_settings(values)}

    @router.get("/requests/{request_id}")
    async def request_status(request_id: str) -> dict[str, Any]:
        row = store.get_request(request_id)
        if not row:
            raise HTTPException(404, "Request not found")
        return {
            "request_id": row["id"], "session_id": row["session_id"], "character_id": row["character_id"],
            "status": row["status"], "error_code": row["error_code"], "assistant_content": row["assistant_content"],
            "created_at": row["created_at"], "updated_at": row["updated_at"],
        }

    @router.get("/diagnostics/logs")
    async def diagnostics_logs(
        request_id: str | None = None,
        limit: int = Query(default=50, ge=1, le=200),
    ) -> dict[str, Any]:
        return {
            "schema_version": store.schema_version,
            "logs": read_safe_logs(settings.log_dir, request_id, limit),
            "tool_audits": store.list_audits(request_id, limit),
        }

    return router
