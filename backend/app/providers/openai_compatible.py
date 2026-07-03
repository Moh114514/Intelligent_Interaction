from __future__ import annotations

import json
from collections.abc import AsyncIterator, Sequence

import httpx

from backend.app.providers.base import ChatMessage, LLMProvider, ProviderError


class OpenAICompatibleProvider(LLMProvider):
    def __init__(self, *, api_key: str, base_url: str, model: str, timeout_seconds: float, client: httpx.AsyncClient | None = None) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self._client = client

    async def stream_chat(self, *, messages: Sequence[ChatMessage], system_prompt: str) -> AsyncIterator[str]:
        if not self.api_key:
            raise ProviderError("PROVIDER_NOT_CONFIGURED", "The LLM provider is not configured", False)

        payload = {"model": self.model, "stream": True, "messages": [{"role": "system", "content": system_prompt}, *messages]}
        client = self._client or httpx.AsyncClient(timeout=self.timeout_seconds)
        owns_client = self._client is None
        received_content = False
        try:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    await response.aread()
                    raise self._map_status(response.status_code)

                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        event = json.loads(data)
                        choices = event.get("choices") or []
                        delta = choices[0].get("delta", {}).get("content") if choices else None
                    except (json.JSONDecodeError, AttributeError, IndexError, TypeError) as error:
                        raise ProviderError("PROVIDER_RESPONSE_INVALID", "The LLM provider returned an invalid stream event", True) from error
                    if isinstance(delta, str) and delta:
                        received_content = True
                        yield delta

            if not received_content:
                raise ProviderError("PROVIDER_RESPONSE_INVALID", "The LLM provider returned no response text", True)
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
    def _map_status(status_code: int) -> ProviderError:
        if status_code in {401, 403}:
            return ProviderError("PROVIDER_AUTH_ERROR", "The LLM provider rejected the configured credentials", False, status_code=status_code)
        if status_code == 429:
            return ProviderError("PROVIDER_RATE_LIMITED", "The LLM provider rate limit was reached", True, status_code=status_code)
        return ProviderError("PROVIDER_UNAVAILABLE", "The LLM provider returned an error", status_code >= 500, status_code=status_code)