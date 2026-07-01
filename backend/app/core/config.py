from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    auth_token: str
    log_dir: Path
    log_level: str = "INFO"

    @classmethod
    def from_env(cls) -> "Settings":
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
        )
