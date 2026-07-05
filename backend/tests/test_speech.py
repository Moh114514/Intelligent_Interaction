import asyncio
import base64
import json
import httpx
import pytest
from backend.app.speech.base import SpeechProviderError, SynthesisResult
from backend.app.speech.store import AudioStore
from backend.app.speech.volcengine import VolcengineSpeechProvider
from backend.app.speech.wav import inspect_wav, pcm_to_wav
from backend.app.speech.xunfei import XunfeiSpeechProvider

def run(awaitable):
    return asyncio.run(awaitable)

def make_wav(frames: int = 1600) -> bytes:
    return pcm_to_wav(b"\x00\x00" * frames, 16000)

def test_volcengine_asr_uses_v3_headers_and_parses_text():
    async def scenario():
        async def handler(request: httpx.Request) -> httpx.Response:
            assert request.headers["X-Api-Key"] == "secret"
            assert request.headers["X-Api-Resource-Id"] == "volc.bigasr.auc_turbo"
            body = json.loads(request.content)
            assert base64.b64decode(body["audio"]["data"]).startswith(b"RIFF")
            return httpx.Response(200, headers={"X-Api-Status-Code": "20000000"}, json={"result": {"text": "测试识别"}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = VolcengineSpeechProvider(api_key="secret", speakers={"BLACK": "voice"}, client=client)
            assert (await provider.transcribe(make_wav(), "request-1")).text == "测试识别"
    run(scenario())

def test_volcengine_legacy_credentials_use_official_v3_headers():
    async def scenario():
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            assert "X-Api-Key" not in request.headers
            assert request.headers["X-Api-Access-Key"] == "legacy-token"
            if calls == 1:
                assert request.headers["X-Api-App-Key"] == "legacy-app"
                return httpx.Response(
                    200,
                    headers={"X-Api-Status-Code": "20000000"},
                    json={"result": {"text": "旧版识别"}},
                )
            assert request.headers["X-Api-App-Id"] == "legacy-app"
            assert request.url.path == "/api/v3/tts/unidirectional"
            body = json.loads(request.content)
            assert body["req_params"]["speaker"] == "saturn-test"
            first = json.dumps({"code": 0, "data": base64.b64encode(b"RIFF").decode()})
            second = json.dumps({"code": 20000000, "data": base64.b64encode(b"audio").decode()})
            return httpx.Response(200, text=first + second)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = VolcengineSpeechProvider(
                app_id="legacy-app",
                access_token="legacy-token",
                speakers={"BLACK": "saturn-test"},
                client=client,
            )
            assert (await provider.transcribe(make_wav(), "legacy-asr")).text == "旧版识别"
            result = await provider.synthesize("你好", "BLACK", "legacy-tts")
            assert result.audio == b"RIFFaudio"

    run(scenario())

def test_volcengine_tts_merges_ndjson_audio_chunks():
    async def scenario():
        first, second = b"RIFF", b"audio"
        async def handler(request: httpx.Request) -> httpx.Response:
            assert request.headers["X-Api-Resource-Id"] == "seed-tts-2.0"
            assert json.loads(request.content)["req_params"]["speaker"] == "voice-black"
            lines = "\n".join([json.dumps({"code": 0, "data": base64.b64encode(first).decode()}),
                json.dumps({"code": 0, "data": base64.b64encode(second).decode()}), json.dumps({"code": 20000000, "data": None})])
            return httpx.Response(200, text=lines)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = VolcengineSpeechProvider(api_key="secret", speakers={"BLACK": "voice-black"}, client=client)
            result = await provider.synthesize("你好", "BLACK", "request-2")
            assert result.audio == first + second and result.mime_type == "audio/wav"
    run(scenario())

def test_volcengine_maps_silence_and_requires_configuration():
    async def scenario():
        provider = VolcengineSpeechProvider(api_key="", speakers={})
        with pytest.raises(SpeechProviderError) as missing:
            await provider.transcribe(make_wav(), "request")
        assert missing.value.error_code == "SPEECH_PROVIDER_NOT_CONFIGURED"
        async def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(200, headers={"X-Api-Status-Code": "20000003"}, json={})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = VolcengineSpeechProvider(api_key="key", speakers={}, client=client)
            with pytest.raises(SpeechProviderError) as silent:
                await provider.transcribe(make_wav(), "request")
            assert silent.value.error_code == "ASR_SILENT_AUDIO"
    run(scenario())

def test_wav_validation_and_one_time_audio_store():
    assert inspect_wav(make_wav(16000)).duration_ms == 1000
    store = AudioStore(ttl_seconds=30)
    item = store.put(SynthesisResult(make_wav(), "audio/wav", 16000))
    assert store.pop(item.audio_id) is not None and store.pop(item.audio_id) is None

def test_xunfei_auth_url_contains_no_plain_secret():
    provider = XunfeiSpeechProvider(app_id="app", api_key="key", api_secret="top-secret", speakers={})
    url = provider._authenticated_url("wss://iat-api.xfyun.cn/v2/iat")
    assert "authorization=" in url and "top-secret" not in url

def test_xunfei_asr_and_tts_protocols(monkeypatch):
    class FakeSocket:
        def __init__(self, responses): self.responses, self.sent = responses, []
        async def send(self, payload): self.sent.append(json.loads(payload))
        def __aiter__(self):
            async def iterate():
                for response in self.responses: yield json.dumps(response)
            return iterate()
    class Connection:
        def __init__(self, socket): self.socket = socket
        async def __aenter__(self): return self.socket
        async def __aexit__(self, *args): return None
    sockets = [
        FakeSocket([{"code": 0, "data": {"status": 2, "result": {"ls": True, "ws": [{"cw": [{"w": "你好"}]}]}}}]),
        FakeSocket([{"code": 0, "data": {"status": 2, "audio": base64.b64encode(b"\x00\x00" * 10).decode()}}])
    ]
    monkeypatch.setattr("backend.app.speech.xunfei.websockets.connect", lambda *args, **kwargs: Connection(sockets.pop(0)))
    provider = XunfeiSpeechProvider(app_id="app", api_key="key", api_secret="secret", speakers={"BLACK": "voice"})
    assert run(provider.transcribe(make_wav(640), "asr")).text == "你好"
    result = run(provider.synthesize("回复", "BLACK", "tts"))
    assert result.audio.startswith(b"RIFF") and result.sample_rate == 16000

def test_volcengine_cancellation_propagates():
    async def scenario():
        async def handler(_: httpx.Request) -> httpx.Response:
            await asyncio.sleep(60)
            return httpx.Response(200)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = VolcengineSpeechProvider(api_key="key", speakers={}, client=client)
            task = asyncio.create_task(provider.transcribe(make_wav(), "cancel"))
            await asyncio.sleep(0)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
    run(scenario())

def test_speech_service_cancels_provider_task():
    from backend.app.speech.service import SpeechService
    class SlowProvider:
        async def transcribe(self, audio, request_id):
            await asyncio.sleep(60)
        async def synthesize(self, text, character_id, request_id):
            await asyncio.sleep(60)
    async def scenario():
        provider = SlowProvider()
        service = SpeechService(provider, provider, AudioStore())
        task = asyncio.create_task(service.transcribe(make_wav(), "request-cancel"))
        await asyncio.sleep(0)
        with pytest.raises(SpeechProviderError) as busy:
            await service.synthesize("text", "BLACK", "request-cancel")
        assert busy.value.error_code == "SPEECH_REQUEST_BUSY"
        assert service.cancel("request-cancel") is True
        with pytest.raises(asyncio.CancelledError): await task
        assert "request-cancel" not in service.active_tasks
    run(scenario())

def test_volcengine_maps_rate_limit_timeout_and_empty_tts():
    async def scenario():
        async def limited(_: httpx.Request) -> httpx.Response:
            return httpx.Response(200, headers={"X-Api-Status-Code": "55000031"}, json={})
        async with httpx.AsyncClient(transport=httpx.MockTransport(limited)) as client:
            provider = VolcengineSpeechProvider(api_key="key", speakers={"BLACK": "voice"}, client=client)
            with pytest.raises(SpeechProviderError) as error:
                await provider.transcribe(make_wav(), "limited")
            assert error.value.error_code == "ASR_RATE_LIMITED"

        async def timeout(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("timeout", request=request)
        async with httpx.AsyncClient(transport=httpx.MockTransport(timeout)) as client:
            provider = VolcengineSpeechProvider(api_key="key", speakers={"BLACK": "voice"}, client=client)
            with pytest.raises(SpeechProviderError) as error:
                await provider.transcribe(make_wav(), "timeout")
            assert error.value.error_code == "ASR_TIMEOUT"

        async def empty(_: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text=json.dumps({"code": 20000000, "data": None}))
        async with httpx.AsyncClient(transport=httpx.MockTransport(empty)) as client:
            provider = VolcengineSpeechProvider(api_key="key", speakers={"BLACK": "voice"}, client=client)
            with pytest.raises(SpeechProviderError) as error:
                await provider.synthesize("回复", "BLACK", "empty")
            assert error.value.error_code == "TTS_EMPTY_RESULT"
    run(scenario())

def test_audio_store_expires_assets():
    store = AudioStore(ttl_seconds=0)
    item = store.put(SynthesisResult(make_wav(), "audio/wav", 16000))
    assert store.pop(item.audio_id) is None
def test_volcengine_maps_empty_and_invalid_audio_statuses():
    async def scenario(status_code: str, expected: str):
        async def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(200, headers={"X-Api-Status-Code": status_code}, json={})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = VolcengineSpeechProvider(api_key="key", speakers={}, client=client)
            with pytest.raises(SpeechProviderError) as error:
                await provider.transcribe(make_wav(), status_code)
            assert error.value.error_code == expected
    run(scenario("45000002", "ASR_EMPTY_AUDIO"))
    run(scenario("45000151", "ASR_INVALID_AUDIO"))
def test_volcengine_maps_detailed_tts_failures():
    cases = [
        (55000000, "resource ID is mismatched with speaker related resource", "TTS_INVALID_REQUEST"),
        (55000000, "quota exceeded for types: concurrency", "TTS_RATE_LIMITED"),
        (3030, "processing timeout", "TTS_TIMEOUT"),
        (3050, "speaker not found", "TTS_INVALID_REQUEST"),
    ]
    for code, message, expected in cases:
        with pytest.raises(SpeechProviderError) as error:
            VolcengineSpeechProvider._raise_provider_code(code, "TTS", message)
        assert error.value.error_code == expected
