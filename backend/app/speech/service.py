from __future__ import annotations
import asyncio
from dataclasses import dataclass, field
from .base import ASRProvider, SpeechProviderError, TTSProvider, TranscriptionResult, SynthesisResult
from .store import AudioStore

@dataclass
class SpeechService:
    asr: ASRProvider
    tts: TTSProvider
    store: AudioStore
    active_tasks: dict[str, asyncio.Task] = field(default_factory=dict)

    async def transcribe(self, audio: bytes, request_id: str) -> TranscriptionResult:
        return await self._run(request_id, self.asr.transcribe(audio, request_id))

    async def synthesize(self, text: str, character_id: str, request_id: str) -> SynthesisResult:
        return await self._run(request_id, self.tts.synthesize(text, character_id, request_id))

    async def _run(self, request_id: str, awaitable):
        if request_id in self.active_tasks:
            close = getattr(awaitable, "close", None)
            if close:
                close()
            raise SpeechProviderError("SPEECH_REQUEST_BUSY", "同一语音请求正在处理中")
        task = asyncio.create_task(awaitable)
        self.active_tasks[request_id] = task
        try:
            return await task
        finally:
            self.active_tasks.pop(request_id, None)

    def cancel(self, request_id: str) -> bool:
        task = self.active_tasks.get(request_id)
        if task is None or task.done():
            return False
        task.cancel()
        return True
