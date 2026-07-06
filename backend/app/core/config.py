from __future__ import annotations
import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    auth_token: str
    log_dir: Path
    data_dir: Path | None = None
    log_level: str = "INFO"
    llm_api_key: str = ""
    llm_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-v4-flash"
    llm_timeout_seconds: float = 30.0
    llm_max_history_messages: int = 20
    tool_shared_root: Path = Path.home() / "Documents" / "Garfield Chat Shared"
    agent_max_tool_steps: int = 5
    tool_timeout_seconds: float = 10.0
    tool_confirmation_timeout_seconds: float = 30.0
    speech_provider: str = "volcengine"
    speech_timeout_seconds: float = 30.0
    speech_audio_ttl_seconds: int = 300
    speech_voice_black: str = ""
    speech_voice_white: str = ""
    speech_voice_soldier: str = ""
    volcengine_auth_mode: str = "auto"
    volcengine_speech_api_key: str = ""
    volcengine_app_id: str = ""
    volcengine_access_token: str = ""
    volcengine_asr_url: str = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash"
    volcengine_tts_url: str = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
    volcengine_asr_resource_id: str = "volc.bigasr.auc_turbo"
    volcengine_tts_resource_id: str = "seed-tts-2.0"
    xunfei_app_id: str = ""
    xunfei_api_key: str = ""
    xunfei_api_secret: str = ""
    xunfei_asr_url: str = "wss://iat-api.xfyun.cn/v2/iat"
    xunfei_tts_url: str = "wss://tts-api.xfyun.cn/v2/tts"

    @classmethod
    def from_env(cls) -> "Settings":
        env_file = Path(os.getenv("AGENT_ENV_FILE", "backend/.env.local"))
        if env_file.is_file():
            load_dotenv(env_file, override=False)
        host = os.getenv("AGENT_HOST", "127.0.0.1")
        if host != "127.0.0.1":
            raise ValueError("The sidecar must bind to 127.0.0.1")
        token = os.getenv("AGENT_AUTH_TOKEN", "")
        if len(token) < 32:
            raise ValueError("AGENT_AUTH_TOKEN must contain at least 32 characters")
        return cls(
            host=host, port=int(os.getenv("AGENT_PORT", "8765")), auth_token=token,
            log_dir=Path(os.getenv("AGENT_LOG_DIR", "backend/logs")), data_dir=Path(os.getenv("AGENT_DATA_DIR", "backend/data")),
            log_level=os.getenv("AGENT_LOG_LEVEL", "INFO").upper(),
            llm_api_key=os.getenv("LLM_API_KEY", ""), llm_base_url=os.getenv("LLM_BASE_URL", "https://api.deepseek.com"),
            llm_model=os.getenv("LLM_MODEL", "deepseek-v4-flash"), llm_timeout_seconds=float(os.getenv("LLM_TIMEOUT_SECONDS", "30")),
            llm_max_history_messages=max(2, int(os.getenv("LLM_MAX_HISTORY_MESSAGES", "20"))),
            tool_shared_root=Path(os.getenv("TOOL_SHARED_ROOT", str(Path.home() / "Documents" / "Garfield Chat Shared"))),
            agent_max_tool_steps=max(1, int(os.getenv("AGENT_MAX_TOOL_STEPS", "5"))),
            tool_timeout_seconds=max(0.1, float(os.getenv("TOOL_TIMEOUT_SECONDS", "10"))),
            tool_confirmation_timeout_seconds=max(1, float(os.getenv("TOOL_CONFIRMATION_TIMEOUT_SECONDS", "30"))),
            speech_provider=os.getenv("SPEECH_PROVIDER", "volcengine").lower(),
            speech_timeout_seconds=max(1, float(os.getenv("SPEECH_TIMEOUT_SECONDS", "30"))),
            speech_audio_ttl_seconds=max(30, int(os.getenv("SPEECH_AUDIO_TTL_SECONDS", "300"))),
            speech_voice_black=os.getenv("SPEECH_VOICE_BLACK", ""), speech_voice_white=os.getenv("SPEECH_VOICE_WHITE", ""),
            speech_voice_soldier=os.getenv("SPEECH_VOICE_SOLDIER", ""),
            volcengine_auth_mode=os.getenv("VOLCENGINE_AUTH_MODE", "auto").lower(),
            volcengine_speech_api_key=os.getenv("VOLCENGINE_SPEECH_API_KEY", ""),
            volcengine_app_id=os.getenv("VOLCENGINE_APP_ID", ""),
            volcengine_access_token=os.getenv("VOLCENGINE_ACCESS_TOKEN", ""),
            volcengine_asr_url=os.getenv("VOLCENGINE_ASR_URL", "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash"),
            volcengine_tts_url=os.getenv("VOLCENGINE_TTS_URL", "https://openspeech.bytedance.com/api/v3/tts/unidirectional"),
            volcengine_asr_resource_id=os.getenv("VOLCENGINE_ASR_RESOURCE_ID", "volc.bigasr.auc_turbo"),
            volcengine_tts_resource_id=os.getenv("VOLCENGINE_TTS_RESOURCE_ID", "seed-tts-2.0"),
            xunfei_app_id=os.getenv("XUNFEI_APP_ID", ""), xunfei_api_key=os.getenv("XUNFEI_API_KEY", ""),
            xunfei_api_secret=os.getenv("XUNFEI_API_SECRET", ""),
            xunfei_asr_url=os.getenv("XUNFEI_ASR_URL", "wss://iat-api.xfyun.cn/v2/iat"),
            xunfei_tts_url=os.getenv("XUNFEI_TTS_URL", "wss://tts-api.xfyun.cn/v2/tts"),
        )
