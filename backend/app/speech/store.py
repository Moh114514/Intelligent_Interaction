from __future__ import annotations
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from .base import SynthesisResult

@dataclass(frozen=True)
class StoredAudio:
    audio_id: str
    result: SynthesisResult
    expires_at: datetime

class AudioStore:
    def __init__(self, ttl_seconds: int = 300, max_items: int = 16) -> None:
        self.ttl_seconds, self.max_items = ttl_seconds, max_items
        self._items: dict[str, tuple[float, StoredAudio]] = {}
    def put(self, result: SynthesisResult) -> StoredAudio:
        self._purge()
        while len(self._items) >= self.max_items:
            self._items.pop(next(iter(self._items)))
        audio_id = str(uuid4())
        stored = StoredAudio(audio_id, result, datetime.now(timezone.utc) + timedelta(seconds=self.ttl_seconds))
        self._items[audio_id] = (time.monotonic() + self.ttl_seconds, stored)
        return stored
    def pop(self, audio_id: str) -> StoredAudio | None:
        self._purge()
        entry = self._items.pop(audio_id, None)
        return entry[1] if entry else None
    def _purge(self) -> None:
        now = time.monotonic()
        for audio_id, (deadline, _) in list(self._items.items()):
            if deadline <= now:
                self._items.pop(audio_id, None)
