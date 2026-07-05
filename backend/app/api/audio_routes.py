from __future__ import annotations

import asyncio
import logging
import re
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.app.api.auth import require_http_token
from backend.app.core.config import Settings
from backend.app.speech import SpeechProviderError, SpeechService
from backend.app.speech.wav import inspect_wav

MAX_ASR_BYTES = 4 * 1024 * 1024
MAX_ASR_DURATION_MS = 60_000
MAX_TTS_TEXT = 2_000
MAX_TTS_BYTES = 10 * 1024 * 1024
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
logger = logging.getLogger("speech")


class TTSRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=MAX_TTS_TEXT)
    character_id: str = Field(pattern=r"^(BLACK|WHITE|SOLDIER)$")

    @field_validator("text")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("text must contain visible characters")
        return stripped


def _request_id(value: str | None) -> str:
    return value if value and REQUEST_ID_PATTERN.fullmatch(value) else str(uuid4())


def _status(error: SpeechProviderError) -> int:
    if error.error_code in {"SPEECH_CANCELLED", "SPEECH_REQUEST_BUSY"}:
        return 409
    if error.error_code.endswith("AUTH_FAILED"):
        return 401
    if error.error_code.endswith("RATE_LIMITED"):
        return 429
    if error.error_code.endswith("TIMEOUT"):
        return 504
    if error.error_code in {
        "ASR_INVALID_AUDIO",
        "ASR_EMPTY_AUDIO",
        "ASR_SILENT_AUDIO",
        "ASR_EMPTY_RESULT",
        "TTS_INVALID_REQUEST",
    }:
        return 422
    return 503


def _error(error: SpeechProviderError, request_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=_status(error),
        content={
            "error_code": error.error_code,
            "message": error.message,
            "recoverable": error.recoverable,
            "request_id": request_id,
        },
    )


def create_audio_router(settings: Settings, speech: SpeechService) -> APIRouter:
    router = APIRouter(prefix="/api/v1/audio", dependencies=[Depends(require_http_token(settings))])

    @router.post("/asr")
    async def transcribe(request: Request, x_request_id: str | None = Header(default=None)):
        request_id = _request_id(x_request_id)
        audio = await request.body()
        if len(audio) > MAX_ASR_BYTES:
            return _error(SpeechProviderError("ASR_INVALID_AUDIO", "录音文件过大"), request_id)
        try:
            info = inspect_wav(audio)
            if info.duration_ms > MAX_ASR_DURATION_MS:
                raise SpeechProviderError("ASR_INVALID_AUDIO", "单次录音不能超过 60 秒")
            result = await speech.transcribe(audio, request_id)
            logger.info("speech.asr.completed", extra={"request_id": request_id})
            return {
                "text": result.text,
                "language": result.language,
                "duration_ms": info.duration_ms,
                "sample_rate": info.sample_rate,
                "channels": info.channels,
            }
        except asyncio.CancelledError:
            return _error(SpeechProviderError("SPEECH_CANCELLED", "语音请求已取消"), request_id)
        except SpeechProviderError as error:
            logger.warning("speech.asr.failed code=%s", error.error_code, extra={"request_id": request_id})
            return _error(error, request_id)

    @router.post("/tts")
    async def synthesize(payload: TTSRequest, x_request_id: str | None = Header(default=None)):
        request_id = _request_id(x_request_id)
        try:
            result = await speech.synthesize(payload.text, payload.character_id, request_id)
            if len(result.audio) > MAX_TTS_BYTES:
                raise SpeechProviderError("TTS_INVALID_RESPONSE", "语音合成结果过大")
            stored = speech.store.put(result)
            logger.info("speech.tts.completed", extra={"request_id": request_id})
            return {
                "audio_id": stored.audio_id,
                "mime_type": result.mime_type,
                "sample_rate": result.sample_rate,
                "channels": result.channels,
                "expires_at": stored.expires_at.isoformat(),
            }
        except asyncio.CancelledError:
            return _error(SpeechProviderError("SPEECH_CANCELLED", "语音请求已取消"), request_id)
        except SpeechProviderError as error:
            logger.warning("speech.tts.failed code=%s", error.error_code, extra={"request_id": request_id})
            return _error(error, request_id)

    @router.post("/cancel/{request_id}")
    async def cancel_speech(request_id: str):
        cancelled = speech.cancel(request_id)
        logger.info("speech.cancel requested=%s", cancelled, extra={"request_id": request_id})
        return {"request_id": request_id, "cancelled": cancelled}

    @router.get("/{audio_id}")
    async def get_audio(audio_id: str):
        stored = speech.store.pop(audio_id)
        if stored is None:
            return JSONResponse(
                status_code=404,
                content={
                    "error_code": "AUDIO_NOT_FOUND",
                    "message": "音频不存在或已过期",
                    "recoverable": True,
                    "request_id": audio_id,
                },
            )
        return Response(
            content=stored.result.audio,
            media_type=stored.result.mime_type,
            headers={
                "Cache-Control": "no-store",
                "X-Audio-Sample-Rate": str(stored.result.sample_rate),
                "X-Audio-Channels": str(stored.result.channels),
            },
        )

    return router
