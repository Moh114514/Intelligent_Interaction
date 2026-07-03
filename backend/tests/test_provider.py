from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from backend.app.providers import OpenAICompatibleProvider, ProviderError


def provider(handler: httpx.MockTransport) -> OpenAICompatibleProvider:
    client = httpx.AsyncClient(transport=handler)
    return OpenAICompatibleProvider(
        api_key="test-key",
        base_url="https://provider.invalid/v1",
        model="test-model",
        timeout_seconds=1,
        client=client,
    )


async def collect(instance: OpenAICompatibleProvider) -> list[str]:
    try:
        return [
            chunk
            async for chunk in instance.stream_chat(
                messages=[{"role": "user", "content": "Hello"}],
                system_prompt="Be concise",
            )
        ]
    finally:
        if instance._client is not None:
            await instance._client.aclose()


def test_streaming_sse_content() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["stream"] is True
        assert body["messages"][0]["role"] == "system"
        content = (
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
            'data: {"choices":[{"delta":{"content":" there"}}]}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx.Response(200, text=content)

    assert asyncio.run(collect(provider(httpx.MockTransport(handler)))) == ["Hello", " there"]


@pytest.mark.parametrize(
    ("status_code", "error_code", "recoverable"),
    [(401, "PROVIDER_AUTH_ERROR", False), (429, "PROVIDER_RATE_LIMITED", True), (503, "PROVIDER_UNAVAILABLE", True)],
)
def test_http_error_mapping(status_code: int, error_code: str, recoverable: bool) -> None:
    instance = provider(httpx.MockTransport(lambda _: httpx.Response(status_code, text="failed")))
    with pytest.raises(ProviderError) as caught:
        asyncio.run(collect(instance))
    assert caught.value.error_code == error_code
    assert caught.value.recoverable is recoverable


def test_timeout_mapping() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    instance = provider(httpx.MockTransport(handler))
    with pytest.raises(ProviderError) as caught:
        asyncio.run(collect(instance))
    assert caught.value.error_code == "PROVIDER_TIMEOUT"
    assert caught.value.recoverable is True


def test_invalid_or_empty_stream_mapping() -> None:
    instance = provider(httpx.MockTransport(lambda _: httpx.Response(200, text="data: {}\n\ndata: [DONE]\n\n")))
    with pytest.raises(ProviderError) as caught:
        asyncio.run(collect(instance))
    assert caught.value.error_code == "PROVIDER_RESPONSE_INVALID"