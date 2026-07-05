from __future__ import annotations
import asyncio
import base64
import hashlib
import hmac
import json
from email.utils import formatdate
from urllib.parse import quote, urlparse
import websockets
from .base import SpeechProviderError, SynthesisResult, TranscriptionResult
from .wav import pcm_to_wav

class XunfeiSpeechProvider:
    def __init__(self, *, app_id: str, api_key: str, api_secret: str, speakers: dict[str, str], timeout_seconds: float = 30,
                 asr_url: str = "wss://iat-api.xfyun.cn/v2/iat", tts_url: str = "wss://tts-api.xfyun.cn/v2/tts") -> None:
        self.app_id, self.api_key, self.api_secret = app_id, api_key, api_secret
        self.speakers, self.timeout_seconds = speakers, timeout_seconds
        self.asr_url, self.tts_url = asr_url, tts_url

    def _require_config(self, character_id: str | None = None) -> None:
        if not all((self.app_id, self.api_key, self.api_secret)) or (character_id and not self.speakers.get(character_id)):
            raise SpeechProviderError("SPEECH_PROVIDER_NOT_CONFIGURED", "尚未完整配置讯飞语音服务")

    def _authenticated_url(self, endpoint: str) -> str:
        parsed = urlparse(endpoint)
        date = formatdate(usegmt=True)
        origin = f"host: {parsed.netloc}\ndate: {date}\nGET {parsed.path} HTTP/1.1"
        signature = base64.b64encode(hmac.new(self.api_secret.encode(), origin.encode(), hashlib.sha256).digest()).decode()
        authorization = base64.b64encode(f'api_key="{self.api_key}", algorithm="hmac-sha256", headers="host date request-line", signature="{signature}"'.encode()).decode()
        return f"{endpoint}?authorization={quote(authorization)}&date={quote(date)}&host={parsed.netloc}"

    async def transcribe(self, audio: bytes, request_id: str) -> TranscriptionResult:
        self._require_config()
        pcm = audio[44:]
        text_parts: list[str] = []
        async def run() -> None:
            async with websockets.connect(self._authenticated_url(self.asr_url), max_size=2**22) as socket:
                chunks = [pcm[i:i + 1280] for i in range(0, len(pcm), 1280)]
                for index, chunk in enumerate(chunks):
                    frame = {"data": {"status": 0 if index == 0 else 1, "format": "audio/L16;rate=16000", "encoding": "raw", "audio": base64.b64encode(chunk).decode()}}
                    if index == 0:
                        frame.update({"common": {"app_id": self.app_id}, "business": {"language": "zh_cn", "domain": "iat", "accent": "mandarin", "vad_eos": 5000}})
                    await socket.send(json.dumps(frame))
                    await asyncio.sleep(0.04)
                await socket.send(json.dumps({"data": {"status": 2, "format": "audio/L16;rate=16000", "encoding": "raw", "audio": ""}}))
                async for message in socket:
                    payload = json.loads(message)
                    if payload.get("code") != 0:
                        raise SpeechProviderError("ASR_PROVIDER_ERROR", "讯飞语音识别返回错误")
                    result = payload.get("data", {}).get("result", {})
                    part = "".join(candidate["cw"][0]["w"] for candidate in result.get("ws", []) if candidate.get("cw"))
                    if part:
                        text_parts.append(part)
                    if result.get("ls") or payload.get("data", {}).get("status") == 2:
                        break
        try:
            await asyncio.wait_for(run(), self.timeout_seconds)
        except asyncio.TimeoutError as error:
            raise SpeechProviderError("ASR_TIMEOUT", "语音识别超时") from error
        except SpeechProviderError:
            raise
        except Exception as error:
            raise SpeechProviderError("ASR_UNAVAILABLE", "无法连接讯飞语音识别服务") from error
        text = "".join(text_parts).strip()
        if not text:
            raise SpeechProviderError("ASR_EMPTY_RESULT", "没有识别到可用文字")
        return TranscriptionResult(text)

    async def synthesize(self, text: str, character_id: str, request_id: str) -> SynthesisResult:
        self._require_config(character_id)
        chunks: list[bytes] = []
        request = {"common": {"app_id": self.app_id}, "business": {"aue": "raw", "auf": "audio/L16;rate=16000", "vcn": self.speakers[character_id], "tte": "UTF8", "speed": 50, "volume": 80, "pitch": 50}, "data": {"status": 2, "text": base64.b64encode(text.encode()).decode()}}
        async def run() -> None:
            async with websockets.connect(self._authenticated_url(self.tts_url), max_size=2**22) as socket:
                await socket.send(json.dumps(request))
                async for message in socket:
                    payload = json.loads(message)
                    if payload.get("code") != 0:
                        raise SpeechProviderError("TTS_PROVIDER_ERROR", "讯飞语音合成返回错误")
                    encoded = payload.get("data", {}).get("audio")
                    if encoded:
                        chunks.append(base64.b64decode(encoded))
                    if payload.get("data", {}).get("status") == 2:
                        break
        try:
            await asyncio.wait_for(run(), self.timeout_seconds)
        except asyncio.TimeoutError as error:
            raise SpeechProviderError("TTS_TIMEOUT", "语音合成超时") from error
        except SpeechProviderError:
            raise
        except Exception as error:
            raise SpeechProviderError("TTS_UNAVAILABLE", "无法连接讯飞语音合成服务") from error
        if not chunks:
            raise SpeechProviderError("TTS_EMPTY_RESULT", "语音合成没有返回音频")
        return SynthesisResult(pcm_to_wav(b"".join(chunks), 16000), "audio/wav", 16000)
