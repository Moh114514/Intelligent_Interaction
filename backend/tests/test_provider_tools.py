from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from backend.app.providers import ProviderError
from backend.app.providers.base import ToolCallBatch
from backend.app.providers.openai_compatible import OpenAICompatibleProvider


def test_streaming_fragmented_tool_call_is_assembled() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["tool_choice"] == "auto"
        assert payload["tools"][0]["function"]["name"] == "system.current_time"
        content = """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-","function":{"name":"system.","arguments":"{"}}]}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"1","function":{"name":"current_time","arguments":"}"}}]}}]}

data: [DONE]

"""
        return httpx.Response(200, text=content)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = OpenAICompatibleProvider(
        api_key="test",
        base_url="https://provider.invalid/v1",
        model="test",
        timeout_seconds=1,
        client=client,
    )

    async def collect():
        try:
            return [
                item
                async for item in provider.stream_turn(
                    messages=[{"role": "user", "content": "time"}],
                    system_prompt="test",
                    tools=[{
                        "type": "function",
                        "function": {
                            "name": "system.current_time",
                            "description": "time",
                            "parameters": {"type": "object", "properties": {}},
                        },
                    }],
                )
            ]
        finally:
            await client.aclose()

    events = asyncio.run(collect())
    assert len(events) == 1
    assert isinstance(events[0], ToolCallBatch)
    assert events[0].calls[0].id == "call-1"
    assert events[0].calls[0].name == "system.current_time"
    assert events[0].calls[0].arguments == {}


def test_invalid_tool_arguments_are_rejected() -> None:
    content = """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"tool","arguments":"{"}}]}}]}

data: [DONE]

"""
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, text=content)))
    provider = OpenAICompatibleProvider(api_key="test", base_url="https://x", model="test", timeout_seconds=1, client=client)

    async def collect() -> None:
        try:
            async for _ in provider.stream_turn(messages=[], system_prompt="test", tools=[{}]):
                pass
        finally:
            await client.aclose()

    with pytest.raises(ProviderError) as caught:
        asyncio.run(collect())
    assert caught.value.error_code == "PROVIDER_RESPONSE_INVALID"