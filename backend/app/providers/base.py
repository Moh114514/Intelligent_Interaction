from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Any, TypedDict

from backend.app.tools.models import ToolCall


class ChatMessage(TypedDict, total=False):
    role: str
    content: str | None
    tool_calls: list[dict[str, Any]]
    tool_call_id: str


@dataclass(frozen=True)
class ToolCallBatch:
    calls: list[ToolCall]
    assistant_message: ChatMessage


ProviderTurnEvent = str | ToolCallBatch


class ProviderError(Exception):
    def __init__(self, error_code: str, message: str, recoverable: bool, *, status_code: int | None = None):
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.recoverable = recoverable
        self.status_code = status_code


class LLMProvider(ABC):
    supports_tool_calls = False
    @abstractmethod
    async def stream_chat(
        self,
        *,
        messages: Sequence[ChatMessage],
        system_prompt: str,
    ) -> AsyncIterator[str]:
        if False:
            yield ""

    async def stream_turn(
        self,
        *,
        messages: Sequence[ChatMessage],
        system_prompt: str,
        tools: Sequence[dict[str, Any]],
    ) -> AsyncIterator[ProviderTurnEvent]:
        async for delta in self.stream_chat(messages=messages, system_prompt=system_prompt):
            yield delta
