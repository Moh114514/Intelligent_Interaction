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
            host=host,
            port=int(os.getenv("AGENT_PORT", "8765")),
            auth_token=token,
            log_dir=Path(os.getenv("AGENT_LOG_DIR", "backend/logs")),
            log_level=os.getenv("AGENT_LOG_LEVEL", "INFO").upper(),
            llm_api_key=os.getenv("LLM_API_KEY", ""),
            llm_base_url=os.getenv("LLM_BASE_URL", "https://api.deepseek.com"),
            llm_model=os.getenv("LLM_MODEL", "deepseek-v4-flash"),
            llm_timeout_seconds=float(os.getenv("LLM_TIMEOUT_SECONDS", "30")),
            llm_max_history_messages=max(2, int(os.getenv("LLM_MAX_HISTORY_MESSAGES", "20"))),
            tool_shared_root=Path(os.getenv("TOOL_SHARED_ROOT", str(Path.home() / "Documents" / "Garfield Chat Shared"))),
            agent_max_tool_steps=max(1, int(os.getenv("AGENT_MAX_TOOL_STEPS", "5"))),
            tool_timeout_seconds=max(0.1, float(os.getenv("TOOL_TIMEOUT_SECONDS", "10"))),
            tool_confirmation_timeout_seconds=max(1, float(os.getenv("TOOL_CONFIRMATION_TIMEOUT_SECONDS", "30"))),
        )
