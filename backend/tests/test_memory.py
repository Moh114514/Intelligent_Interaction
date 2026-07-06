from __future__ import annotations
import sqlite3
import asyncio
from collections.abc import AsyncIterator, Sequence
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.app.core.config import Settings
from backend.app.api.memory_routes import sanitize_log_message
from backend.app.main import create_app
from backend.app.memory import DatabaseError, SQLiteStore
from backend.app.providers.base import ChatMessage, LLMProvider

TOKEN = "m" * 64

class BlockingProvider(LLMProvider):
    async def stream_chat(self, *, messages: Sequence[ChatMessage], system_prompt: str) -> AsyncIterator[str]:
        yield "部分"
        await asyncio.sleep(60)

class StaticProvider(LLMProvider):
    async def stream_chat(self, *, messages: Sequence[ChatMessage], system_prompt: str) -> AsyncIterator[str]:
        yield "完成"

def settings(tmp_path: Path) -> Settings:
    return Settings(host="127.0.0.1", port=8765, auth_token=TOKEN, log_dir=tmp_path / "logs", data_dir=tmp_path / "data")

def event(request_id: str, session_id: str = "session-1", character: str = "BLACK") -> dict:
    return {
        "type": "client.message", "version": "1.0", "session_id": session_id,
        "request_id": request_id, "timestamp": "2026-07-05T00:00:00+00:00",
        "data": {"content": "你好", "character_id": character}
    }

def test_diagnostic_log_sanitization() -> None:
    safe = sanitize_log_message(r"Bearer abc API_KEY=secret C:\Users\Alice\notes https://x.test?a=1")
    assert "abc" not in safe and "secret" not in safe and "Alice" not in safe and "a=1" not in safe

def test_database_initialization_crud_and_restart_recovery(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path)
    store.initialize()
    assert store.schema_version == 1
    session = store.create_session("s1")
    assert session["title"] == "新会话"
    store.begin_request("r1", "s1", "BLACK", "message")
    store.complete_request("r1", "第一条消息", "回复")
    assert [item["role"] for item in store.get_messages("s1")] == ["user", "assistant"]
    assert store.list_sessions()[0]["title"] == "第一条消息"

    store.begin_request("r2", "s1", "WHITE", "greeting")
    store.complete_request("r2", "隐藏提示", "可见问候")
    visible = store.get_messages("s1")
    assert "隐藏提示" not in [item["content"] for item in visible]
    assert "隐藏提示" in [item["content"] for item in store.load_context("s1", 20)]

    store.begin_request("r3", "s1", "SOLDIER", "message")
    SQLiteStore(tmp_path).initialize()
    assert store.get_request("r3")["status"] == "interrupted"

def test_database_rejects_newer_and_corrupt_schema(tmp_path: Path) -> None:
    tmp_path.mkdir(exist_ok=True)
    connection = sqlite3.connect(tmp_path / "agent.db")
    connection.execute("PRAGMA user_version=99")
    connection.close()
    with pytest.raises(DatabaseError, match="newer"):
        SQLiteStore(tmp_path).initialize()

    corrupt = tmp_path / "broken"
    corrupt.mkdir()
    (corrupt / "agent.db").write_bytes(b"not sqlite")
    with pytest.raises((DatabaseError, sqlite3.DatabaseError)):
        SQLiteStore(corrupt).initialize()

def test_websocket_disconnect_marks_request_interrupted(tmp_path: Path) -> None:
    app = create_app(settings(tmp_path), provider=BlockingProvider())
    headers = {"Authorization": "Bearer " + TOKEN}
    with TestClient(app) as client:
        with client.websocket_connect("/ws/v1", subprotocols=["agent.v1", TOKEN]) as socket:
            socket.send_json(event("disconnect-request"))
            assert socket.receive_json()["type"] == "agent.state"
            assert socket.receive_json()["type"] == "assistant.delta"
        status = client.get("/api/v1/requests/disconnect-request", headers=headers).json()
        assert status["status"] == "interrupted"
        assert status["error_code"] == "BACKEND_DISCONNECTED"

def test_session_config_archive_and_idempotent_request_api(tmp_path: Path) -> None:
    app = create_app(settings(tmp_path), provider=StaticProvider())
    headers = {"Authorization": "Bearer " + TOKEN}
    with TestClient(app) as client:
        created = client.post("/api/v1/sessions", headers=headers, json={}).json()
        session_id = created["id"]
        assert client.put("/api/v1/config", headers=headers, json={
            "active_session_id": session_id, "avatar_mode": "css", "css_character": "WHITE", "volume": 0.4
        }).status_code == 200
        assert client.get("/api/v1/config", headers=headers).json()["volume"] == 0.4

        with client.websocket_connect("/ws/v1", subprotocols=["agent.v1", TOKEN]) as socket:
            payload = event("same-request", session_id, "WHITE")
            socket.send_json(payload)
            received = [socket.receive_json() for _ in range(4)]
            assert received[-2]["type"] == "assistant.message"
            socket.send_json(payload)
            replay = [socket.receive_json() for _ in range(2)]
            assert [item["type"] for item in replay] == ["assistant.message", "agent.state"]

        status = client.get("/api/v1/requests/same-request", headers=headers).json()
        assert status["status"] == "completed"
        assert status["assistant_content"] == "完成"
        assert client.patch("/api/v1/sessions/" + session_id, headers=headers, json={"archived": True}).json()["archived"]
        assert client.get("/api/v1/sessions?archived=true", headers=headers).json()[0]["id"] == session_id
        assert client.patch("/api/v1/sessions/" + session_id, headers=headers, json={"archived": False}).json()["archived"] is False
