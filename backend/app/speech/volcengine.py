from __future__ import annotations

import base64
import binascii
import json
from collections.abc import AsyncIterator, Mapping

import httpx

from .base import SpeechProviderError, SynthesisResult, TranscriptionResult

VOLCENGINE_ASR_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash"
VOLCENGINE_TTS_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"


class VolcengineSpeechProvider:
    def __init__(
        self,
        *,
        api_key: str = "",
        app_id: str = "",
        access_token: str = "",
        auth_mode: str = "auto",
        speakers: Mapping[str, str],
        timeout_seconds: float = 30,
        asr_url: str = VOLCENGINE_ASR_URL,
        tts_url: str = VOLCENGINE_TTS_URL,
        asr_resource_id: str = "volc.bigasr.auc_turbo",
        tts_resource_id: str = "seed-tts-2.0",
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.api_key = api_key
        self.app_id = app_id
        self.access_token = access_token
        self.auth_mode = auth_mode
        self.speakers = dict(speakers)
        self.timeout_seconds = timeout_seconds
        self.asr_url = asr_url
        self.tts_url = tts_url
        self.asr_resource_id = asr_resource_id
        self.tts_resource_id = tts_resource_id
        self._client = client

    def _resolved_auth_mode(self) -> str:
        if self.auth_mode not in {"auto", "api_key", "legacy"}:
            raise SpeechProviderError(
                "SPEECH_PROVIDER_NOT_CONFIGURED",
                "VOLCENGINE_AUTH_MODE 必须是 auto、api_key 或 legacy",
                False,
            )
        if self.auth_mode == "api_key" or (self.auth_mode == "auto" and self.api_key):
            if self.api_key:
                return "api_key"
        if self.auth_mode == "legacy" or self.auth_mode == "auto":
            if self.app_id and self.access_token:
                return "legacy"
        raise SpeechProviderError(
            "SPEECH_PROVIDER_NOT_CONFIGURED",
            "尚未配置火山引擎语音凭据；旧版控制台需要 APP ID 和 Access Token",
            False,
        )

    def _asr_headers(self, request_id: str) -> dict[str, str]:
        headers = {
            "X-Api-Resource-Id": self.asr_resource_id,
            "X-Api-Request-Id": request_id,
            "X-Api-Sequence": "-1",
        }
        if self._resolved_auth_mode() == "api_key":
            headers["X-Api-Key"] = self.api_key
        else:
            headers["X-Api-App-Key"] = self.app_id
            headers["X-Api-Access-Key"] = self.access_token
        return headers

    def _tts_headers(self, request_id: str) -> dict[str, str]:
        headers = {
            "X-Api-Resource-Id": self.tts_resource_id,
            "X-Api-Request-Id": request_id,
            "Content-Type": "application/json",
        }
        if self._resolved_auth_mode() == "api_key":
            headers["X-Api-Key"] = self.api_key
        else:
            # The V3 TTS endpoint uses App-Id, while legacy V3 ASR calls it App-Key.
            headers["X-Api-App-Id"] = self.app_id
            headers["X-Api-Access-Key"] = self.access_token
        return headers

    async def transcribe(self, audio: bytes, request_id: str) -> TranscriptionResult:
        headers = self._asr_headers(request_id)
        payload = {
            "user": {"uid": "garfield-chat"},
            "audio": {"data": base64.b64encode(audio).decode("ascii")},
            "request": {"model_name": "bigmodel", "enable_itn": True, "enable_punc": True},
        }
        try:
            response = await self._request("POST", self.asr_url, headers=headers, json=payload)
        except httpx.TimeoutException as error:
            raise SpeechProviderError("ASR_TIMEOUT", "语音识别超时") from error
        except httpx.HTTPError as error:
            raise SpeechProviderError("ASR_UNAVAILABLE", "无法连接火山引擎语音识别服务") from error
        status_code = response.headers.get("X-Api-Status-Code", "")
        self._raise_status(status_code, "ASR", response.status_code)
        try:
            text = str(response.json().get("result", {}).get("text", "")).strip()
        except (ValueError, AttributeError) as error:
            raise SpeechProviderError("ASR_INVALID_RESPONSE", "语音识别返回了无效响应") from error
        if not text:
            raise SpeechProviderError("ASR_EMPTY_RESULT", "没有识别到可用文字")
        return TranscriptionResult(text)

    async def synthesize(self, text: str, character_id: str, request_id: str) -> SynthesisResult:
        headers = self._tts_headers(request_id)
        speaker = self.speakers.get(character_id, "")
        if not speaker:
            raise SpeechProviderError("SPEECH_PROVIDER_NOT_CONFIGURED", f"尚未配置 {character_id} 的火山引擎音色")
        payload = {
            "user": {"uid": "garfield-chat"},
            "req_params": {
                "text": text,
                "speaker": speaker,
                "audio_params": {"format": "wav", "sample_rate": 24000},
            },
        }
        audio = bytearray()
        try:
            async with self._stream("POST", self.tts_url, headers=headers, json=payload) as response:
                self._raise_status("", "TTS", response.status_code)
                async for item in self._iter_json_objects(response):
                    code = int(item.get("code", 0))
                    if code not in (0, 20000000):
                        self._raise_provider_code(code, "TTS", str(item.get("message", "")))
                    chunk = item.get("data")
                    if chunk:
                        audio.extend(base64.b64decode(chunk, validate=True))
                    if code == 20000000:
                        break
        except httpx.TimeoutException as error:
            raise SpeechProviderError("TTS_TIMEOUT", "语音合成超时") from error
        except httpx.HTTPError as error:
            raise SpeechProviderError("TTS_UNAVAILABLE", "无法连接火山引擎语音合成服务") from error
        except (ValueError, binascii.Error) as error:
            raise SpeechProviderError("TTS_INVALID_RESPONSE", "语音合成返回了无效音频") from error
        if not audio:
            raise SpeechProviderError("TTS_EMPTY_RESULT", "语音合成没有返回音频")
        return SynthesisResult(bytes(audio), "audio/wav", 24000)

    @staticmethod
    async def _iter_json_objects(response: httpx.Response) -> AsyncIterator[dict[str, object]]:
        decoder = json.JSONDecoder()
        buffer = ""
        async for chunk in response.aiter_text():
            buffer += chunk
            while True:
                buffer = buffer.lstrip()
                if not buffer:
                    break
                try:
                    item, end = decoder.raw_decode(buffer)
                except json.JSONDecodeError:
                    break
                if not isinstance(item, dict):
                    raise SpeechProviderError("TTS_INVALID_RESPONSE", "语音合成返回了无效响应")
                yield item
                buffer = buffer[end:]
        if buffer.strip():
            raise SpeechProviderError("TTS_INVALID_RESPONSE", "语音合成返回了不完整响应")

    async def _request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        if self._client:
            return await self._client.request(method, url, timeout=self.timeout_seconds, **kwargs)
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            return await client.request(method, url, **kwargs)

    def _stream(self, method: str, url: str, **kwargs: object):
        if self._client:
            return self._client.stream(method, url, timeout=self.timeout_seconds, **kwargs)
        client = httpx.AsyncClient(timeout=self.timeout_seconds)
        original = client.stream(method, url, **kwargs)
        return _OwnedStream(client, original)

    @staticmethod
    def _raise_status(provider_status: str, operation: str, http_status: int) -> None:
        if provider_status == "20000000" or (not provider_status and 200 <= http_status < 300):
            return
        if http_status in (401, 403) or provider_status.startswith(("401", "403")):
            raise SpeechProviderError(f"{operation}_AUTH_FAILED", "语音平台鉴权失败", False)
        if http_status == 429 or provider_status == "55000031":
            raise SpeechProviderError(f"{operation}_RATE_LIMITED", "语音平台繁忙或额度受限")
        if provider_status == "20000003":
            raise SpeechProviderError("ASR_SILENT_AUDIO", "录音中没有检测到语音")
        if provider_status == "45000002":
            raise SpeechProviderError("ASR_EMPTY_AUDIO", "语音平台收到空音频")
        if provider_status in {"45000001", "45000151"}:
            raise SpeechProviderError("ASR_INVALID_AUDIO", "语音平台拒绝了音频格式或请求参数")
        raise SpeechProviderError(f"{operation}_PROVIDER_ERROR", "语音平台返回错误")

    @staticmethod
    def _raise_provider_code(code: int, operation: str, message: str = "") -> None:
        normalized = message.lower()
        if code in (401, 403, 40300) or "authenticate" in normalized or "access denied" in normalized:
            raise SpeechProviderError(f"{operation}_AUTH_FAILED", "语音平台鉴权失败或音色未授权", False)
        if code in (429, 3003, 55000031) or "quota exceeded" in normalized or "concurrency" in normalized:
            raise SpeechProviderError(f"{operation}_RATE_LIMITED", "语音平台繁忙或额度受限")
        if code in (3030, 3032):
            raise SpeechProviderError(f"{operation}_TIMEOUT", "语音平台处理超时")
        if code in (3001, 3010, 3011, 3050):
            raise SpeechProviderError("TTS_INVALID_REQUEST", "合成文本、音色或请求参数无效")
        if "resource id is mismatched" in normalized:
            raise SpeechProviderError("TTS_INVALID_REQUEST", "语音资源 ID 与所选音色不匹配", False)
        if code in (3005, 3031, 3040):
            raise SpeechProviderError(f"{operation}_UNAVAILABLE", "语音平台暂时不可用")
        raise SpeechProviderError(f"{operation}_PROVIDER_ERROR", "语音平台返回错误")


class _OwnedStream:
    def __init__(self, client: httpx.AsyncClient, context) -> None:
        self.client = client
        self.context = context

    async def __aenter__(self):
        return await self.context.__aenter__()

    async def __aexit__(self, *args):
        try:
            return await self.context.__aexit__(*args)
        finally:
            await self.client.aclose()
