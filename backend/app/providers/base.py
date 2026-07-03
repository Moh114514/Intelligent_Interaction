from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Sequence
from typing import TypedDict


class ChatMessage(TypedDict):
    role: str
    content: str


class ProviderError(Exception):
    def __init__(self, error_code: str, message: str, recoverable: bool, *, status_code: int | None = None):
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.recoverable = recoverable
        self.status_code = status_code


class LLMProvider(ABC):
    @abstractmethod
    async def stream_chat(
        self,
        *,
        messages: Sequence[ChatMessage],
        system_prompt: str,
    ) -> AsyncIterator[str]:
        """Yield text deltas for one assistant response."""
        if False:
            yield ""