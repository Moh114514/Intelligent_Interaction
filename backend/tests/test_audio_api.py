from pathlib import Path
from fastapi.testclient import TestClient
from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.speech.base import SynthesisResult, TranscriptionResult
from backend.app.speech.service import SpeechService
from backend.app.speech.store import AudioStore
from backend.app.speech.wav import pcm_to_wav

TOKEN = "s" * 64

class FakeSpeechProvider:
    async def transcribe(self, audio: bytes, request_id: str) -> TranscriptionResult:
        assert audio.startswith(b"RIFF") and request_id
        return TranscriptionResult("识别内容")
    async def synthesize(self, text: str, character_id: str, request_id: str) -> SynthesisResult:
        assert text == "回复" and character_id == "BLACK" and request_id
        return SynthesisResult(pcm_to_wav(b"\x00\x00" * 100, 16000), "audio/wav", 16000)

def make_client() -> TestClient:
    settings = Settings(host="127.0.0.1", port=8765, auth_token=TOKEN, log_dir=Path("backend/logs/tests"))
    fake = FakeSpeechProvider()
    return TestClient(create_app(settings, speech_service=SpeechService(fake, fake, AudioStore())))

def test_audio_endpoints_require_auth_and_fill_contract():
    wav = pcm_to_wav(b"\x00\x00" * 1600, 16000)
    with make_client() as client:
        assert client.post("/api/v1/audio/asr", content=wav).status_code == 401
        headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "audio/wav", "X-Request-ID": "asr-1"}
        recognized = client.post("/api/v1/audio/asr", content=wav, headers=headers)
        assert recognized.status_code == 200
        assert recognized.json()["text"] == "识别内容"
        synthesized = client.post("/api/v1/audio/tts", json={"text": "回复", "character_id": "BLACK"},
                                  headers={"Authorization": f"Bearer {TOKEN}", "X-Request-ID": "tts-1"})
        assert synthesized.status_code == 200
        audio_id = synthesized.json()["audio_id"]
        first = client.get(f"/api/v1/audio/{audio_id}", headers={"Authorization": f"Bearer {TOKEN}"})
        assert first.status_code == 200 and first.content.startswith(b"RIFF")
        assert client.get(f"/api/v1/audio/{audio_id}", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 404


def test_audio_endpoint_rejects_invalid_format():
    with make_client() as client:
        response = client.post("/api/v1/audio/asr", content=b"not-wav", headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "audio/wav"})
        assert response.status_code == 422
        assert response.json()["error_code"] == "ASR_INVALID_AUDIO"
def test_tts_rejects_blank_text_before_provider_call():
    with make_client() as client:
        response = client.post(
            "/api/v1/audio/tts",
            json={"text": "   ", "character_id": "BLACK"},
            headers={"Authorization": f"Bearer {TOKEN}", "X-Request-ID": "blank-tts"},
        )
        assert response.status_code == 422
