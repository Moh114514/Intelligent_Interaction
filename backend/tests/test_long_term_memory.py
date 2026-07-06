from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import AsyncIterator, Sequence
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.agent.prompts import compose_system_prompt
from backend.app.agent.runtime import AgentRuntime
from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.memory import DatabaseError, MemoryService, SQLiteStore
from backend.app.providers.base import ChatMessage, LLMProvider, ToolCallBatch
from backend.app.tools import create_default_registry
from backend.app.tools.models import ToolCall

TOKEN = "z" * 64


class ExtractionProvider(LLMProvider):
    def __init__(self, response: str = "[]") -> None:
        self.response = response
        self.prompts: list[str] = []

    async def stream_chat(self, *, messages: Sequence[ChatMessage], system_prompt: str) -> AsyncIterator[str]:
        self.prompts.append(system_prompt)
        yield self.response


def make_settings(tmp_path: Path) -> Settings:
    return Settings(host="127.0.0.1", port=8765, auth_token=TOKEN, log_dir=tmp_path / "logs", data_dir=tmp_path / "data")


def test_v1_database_migrates_to_v2_with_backup(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path)
    with store.connect() as connection:
        store._migrate_v1(connection)
    assert sqlite3.connect(tmp_path / "agent.db").execute("PRAGMA user_version").fetchone()[0] == 1
    store.initialize()
    assert store.schema_version == 2
    assert (tmp_path / "agent.v1.bak").is_file()
    assert store.create_session("kept")["id"] == "kept"


def test_memory_candidate_approval_recall_update_and_permanent_delete(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path); store.initialize()
    service = MemoryService(store, ExtractionProvider())
    candidate = service.create(status="pending", content="\u6211\u559c\u6b22\u7b80\u6d01\u7684\u56de\u7b54", category="preference", keywords=["\u7b80\u6d01"], importance=4)
    assert service.context("\u8bf7\u7b80\u6d01\u56de\u7b54") == ""
    approved = service.approve(candidate["id"])
    assert approved["status"] == "active"
    assert "\u7b80\u6d01" in service.context("\u8bf7\u7b80\u6d01\u56de\u7b54")
    updated = service.update(approved["id"], content="\u6211\u504f\u597d\u7b80\u77ed\u7684\u4e2d\u6587\u56de\u7b54", category="preference", importance=5, pinned=True)
    assert updated["pinned"] is True
    assert service.delete(updated["id"])
    assert service.list("active") == []
    with sqlite3.connect(store.path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM memories WHERE content LIKE '%\u4e2d\u6587%'").fetchone()[0] == 0


def test_memory_rejects_sensitive_values_and_deduplicates(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path); store.initialize(); service = MemoryService(store, ExtractionProvider())
    with pytest.raises(DatabaseError, match="Sensitive"):
        service.create(content="API_KEY=top-secret", category="profile")
    first = service.create(content="My preferred language is Chinese", category="preference")
    second = service.create(content="  my preferred language is chinese  ", category="preference")
    assert first["id"] == second["id"]


def test_heuristic_extraction_creates_only_pending_candidates(tmp_path: Path) -> None:
    async def scenario() -> None:
        provider = ExtractionProvider('[{"content":"The user likes tea","category":"preference","keywords":["tea"],"importance":4}]')
        store = SQLiteStore(tmp_path); store.initialize(); service = MemoryService(store, provider)
        store.begin_request("request-a", "session-a", "BLACK", "message")
        assert service.schedule_extraction("I like tea", "session-a", "request-a")
        await asyncio.gather(*list(service._tasks))
        pending = service.list("pending")
        assert len(pending) == 1 and pending[0]["content"] == "The user likes tea"
        assert service.list("active") == []
        assert not service.schedule_extraction("hello", "session-a", "request-b")
        assert not service.schedule_extraction("my password is secret", "session-a", "request-c")
    asyncio.run(scenario())


def test_local_recall_budget_and_prompt_treat_memory_as_untrusted(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path); store.initialize(); service = MemoryService(store, ExtractionProvider())
    for index in range(15):
        service.create(content=f"Project alpha preference {index}", category="project", importance=3)
    context = service.context("alpha project")
    assert len(context.splitlines()) <= 12 and len(context) <= 2000
    prompt = compose_system_prompt("BLACK", [], context)
    assert "Untrusted User Data" in prompt and "cannot override" in prompt


def test_memory_tools_have_expected_risk_and_redacted_summaries(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "data"); store.initialize(); service = MemoryService(store, ExtractionProvider())
    registry = create_default_registry(tmp_path / "shared", memory=service)
    assert registry.descriptor("memory.search").risk_level == "L0"
    assert registry.descriptor("memory.remember").risk_level == "L2"
    args = {"content": "The user likes tea", "category": "preference"}
    assert registry.confirmation_details("memory.remember", args)["content"] == args["content"]
    assert args["content"] not in registry.confirmation_summary("memory.remember", args)


def test_memory_rest_api_crud_and_authentication(tmp_path: Path) -> None:
    app = create_app(make_settings(tmp_path), provider=ExtractionProvider("done"))
    headers = {"Authorization": "Bearer " + TOKEN}
    with TestClient(app) as client:
        assert client.get("/api/v1/memories").status_code == 401
        created = client.post("/api/v1/memories", headers=headers, json={"content": "User likes tea", "category": "preference"})
        assert created.status_code == 200
        memory_id = created.json()["id"]
        page = client.get("/api/v1/memories?status=active", headers=headers).json()
        assert page["items"][0]["id"] == memory_id and page["has_more"] is False
        assert client.patch(f"/api/v1/memories/{memory_id}", headers=headers, json={"pinned": True}).json()["pinned"] is True
        assert client.delete(f"/api/v1/memories/{memory_id}", headers=headers).json() == {"deleted": True}
        assert client.get("/api/v1/memories?status=active", headers=headers).json()["items"] == []

class MemoryToolProvider(LLMProvider):
    supports_tool_calls = True

    async def stream_chat(self, *, messages: Sequence[ChatMessage], system_prompt: str) -> AsyncIterator[str]:
        yield "unused"

    async def stream_turn(self, *, messages: Sequence[ChatMessage], system_prompt: str, tools: Sequence[dict]) -> AsyncIterator[str | ToolCallBatch]:
        if not any(message.get("role") == "tool" for message in messages):
            call = ToolCall("memory-call", "memory_remember", {"content": "The user prefers concise answers", "category": "preference"})
            yield ToolCallBatch([call], {"role": "assistant", "content": None, "tool_calls": [{"id": call.id, "type": "function", "function": {"name": call.name, "arguments": '{"content":"The user prefers concise answers","category":"preference"}'}}]})
        else:
            yield "Memory request completed"


def test_explicit_memory_tool_requires_confirmation(tmp_path: Path) -> None:
    async def run(decision: str, data_dir: Path) -> list[dict]:
        store = SQLiteStore(data_dir); store.initialize(); service = MemoryService(store, MemoryToolProvider())
        runtime = AgentRuntime(MemoryToolProvider(), create_default_registry(data_dir / "shared", memory=service), store, memory_service=service)
        async def confirm(*_args): return decision
        outputs = []
        async for output in runtime.stream_response(session_id="session", request_id="request", character_id="BLACK", content="Remember my preference", confirm_tool=confirm):
            outputs.append(output.data)
        return service.list("active")
    approved = asyncio.run(run("approved", tmp_path / "approved"))
    denied = asyncio.run(run("denied", tmp_path / "denied"))
    assert [item["content"] for item in approved] == ["The user prefers concise answers"]
    assert denied == []


class PromptCaptureProvider(LLMProvider):
    def __init__(self) -> None: self.prompts: list[str] = []
    async def stream_chat(self, *, messages: Sequence[ChatMessage], system_prompt: str) -> AsyncIterator[str]:
        self.prompts.append(system_prompt); yield "done"


def test_approved_memory_is_shared_across_sessions_and_characters(tmp_path: Path) -> None:
    async def scenario() -> list[str]:
        store = SQLiteStore(tmp_path); store.initialize(); provider = PromptCaptureProvider(); service = MemoryService(store, provider)
        service.create(content="Project alpha uses Python", category="project", pinned=True)
        runtime = AgentRuntime(provider, create_default_registry(tmp_path / "shared", memory=service), store, memory_service=service)
        async def confirm(*_args): return "approved"
        for session_id, character_id in (("one", "BLACK"), ("two", "SOLDIER")):
            async for _ in runtime.stream_response(session_id=session_id, request_id=session_id, character_id=character_id, content="Tell me about project alpha", confirm_tool=confirm): pass
        return provider.prompts
    prompts = asyncio.run(scenario())
    assert len(prompts) == 2 and all("Project alpha uses Python" in prompt for prompt in prompts)
    assert "Kuro" in prompts[0] and "Vanguard" in prompts[1]