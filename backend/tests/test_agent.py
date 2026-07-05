from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.providers.base import ChatMessage, LLMProvider


class RecordingProvider(LLMProvider):
    def __init__(self) -> None:
        self.calls: list[tuple[list[ChatMessage], str]] = []

    async def stream_chat(
        self,
        *,
        messages: Sequence[ChatMessage],
        system_prompt: str,
    ) -> AsyncIterator[str]:
        self.calls.append(([message.copy() for message in messages], system_prompt))
        yield "Hello"
        yield " there"


class SlowProvider(LLMProvider):
    async def stream_chat(
        self,
        *,
        messages: Sequence[ChatMessage],
        system_prompt: str,
    ) -> AsyncIterator[str]:
        yield "partial"
        await asyncio.sleep(60)


def settings(tmp_path: Path) -> Settings:
    return Settings(
        host="127.0.0.1",
        port=8765,
        auth_token="a" * 64,
        log_dir=tmp_path,
    )


def event(event_type: str, request_id: str, *, session_id: str = "session-1", data: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": event_type,
        "version": "1.0",
        "session_id": session_id,
        "request_id": request_id,
        "timestamp": "2026-07-02T00:00:00+00:00",
        "data": data,
    }


def connect(client: TestClient):
    return client.websocket_connect("/ws/v1", subprotocols=["agent.v1", "a" * 64])


def receive_turn(websocket) -> list[dict[str, Any]]:
    return [websocket.receive_json() for _ in range(5)]


def test_streaming_multiturn_history_and_character_isolation(tmp_path: Path) -> None:
    provider = RecordingProvider()
    app = create_app(settings(tmp_path), provider=provider)
    with TestClient(app) as client:
        with connect(client) as websocket:
            websocket.send_json(event("client.message", "request-1", data={"content": "First", "character_id": "BLACK"}))
            first = receive_turn(websocket)
            assert [item["type"] for item in first] == [
                "agent.state",
                "assistant.delta",
                "assistant.delta",
                "assistant.message",
                "agent.state",
            ]
            assert first[0]["data"]["state"] == "thinking"
            assert first[3]["data"]["content"] == "Hello there"
            assert first[4]["data"]["state"] == "idle"

            websocket.send_json(event("client.message", "request-2", data={"content": "Second", "character_id": "BLACK"}))
            receive_turn(websocket)
            second_messages = provider.calls[1][0]
            assert [message["role"] for message in second_messages] == ["user", "assistant", "user"]
            assert second_messages[1]["content"] == "Hello there"

            websocket.send_json(event("client.message", "request-3", data={"content": "White", "character_id": "WHITE"}))
            receive_turn(websocket)
            assert [message["content"] for message in provider.calls[2][0]] == ["White"]
            assert provider.calls[0][1] != provider.calls[2][1]

            websocket.send_json(event("client.message", "request-4", data={"content": "Report", "character_id": "SOLDIER"}))
            receive_turn(websocket)
            assert [message["content"] for message in provider.calls[3][0]] == ["Report"]
            assert "Vanguard" in provider.calls[3][1]
            assert provider.calls[3][1] not in {provider.calls[0][1], provider.calls[2][1]}


def test_request_cancel_and_busy_error(tmp_path: Path) -> None:
    app = create_app(settings(tmp_path), provider=SlowProvider())
    with TestClient(app) as client:
        with connect(client) as websocket:
            websocket.send_json(event("client.message", "request-1", data={"content": "Wait", "character_id": "BLACK"}))
            assert websocket.receive_json()["type"] == "agent.state"
            assert websocket.receive_json()["type"] == "assistant.delta"

            websocket.send_json(event("client.message", "request-2", data={"content": "Busy", "character_id": "BLACK"}))
            busy = websocket.receive_json()
            assert busy["type"] == "error"
            assert busy["request_id"] == "request-2"
            assert busy["data"]["error_code"] == "REQUEST_BUSY"

            websocket.send_json(event("request.cancel", "request-1", data={}))
            assert websocket.receive_json()["type"] == "request.cancelled"
            idle = websocket.receive_json()
            assert idle["type"] == "agent.state"
            assert idle["data"]["state"] == "idle"


def test_missing_provider_key_is_recoverable_at_connection_level(tmp_path: Path) -> None:
    app = create_app(settings(tmp_path))
    with TestClient(app) as client:
        with connect(client) as websocket:
            websocket.send_json(event("client.message", "request-1", data={"content": "Hello", "character_id": "BLACK"}))
            assert websocket.receive_json()["type"] == "agent.state"
            error = websocket.receive_json()
            assert error["type"] == "error"
            assert error["data"]["error_code"] == "PROVIDER_NOT_CONFIGURED"
            assert websocket.receive_json()["data"]["state"] == "idle"

            websocket.send_json(event("diagnostics.echo.request", "echo-1", data={"value": 1}))
            assert websocket.receive_json()["type"] == "diagnostics.echo.response"