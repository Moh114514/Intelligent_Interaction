from __future__ import annotations
from dataclasses import dataclass
from typing import Protocol

class SpeechProviderError(Exception):
    def __init__(self, error_code: str, message: str, recoverable: bool = True) -> None:
        super().__init__(message)
        self.error_code, self.message, self.recoverable = error_code, message, recoverable

@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    language: str = "zh-CN"

@dataclass(frozen=True)
class SynthesisResult:
    audio: bytes
    mime_type: str
    sample_rate: int
    channels: int = 1

class ASRProvider(Protocol):
    async def transcribe(self, audio: bytes, request_id: str) -> TranscriptionResult: ...

class TTSProvider(Protocol):
    async def synthesize(self, text: str, character_id: str, request_id: str) -> SynthesisResult: ...
