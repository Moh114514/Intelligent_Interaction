from __future__ import annotations
from .base import ASRProvider, SpeechProviderError, SynthesisResult, TTSProvider, TranscriptionResult
from .service import SpeechService
from .store import AudioStore
from .volcengine import VolcengineSpeechProvider
from .xunfei import XunfeiSpeechProvider


def create_speech_service(settings) -> SpeechService:
    speakers = {
        "BLACK": settings.speech_voice_black,
        "WHITE": settings.speech_voice_white,
        "SOLDIER": settings.speech_voice_soldier,
    }
    if settings.speech_provider == "xunfei":
        provider = XunfeiSpeechProvider(
            app_id=settings.xunfei_app_id,
            api_key=settings.xunfei_api_key,
            api_secret=settings.xunfei_api_secret,
            speakers=speakers,
            timeout_seconds=settings.speech_timeout_seconds,
            asr_url=settings.xunfei_asr_url,
            tts_url=settings.xunfei_tts_url,
        )
    elif settings.speech_provider == "volcengine":
        provider = VolcengineSpeechProvider(
            api_key=settings.volcengine_speech_api_key,
            app_id=settings.volcengine_app_id,
            access_token=settings.volcengine_access_token,
            auth_mode=settings.volcengine_auth_mode,
            speakers=speakers,
            timeout_seconds=settings.speech_timeout_seconds,
            asr_url=settings.volcengine_asr_url,
            tts_url=settings.volcengine_tts_url,
            asr_resource_id=settings.volcengine_asr_resource_id,
            tts_resource_id=settings.volcengine_tts_resource_id,
        )
    else:
        raise ValueError("SPEECH_PROVIDER must be volcengine or xunfei")
    return SpeechService(provider, provider, AudioStore(settings.speech_audio_ttl_seconds))

__all__ = ["ASRProvider", "TTSProvider", "SpeechProviderError", "SynthesisResult", "TranscriptionResult", "SpeechService", "create_speech_service"]
