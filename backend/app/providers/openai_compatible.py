from __future__ import annotations

import json
from collections.abc import AsyncIterator, Sequence
from typing import Any

import httpx

from backend.app.providers.base import (
    ChatMessage,
    LLMProvider,
    ProviderError,
    ProviderTurnEvent,
    ToolCallBatch,
)
from backend.app.tools.models import ToolCall


class OpenAICompatibleProvider(LLMProvider):
    supports_tool_calls = True
    def __init__(self, *, api_key: str, base_url: str, model: str, timeout_seconds: float, client: httpx.AsyncClient | None = None) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self._client = client

    async def stream_chat(self, *, messages: Sequence[ChatMessage], system_prompt: str) -> AsyncIterator[str]:
        async for event in self._stream(messages=messages, system_prompt=system_prompt, tools=[]):
            if isinstance(event, str):
                yield event
            else:
                raise ProviderError("PROVIDER_RESPONSE_INVALID", "The provider returned an unexpected tool call", True)

    async def stream_turn(
        self,
        *,
        messages: Sequence[ChatMessage],
        system_prompt: str,
        tools: Sequence[dict[str, Any]],
    ) -> AsyncIterator[ProviderTurnEvent]:
        async for event in self._stream(messages=messages, system_prompt=system_prompt, tools=tools):
            yield event

    async def _stream(
        self,
        *,
        messages: Sequence[ChatMessage],
        system_prompt: str,
        tools: Sequence[dict[str, Any]],
    ) -> AsyncIterator[ProviderTurnEvent]:
        if not self.api_key:
            raise ProviderError("PROVIDER_NOT_CONFIGURED", "The LLM provider is not configured", False)

        payload: dict[str, Any] = {
            "model": self.model,
            "stream": True,
            "messages": [{"role": "system", "content": system_prompt}, *messages],
        }
        if tools:
            payload["tools"] = list(tools)
            payload["tool_choice"] = "auto"
            payload["thinking"] = {"type": "disabled"}

        client = self._client or httpx.AsyncClient(timeout=self.timeout_seconds)
        owns_client = self._client is None
        received = False
        tool_parts: dict[int, dict[str, str]] = {}
        try:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    await response.aread()
                    raise self._map_status(response.status_code, self._error_detail(response))

                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        event = json.loads(data)
                        choices = event.get("choices") or []
                        delta = choices[0].get("delta", {}) if choices else {}
                        content = delta.get("content")
                        fragments = delta.get("tool_calls") or []
                    except (json.JSONDecodeError, AttributeError, IndexError, TypeError) as error:
                        raise ProviderError("PROVIDER_RESPONSE_INVALID", "The LLM provider returned an invalid stream event", True) from error

                    if isinstance(content, str) and content:
                        received = True
                        yield content
                    if not isinstance(fragments, list):
                        raise ProviderError("PROVIDER_RESPONSE_INVALID", "The provider returned invalid tool calls", True)
                    for fragment in fragments:
                        try:
                            index = int(fragment.get("index", 0))
                            function = fragment.get("function") or {}
                            part = tool_parts.setdefault(index, {"id": "", "name": "", "arguments": ""})
                            part["id"] += fragment.get("id") or ""
                            part["name"] += function.get("name") or ""
                            part["arguments"] += function.get("arguments") or ""
                            received = True
                        except (AttributeError, TypeError, ValueError) as error:
                            raise ProviderError("PROVIDER_RESPONSE_INVALID", "The provider returned invalid tool call fragments", True) from error

            if tool_parts:
                calls: list[ToolCall] = []
                raw_calls: list[dict[str, Any]] = []
                for index in sorted(tool_parts):
                    part = tool_parts[index]
                    try:
                        arguments = json.loads(part["arguments"] or "{}")
                    except json.JSONDecodeError as error:
                        raise ProviderError("PROVIDER_RESPONSE_INVALID", "Tool arguments were not valid JSON", True) from error
                    if not part["id"] or not part["name"] or not isinstance(arguments, dict):
                        raise ProviderError("PROVIDER_RESPONSE_INVALID", "The provider returned an incomplete tool call", True)
                    calls.append(ToolCall(part["id"], part["name"], arguments))
                    raw_calls.append({
                        "id": part["id"],
                        "type": "function",
                        "function": {"name": part["name"], "arguments": part["arguments"] or "{}"},
                    })
                yield ToolCallBatch(calls, {"role": "assistant", "content": None, "tool_calls": raw_calls})

            if not received:
                raise ProviderError("PROVIDER_RESPONSE_INVALID", "The LLM provider returned no response", True)
        except ProviderError:
            raise
        except httpx.TimeoutException as error:
            raise ProviderError("PROVIDER_TIMEOUT", "The LLM provider timed out", True) from error
        except httpx.HTTPError as error:
            raise ProviderError("PROVIDER_UNAVAILABLE", "The LLM provider is unavailable", True) from error
        finally:
            if owns_client:
                await client.aclose()

    @staticmethod
    def _error_detail(response: httpx.Response) -> str | None:
        try:
            payload = response.json()
            detail = payload.get("error", {}).get("message")
        except (ValueError, AttributeError):
            detail = None
        return detail[:300] if isinstance(detail, str) and detail else None

    @staticmethod
    def _map_status(status_code: int, detail: str | None = None) -> ProviderError:
        if status_code in {401, 403}:
            return ProviderError("PROVIDER_AUTH_ERROR", "The LLM provider rejected the configured credentials", False, status_code=status_code)
        if status_code in {400, 404, 422}:
            message = "The LLM provider rejected the request"
            if detail:
                message += f": {detail}"
            return ProviderError("PROVIDER_REQUEST_INVALID", message, False, status_code=status_code)
        if status_code == 429:
            return ProviderError("PROVIDER_RATE_LIMITED", "The LLM provider rate limit was reached", True, status_code=status_code)
        return ProviderError("PROVIDER_UNAVAILABLE", "The LLM provider returned an error", status_code >= 500, status_code=status_code)
