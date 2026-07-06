from __future__ import annotations
import json
import shutil
import sqlite3
import threading
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

SCHEMA_VERSION = 1

class DatabaseError(RuntimeError):
    pass

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()

class SQLiteStore:
    def __init__(self, data_dir: Path, legacy_audit_logger: logging.Logger | None = None) -> None:
        self.data_dir, self.path = data_dir, data_dir / "agent.db"
        self.legacy_audit_logger = legacy_audit_logger
        self._lock = threading.RLock()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5, isolation_level=None, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=5000")
        connection.execute("PRAGMA journal_mode=WAL")
        return connection

    def initialize(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        with self._lock, self.connect() as connection:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise DatabaseError(f"SQLite integrity check failed: {integrity}")
            current = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if current > SCHEMA_VERSION:
                raise DatabaseError(f"Database schema {current} is newer than supported {SCHEMA_VERSION}")
            if current and current < SCHEMA_VERSION:
                shutil.copy2(self.path, self.path.with_suffix(f".v{current}.bak"))
            if current < 1:
                try:
                    connection.executescript("""
                    BEGIN IMMEDIATE;
                    CREATE TABLE schema_version(version INTEGER NOT NULL, applied_at TEXT NOT NULL);
                    CREATE TABLE sessions(
                      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '新会话', summary TEXT NOT NULL DEFAULT '',
                      archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    );
                    CREATE TABLE requests(
                      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), character_id TEXT NOT NULL,
                      interaction_type TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT,
                      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    );
                    CREATE TABLE messages(
                      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), request_id TEXT NOT NULL REFERENCES requests(id),
                      role TEXT NOT NULL, character_id TEXT NOT NULL, content TEXT NOT NULL, visible INTEGER NOT NULL,
                      created_at TEXT NOT NULL
                    );
                    CREATE INDEX messages_session_idx ON messages(session_id, created_at);
                    CREATE TABLE settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
                    CREATE TABLE tool_audits(
                      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, session_id TEXT NOT NULL,
                      request_id TEXT NOT NULL, tool_call_id TEXT NOT NULL, tool_name TEXT NOT NULL,
                      risk_level TEXT NOT NULL, status TEXT NOT NULL, duration_ms REAL NOT NULL,
                      resource TEXT NOT NULL, argument_keys TEXT NOT NULL, error_code TEXT, confirmation_result TEXT
                    );
                    CREATE INDEX audit_request_idx ON tool_audits(request_id, timestamp);
                    INSERT INTO schema_version(version, applied_at) VALUES(1, CURRENT_TIMESTAMP);
                    PRAGMA user_version=1;
                    COMMIT;
                    """)
                except Exception as error:
                    try:
                        connection.execute("ROLLBACK")
                    except sqlite3.Error:
                        pass
                    raise DatabaseError(f"Database migration failed: {error}") from error
            connection.execute(
                "UPDATE requests SET status='interrupted', error_code='BACKEND_RESTARTED', updated_at=? "
                "WHERE status IN ('running','confirming')", (utc_now(),)
            )

    @property
    def schema_version(self) -> int:
        with self.connect() as connection:
            return int(connection.execute("PRAGMA user_version").fetchone()[0])

    def create_session(self, session_id: str | None = None) -> dict[str, Any]:
        now, session_id = utc_now(), session_id or str(uuid4())
        with self.connect() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO sessions(id,title,summary,created_at,updated_at) VALUES(?,?,?,?,?)",
                (session_id, "新会话", "", now, now),
            )
            row = connection.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
        return dict(row)

    def list_sessions(self, archived: bool = False) -> list[dict[str, Any]]:
        clause = "archived_at IS NOT NULL" if archived else "archived_at IS NULL"
        with self.connect() as connection:
            rows = connection.execute(f"SELECT * FROM sessions WHERE {clause} ORDER BY updated_at DESC").fetchall()
        return [dict(row) for row in rows]

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
        return dict(row) if row else None

    def update_session(self, session_id: str, *, title: str | None = None, archived: bool | None = None) -> dict[str, Any] | None:
        updates, values = [], []
        if title is not None:
            updates.append("title=?")
            values.append(title.strip())
        if archived is not None:
            updates.append("archived_at=?")
            values.append(utc_now() if archived else None)
        if not updates:
            return self.get_session(session_id)
        updates.append("updated_at=?")
        values.extend([utc_now(), session_id])
        with self.connect() as connection:
            connection.execute(f"UPDATE sessions SET {', '.join(updates)} WHERE id=?", values)
        return self.get_session(session_id)

    def get_messages(self, session_id: str, *, visible_only: bool = True, limit: int = 500) -> list[dict[str, Any]]:
        visible = "AND visible=1" if visible_only else ""
        with self.connect() as connection:
            rows = connection.execute(
                f"SELECT id,request_id,role,character_id,content,visible,created_at FROM messages "
                f"WHERE session_id=? {visible} ORDER BY rowid ASC LIMIT ?", (session_id, limit)
            ).fetchall()
        return [dict(row) for row in rows]

    def load_context(self, session_id: str, limit: int) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT role,character_id,content FROM (SELECT role,character_id,content,rowid AS message_order FROM messages "
                "WHERE session_id=? ORDER BY rowid DESC LIMIT ?) ORDER BY message_order ASC", (session_id, limit)
            ).fetchall()
        return [dict(row) for row in rows]

    def begin_request(self, request_id: str, session_id: str, character_id: str, interaction_type: str) -> dict[str, Any]:
        self.create_session(session_id)
        now = utc_now()
        with self.connect() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO requests(id,session_id,character_id,interaction_type,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (request_id, session_id, character_id, interaction_type, "running", now, now),
            )
            row = connection.execute("SELECT * FROM requests WHERE id=?", (request_id,)).fetchone()
        return dict(row)

    def set_request_status(self, request_id: str, status: str, error_code: str | None = None) -> None:
        with self.connect() as connection:
            connection.execute("UPDATE requests SET status=?,error_code=?,updated_at=? WHERE id=?", (status, error_code, utc_now(), request_id))

    def complete_request(self, request_id: str, user_content: str, assistant_content: str) -> None:
        now = utc_now()
        with self._lock, self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            request = connection.execute("SELECT * FROM requests WHERE id=?", (request_id,)).fetchone()
            if not request:
                connection.execute("ROLLBACK")
                raise DatabaseError("Request does not exist")
            visible_user = request["interaction_type"] == "message"
            connection.execute(
                "INSERT INTO messages(id,session_id,request_id,role,character_id,content,visible,created_at) VALUES(?,?,?,?,?,?,?,?)",
                (str(uuid4()), request["session_id"], request_id, "user", request["character_id"], user_content, int(visible_user), now),
            )
            connection.execute(
                "INSERT INTO messages(id,session_id,request_id,role,character_id,content,visible,created_at) VALUES(?,?,?,?,?,?,1,?)",
                (str(uuid4()), request["session_id"], request_id, "assistant", request["character_id"], assistant_content, now),
            )
            session = connection.execute("SELECT title FROM sessions WHERE id=?", (request["session_id"],)).fetchone()
            title = user_content.strip()[:40] if visible_user and session["title"] == "新会话" else session["title"]
            connection.execute("UPDATE sessions SET title=?,summary=?,updated_at=? WHERE id=?", (title, assistant_content.strip()[:120], now, request["session_id"]))
            connection.execute("UPDATE requests SET status='completed',error_code=NULL,updated_at=? WHERE id=?", (now, request_id))
            connection.execute("COMMIT")

    def get_request(self, request_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT r.*,m.content AS assistant_content FROM requests r LEFT JOIN messages m "
                "ON m.request_id=r.id AND m.role='assistant' WHERE r.id=?", (request_id,)
            ).fetchone()
        return dict(row) if row else None

    def get_settings(self) -> dict[str, Any]:
        with self.connect() as connection:
            rows = connection.execute("SELECT key,value_json FROM settings").fetchall()
        return {row["key"]: json.loads(row["value_json"]) for row in rows}

    def update_settings(self, values: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            for key, value in values.items():
                connection.execute(
                    "INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) "
                    "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
                    (key, json.dumps(value, ensure_ascii=False), now),
                )
            connection.execute("COMMIT")
        return self.get_settings()

    def write_audit(self, payload: dict[str, Any]) -> None:
        if self.legacy_audit_logger is not None:
            from backend.app.tools.audit import write_audit
            write_audit(self.legacy_audit_logger, payload)
        with self.connect() as connection:
            connection.execute(
                "INSERT INTO tool_audits(timestamp,session_id,request_id,tool_call_id,tool_name,risk_level,status,duration_ms,resource,argument_keys,error_code,confirmation_result) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (payload["timestamp"], payload["session_id"], payload["request_id"], payload["tool_call_id"], payload["tool_name"],
                 payload["risk_level"], payload["status"], payload["duration_ms"], payload["resource"],
                 json.dumps(payload["argument_keys"]), payload.get("error_code"), payload.get("confirmation_result")),
            )

    def list_audits(self, request_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        sql, params = "SELECT * FROM tool_audits", []
        if request_id:
            sql += " WHERE request_id=?"
            params.append(request_id)
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(min(max(limit, 1), 200))
        with self.connect() as connection:
            rows = connection.execute(sql, params).fetchall()
        return [dict(row) for row in rows]
