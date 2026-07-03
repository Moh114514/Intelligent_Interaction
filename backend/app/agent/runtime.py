from __future__ import annotations

from collections import defaultdict
from collections.abc import AsyncIterator

from backend.app.providers.base import ChatMessage, LLMProvider, ProviderError


CHARACTER_PROMPTS = {
    "BLACK": (
        "You are Kuro, a cool, slightly cynical but caring black cat with a deep male voice. "
        "You like lasagna and napping. Keep responses short and witty. End every response with ~. "
        "Do not describe physical actions or use asterisks. Only return spoken text."
    ),
    "WHITE": (
        "You are Shiro, a sweet, energetic and polite white cat with a soft female voice. "
        "You love playing and treats. Keep responses enthusiastic and cute. End every response with ~. "
        "Do not describe physical actions or use asterisks. Only return spoken text."
    ),
}


class AgentRuntime:
    def __init__(self, provider: LLMProvider, *, max_history_messages: int = 20) -> None:
        self.provider = provider
        self.max_history_messages = max(2, max_history_messages)
        self._history: dict[tuple[str, str], list[ChatMessage]] = defaultdict(list)

    async def stream_response(self, *, session_id: str, character_id: str, content: str) -> AsyncIterator[str]:
        if character_id not in CHARACTER_PROMPTS:
            raise ProviderError("INVALID_CHARACTER", "Unknown character_id", False)
        normalized = content.strip()
        if not normalized:
            raise ProviderError("INVALID_MESSAGE", "Message content cannot be empty", True)

        key = (session_id, character_id)
        prior = [message.copy() for message in self._history[key]]
        user_message: ChatMessage = {"role": "user", "content": normalized}
        chunks: list[str] = []
        async for delta in self.provider.stream_chat(messages=[*prior, user_message], system_prompt=CHARACTER_PROMPTS[character_id]):
            chunks.append(delta)
            yield delta

        assistant_text = "".join(chunks).strip()
        if not assistant_text:
            raise ProviderError("PROVIDER_RESPONSE_INVALID", "The LLM provider returned no response text", True)
        updated: list[ChatMessage] = [*prior, user_message, {"role": "assistant", "content": assistant_text}]
        self._history[key] = updated[-self.max_history_messages :]

    def get_history(self, session_id: str, character_id: str) -> list[ChatMessage]:
        return [message.copy() for message in self._history[(session_id, character_id)]]
