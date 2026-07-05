from __future__ import annotations

import asyncio

from collections.abc import AsyncIterator, Sequence
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
import pytest

from backend.app.agent.runtime import AgentRuntime, required_l0_tools

from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.providers.base import ChatMessage, LLMProvider, ProviderError, ToolCallBatch
from backend.app.tools.audit import create_audit_logger
from backend.app.tools.models import ToolCall
from backend.app.tools.registry import create_default_registry

TOKEN = "z" * 64


class ToolProvider(LLMProvider):
    supports_tool_calls = True

    def __init__(self, tool_name: str, arguments: dict[str, Any]) -> None:
        self.tool_name = tool_name
        self.arguments = arguments
        self.turn = 0

    async def stream_chat(self, *, messages: Sequence[ChatMessage], system_prompt: str) -> AsyncIterator[str]:
        if False:
            yield ""

    async def stream_turn(self, *, messages: Sequence[ChatMessage], system_prompt: str, tools: Sequence[dict[str, Any]]):
        assert tools
        self.turn += 1
        if self.turn == 1:
            yield "Let me check first."
            yield ToolCallBatch(
                [ToolCall("call-1", self.tool_name, self.arguments)],
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": self.tool_name, "arguments": "{}"},
                    }],
                },
            )
        else:
            yield "Tool "
            yield "handled"


def settings(tmp_path: Path) -> Settings:
    return Settings(
        host="127.0.0.1",
        port=8765,
        auth_token=TOKEN,
        log_dir=tmp_path / "logs",
        tool_shared_root=tmp_path / "shared",
        tool_confirmation_timeout_seconds=0.1,
    )


def event(event_type: str, request_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": event_type,
        "version": "1.0",
        "session_id": "session-tools",
        "request_id": request_id,
        "timestamp": "2026-07-03T00:00:00+00:00",
        "data": data,
    }


def connect(client: TestClient):
    return client.websocket_connect("/ws/v1", subprotocols=["agent.v1", TOKEN])


def test_l0_executes_automatically_and_emits_audit(tmp_path: Path) -> None:
    app = create_app(settings(tmp_path), provider=ToolProvider("system.current_time", {}))
    with TestClient(app) as client, connect(client) as websocket:
        websocket.send_json(event("client.message", "request-l0", {"content": "time", "character_id": "BLACK"}))
        received = [websocket.receive_json() for _ in range(8)]

    assert [(item["type"], item["data"].get("state")) for item in received] == [
        ("agent.state", "thinking"),
        ("agent.state", "acting"),
        ("tool.result", None),
        ("agent.state", "thinking"),
        ("assistant.delta", None),
        ("assistant.delta", None),
        ("assistant.message", None),
        ("agent.state", "idle"),
    ]
    assert received[2]["data"]["status"] == "succeeded"
    audit = (tmp_path / "logs" / "tool-audit.jsonl").read_text(encoding="utf-8")
    assert '"tool_name":"system.current_time"' in audit


def test_l2_requires_matching_approval(tmp_path: Path) -> None:
    shared = tmp_path / "shared"
    shared.mkdir()
    (shared / "note.txt").write_text("private contents", encoding="utf-8")
    app = create_app(settings(tmp_path), provider=ToolProvider("files.read_text", {"relative_path": "note.txt"}))

    with TestClient(app) as client, connect(client) as websocket:
        websocket.send_json(event("client.message", "request-l2", {"content": "read note", "character_id": "WHITE"}))
        assert websocket.receive_json()["data"]["state"] == "thinking"
        assert websocket.receive_json()["data"]["state"] == "confirming"
        confirmation = websocket.receive_json()
        assert confirmation["type"] == "tool.confirmation_required"

        websocket.send_json(event("tool.confirmation_response", "request-l2", {
            "confirmation_id": "wrong",
            "approved": True,
        }))
        assert websocket.receive_json()["data"]["error_code"] == "INVALID_CONFIRMATION"

        websocket.send_json(event("tool.confirmation_response", "request-l2", {
            "confirmation_id": confirmation["data"]["confirmation_id"],
            "approved": True,
        }))
        rest = [websocket.receive_json() for _ in range(7)]

    assert rest[0]["data"]["state"] == "acting"
    assert rest[1]["type"] == "tool.result"
    assert rest[1]["data"]["status"] == "succeeded"
    audit = (tmp_path / "logs" / "tool-audit.jsonl").read_text(encoding="utf-8")
    assert "private contents" not in audit


def test_l2_timeout_never_executes_file_read(tmp_path: Path) -> None:
    shared = tmp_path / "shared"
    shared.mkdir()
    (shared / "note.txt").write_text("never expose", encoding="utf-8")
    app = create_app(settings(tmp_path), provider=ToolProvider("files.read_text", {"relative_path": "note.txt"}))

    with TestClient(app) as client, connect(client) as websocket:
        websocket.send_json(event("client.message", "request-timeout", {"content": "read", "character_id": "BLACK"}))
        received = [websocket.receive_json() for _ in range(4)]

    assert any(item["type"] == "tool.result" for item in received), received
    result = next(item for item in received if item["type"] == "tool.result")
    assert result["data"]["status"] == "timed_out"
    audit = (tmp_path / "logs" / "tool-audit.jsonl").read_text(encoding="utf-8")
    assert '"status":"timed_out"' in audit
    assert "never expose" not in audit

def test_cancel_while_confirming_never_executes_tool(tmp_path: Path) -> None:
    shared = tmp_path / "shared"
    shared.mkdir()
    (shared / "note.txt").write_text("do not read", encoding="utf-8")
    app = create_app(settings(tmp_path), provider=ToolProvider("files.read_text", {"relative_path": "note.txt"}))

    with TestClient(app) as client, connect(client) as websocket:
        websocket.send_json(event("client.message", "request-cancel", {"content": "read", "character_id": "BLACK"}))
        assert websocket.receive_json()["data"]["state"] == "thinking"
        assert websocket.receive_json()["data"]["state"] == "confirming"
        assert websocket.receive_json()["type"] == "tool.confirmation_required"
        websocket.send_json(event("request.cancel", "request-cancel", {}))
        assert websocket.receive_json()["type"] == "request.cancelled"
        assert websocket.receive_json()["data"]["state"] == "idle"

    audit = (tmp_path / "logs" / "tool-audit.jsonl").read_text(encoding="utf-8")
    assert '"status":"cancelled"' in audit
    assert "do not read" not in audit


class LoopToolProvider(LLMProvider):
    supports_tool_calls = True

    def __init__(self) -> None:
        self.turn = 0

    async def stream_chat(self, *, messages: Sequence[ChatMessage], system_prompt: str) -> AsyncIterator[str]:
        if False:
            yield ""

    async def stream_turn(self, *, messages: Sequence[ChatMessage], system_prompt: str, tools: Sequence[dict[str, Any]]):
        self.turn += 1
        call_id = f"loop-{self.turn}"
        yield ToolCallBatch(
            [ToolCall(call_id, "system.current_time", {})],
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": call_id,
                    "type": "function",
                    "function": {"name": "system.current_time", "arguments": "{}"},
                }],
            },
        )


def test_max_tool_step_limit_stops_agent(tmp_path: Path) -> None:
    registry = create_default_registry(tmp_path / "shared")
    runtime = AgentRuntime(
        LoopToolProvider(),
        registry,
        create_audit_logger(tmp_path),
        max_tool_steps=2,
    )

    async def collect() -> None:
        async def confirm(_call: ToolCall, _summary: str, _details: dict[str, Any] | None):
            return "approved"

        async for _ in runtime.stream_response(
            session_id="session-limit",
            request_id="request-limit",
            character_id="BLACK",
            content="loop",
            confirm_tool=confirm,
        ):
            pass

    with pytest.raises(ProviderError) as caught:
        asyncio.run(collect())
    assert caught.value.error_code == "TOOL_STEP_LIMIT"

class FinalOnlyProvider(LLMProvider):
    def __init__(self) -> None:
        self.messages: list[ChatMessage] = []

    async def stream_chat(self, *, messages: Sequence[ChatMessage], system_prompt: str) -> AsyncIterator[str]:
        self.messages = [message.copy() for message in messages]
        yield "done"


def test_natural_language_l0_intents_are_routed_deterministically(tmp_path: Path) -> None:
    provider = FinalOnlyProvider()
    app = create_app(settings(tmp_path), provider=provider)
    with TestClient(app) as client, connect(client) as websocket:
        websocket.send_json(event(
            "client.message",
            "request-natural-l0",
            {"content": "\u73b0\u5728\u662f\u51e0\u70b9\uff0c\u5e76\u67e5\u8be2\u4e00\u4e0b\u6211\u7684\u7535\u8111\u4fe1\u606f", "character_id": "BLACK"},
        ))
        received = [websocket.receive_json() for _ in range(9)]

    results = [item for item in received if item["type"] == "tool.result"]
    assert [(item["data"]["tool_name"], item["data"]["status"]) for item in results] == [
        ("system.current_time", "succeeded"),
        ("system.info", "succeeded"),
    ]
    assert [message["role"] for message in provider.messages] == ["user", "assistant", "tool", "tool"]
    provider_names = [
        call["function"]["name"]
        for call in provider.messages[1]["tool_calls"]
    ]
    assert provider_names == ["system_current_time", "system_info"]


def test_denied_text_creation_has_no_filesystem_side_effect(tmp_path: Path) -> None:
    from backend.app.tools.adapters import FileAdapter

    target = tmp_path / "denied.txt"
    files = FileAdapter(tmp_path / "shared", search_roots=[tmp_path])
    registry = create_default_registry(files.root, files=files)
    (tmp_path / "logs").mkdir()
    runtime = AgentRuntime(
        ToolProvider("files.create_text", {"path": str(target), "content": "must not be written"}),
        registry,
        create_audit_logger(tmp_path / "logs"),
    )
    outputs = []

    async def collect() -> None:
        async def deny(_call: ToolCall, _summary: str, details: dict[str, Any] | None):
            assert details and details["target"].endswith("denied.txt")
            assert details["content"] == "must not be written"
            return "denied"

        async for output in runtime.stream_response(
            session_id="session-denied-write",
            request_id="request-denied-write",
            character_id="BLACK",
            content="create the file",
            confirm_tool=deny,
        ):
            outputs.append(output)

    asyncio.run(collect())
    assert not target.exists()
    assert any(output.kind == "tool_result" and output.data["status"] == "denied" for output in outputs)
    audit = (tmp_path / "logs" / "tool-audit.jsonl").read_text(encoding="utf-8")
    assert "must not be written" not in audit
    assert '"confirmation_result":"denied"' in audit

class DefinitionCapturingProvider(LLMProvider):
    supports_tool_calls = True

    def __init__(self) -> None:
        self.tool_names: list[str] = []
        self.system_prompt = ""

    async def stream_chat(self, *, messages: Sequence[ChatMessage], system_prompt: str) -> AsyncIterator[str]:
        if False:
            yield ""

    async def stream_turn(self, *, messages: Sequence[ChatMessage], system_prompt: str, tools: Sequence[dict[str, Any]]):
        self.tool_names = [str(item["function"]["name"]) for item in tools]
        self.system_prompt = system_prompt
        yield "\u8bf7\u63d0\u4f9b\u8981\u521b\u5efa\u6587\u4ef6\u7684\u5b8c\u6574\u8def\u5f84\u3002"


def test_unrelated_file_request_does_not_expose_ephemeral_l0_tools(tmp_path: Path) -> None:
    content = "\u65b0\u5efa\u4e00\u4e2a\u540d\u4e3atest2.txt\u7684\u6587\u4ef6\uff0c\u91cc\u9762\u968f\u4fbf\u5199\u70b9\u4f60\u60f3\u5199\u7684\u4e1c\u897f"
    assert required_l0_tools(content) == []
    provider = DefinitionCapturingProvider()
    app = create_app(settings(tmp_path), provider=provider)
    with TestClient(app) as client, connect(client) as websocket:
        websocket.send_json(event("client.message", "request-no-diagnostics", {"content": content, "character_id": "BLACK"}))
        received = [websocket.receive_json() for _ in range(4)]

    assert not [item for item in received if item["type"] == "tool.result"]
    assert "system_current_time" not in provider.tool_names
    assert "system_info" not in provider.tool_names
    assert "Do not append unrelated facts" in provider.system_prompt


def test_explicit_time_and_system_intent_is_still_detected() -> None:
    assert required_l0_tools("\u73b0\u5728\u51e0\u70b9\uff1f") == ["system.current_time"]
    assert required_l0_tools("\u6211\u7684Windows\u7248\u672c\u662f\u4ec0\u4e48\uff1f") == ["system.info"]