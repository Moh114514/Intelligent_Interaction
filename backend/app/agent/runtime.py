from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import defaultdict
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from backend.app.providers.base import ChatMessage, LLMProvider, ProviderError, ToolCallBatch
from backend.app.tools.audit import write_audit
from backend.app.tools.models import ToolCall, ToolError, ToolExecutionResult
from backend.app.tools.registry import ToolRegistry

CHARACTER_PROMPTS = {
    "BLACK": (
        "You are Kuro, a cool, slightly cynical but caring black cat with a deep male voice. "
        "You like lasagna and napping. Keep responses short and witty. End every response with ~. "
        "Do not describe physical actions or use asterisks. Only return spoken text. "
        "Use available tools when the user asks for current local information or an allowed desktop action. "
        "Never claim a tool succeeded unless its result says it succeeded."
    ),
    "WHITE": (
        "You are Shiro, a sweet, energetic and polite white cat with a soft female voice. "
        "You love playing and treats. Keep responses enthusiastic and cute. End every response with ~. "
        "Do not describe physical actions or use asterisks. Only return spoken text. "
        "Use available tools when the user asks for current local information or an allowed desktop action. "
        "Never claim a tool succeeded unless its result says it succeeded."
    ),
}

ConfirmationDecision = Literal["approved", "denied", "timed_out"]
ConfirmTool = Callable[[ToolCall, str], Awaitable[ConfirmationDecision]]


@dataclass(frozen=True)
class AgentOutput:
    kind: Literal["delta", "state", "tool_result"]
    data: dict[str, Any]


class AgentRuntime:
    def __init__(
        self,
        provider: LLMProvider,
        registry: ToolRegistry,
        audit_logger: logging.Logger,
        *,
        max_history_messages: int = 20,
        max_tool_steps: int = 5,
    ) -> None:
        self.provider = provider
        self.registry = registry
        self.audit_logger = audit_logger
        self.max_history_messages = max(2, max_history_messages)
        self.max_tool_steps = max(1, max_tool_steps)
        self._history: dict[tuple[str, str], list[ChatMessage]] = defaultdict(list)

    async def stream_response(
        self,
        *,
        session_id: str,
        request_id: str,
        character_id: str,
        content: str,
        confirm_tool: ConfirmTool,
    ) -> AsyncIterator[AgentOutput]:
        if character_id not in CHARACTER_PROMPTS:
            raise ProviderError("INVALID_CHARACTER", "Unknown character_id", False)
        normalized = content.strip()
        if not normalized:
            raise ProviderError("INVALID_MESSAGE", "Message content cannot be empty", True)

        key = (session_id, character_id)
        prior = [message.copy() for message in self._history[key]]
        working: list[ChatMessage] = [*prior, {"role": "user", "content": normalized}]
        tool_steps = 0

        while True:
            chunks: list[str] = []
            batch: ToolCallBatch | None = None
            async for event in self.provider.stream_turn(
                messages=working,
                system_prompt=CHARACTER_PROMPTS[character_id],
                tools=self.registry.definitions(),
            ):
                if isinstance(event, str):
                    chunks.append(event)
                    yield AgentOutput("delta", {"delta": event})
                elif isinstance(event, ToolCallBatch):
                    if chunks:
                        raise ProviderError("PROVIDER_RESPONSE_INVALID", "Provider mixed response text with tool calls", True)
                    if batch is not None:
                        raise ProviderError("PROVIDER_RESPONSE_INVALID", "Provider returned multiple tool call batches", True)
                    batch = event

            if batch is None:
                assistant_text = "".join(chunks).strip()
                if not assistant_text:
                    raise ProviderError("PROVIDER_RESPONSE_INVALID", "The LLM provider returned no response text", True)
                working.append({"role": "assistant", "content": assistant_text})
                self._history[key] = [message.copy() for message in working[-self.max_history_messages :]]
                return

            working.append(batch.assistant_message)
            for provider_call in batch.calls:
                call = ToolCall(provider_call.id, self.registry.canonical_name(provider_call.name), provider_call.arguments)
                tool_steps += 1
                if tool_steps > self.max_tool_steps:
                    raise ProviderError("TOOL_STEP_LIMIT", "The agent reached the maximum number of tool calls", True)

                try:
                    if self.registry.descriptor(call.name).risk_level != "L2":
                        yield AgentOutput("state", {"state": "acting"})
                except ToolError:
                    pass
                result = await self._run_tool(
                    call,
                    session_id=session_id,
                    request_id=request_id,
                    confirm_tool=confirm_tool,
                )
                yield AgentOutput(
                    "tool_result",
                    {
                        "tool_call_id": call.id,
                        "tool_name": call.name,
                        "status": result.status,
                        "summary": result.summary,
                    },
                )
                working.append({"role": "tool", "tool_call_id": call.id, "content": result.content})
            yield AgentOutput("state", {"state": "thinking"})

    async def _run_tool(
        self,
        call: ToolCall,
        *,
        session_id: str,
        request_id: str,
        confirm_tool: ConfirmTool,
    ) -> ToolExecutionResult:
        started = time.perf_counter()
        risk = "unknown"
        safe_summary = "Rejected unavailable tool"
        try:
            descriptor = self.registry.descriptor(call.name)
            risk = descriptor.risk_level
            safe_summary = self.registry.confirmation_summary(call.name, call.arguments)

            if risk == "L2":
                decision = await confirm_tool(call, safe_summary)
                if decision != "approved":
                    status = "timed_out" if decision == "timed_out" else "denied"
                    code = "TOOL_CONFIRMATION_TIMEOUT" if decision == "timed_out" else "TOOL_DENIED"
                    result = ToolExecutionResult(
                        status,
                        json.dumps({"error": code, "message": "Tool execution was not approved"}),
                        "Confirmation timed out" if decision == "timed_out" else "User denied the tool",
                        code,
                    )
                    self._audit(session_id, request_id, call, risk, result, started, safe_summary)
                    return result

            result = await self.registry.execute(call.name, call.arguments)
            self._audit(session_id, request_id, call, risk, result, started, safe_summary)
            return result
        except ToolError as error:
            result = ToolExecutionResult(
                "failed",
                json.dumps({"error": error.message, "error_code": error.error_code}, ensure_ascii=False),
                error.message,
                error.error_code,
            )
            self._audit(session_id, request_id, call, risk, result, started, safe_summary)
            return result
        except asyncio.CancelledError:
            result = ToolExecutionResult("cancelled", '{"error":"request cancelled"}', "Tool cancelled", "REQUEST_CANCELLED")
            self._audit(session_id, request_id, call, risk, result, started, safe_summary)
            raise

    def _audit(
        self,
        session_id: str,
        request_id: str,
        call: ToolCall,
        risk: str,
        result: ToolExecutionResult,
        started: float,
        safe_summary: str,
    ) -> None:
        write_audit(
            self.audit_logger,
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "session_id": session_id,
                "request_id": request_id,
                "tool_call_id": call.id,
                "tool_name": call.name,
                "risk_level": risk,
                "status": result.status,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                "resource": safe_summary,
                "argument_keys": sorted(call.arguments),
                "error_code": result.error_code,
            },
        )

    def get_history(self, session_id: str, character_id: str) -> list[ChatMessage]:
        return [message.copy() for message in self._history[(session_id, character_id)]]
