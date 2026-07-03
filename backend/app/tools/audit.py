from __future__ import annotations

import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any


class AuditFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps(getattr(record, "audit"), ensure_ascii=False, separators=(",", ":"))


def create_audit_logger(log_dir: Path) -> logging.Logger:
    logger = logging.getLogger(f"tool_audit.{id(log_dir)}")
    logger.handlers.clear()
    logger.propagate = False
    logger.setLevel(logging.INFO)
    handler = RotatingFileHandler(
        log_dir / "tool-audit.jsonl",
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    handler.setFormatter(AuditFormatter())
    logger.addHandler(handler)
    return logger


def write_audit(logger: logging.Logger, payload: dict[str, Any]) -> None:
    logger.info("tool audit", extra={"audit": payload})
