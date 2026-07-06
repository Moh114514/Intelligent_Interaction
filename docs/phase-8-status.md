# Phase 8 status

Phase 8 adds SQLite-backed multi-session persistence and safe transport recovery.

- Sessions are not bound to a character. Kuro, Shiro and Vanguard share the selected session context while retaining separate personas.
- Users can create, switch, rename, archive and restore sessions. V1 exposes no permanent deletion.
- Final successful exchanges, user-facing settings, request status and redacted tool audits persist in SQLite.
- Failed, cancelled and interrupted requests do not commit conversation messages.
- WebSocket disconnects cancel in-flight work and never replay tools. A committed final response can be recovered by request ID.
- SQLite uses schema version 1, WAL, foreign keys, integrity checks and rejects newer schemas.
- Long-term user memory remains deferred to phase 8.5.

Run npm run verify:m6 for the full acceptance suite.

- Assistant text is normalized to remove repeated role-name prefixes before streaming, persistence and TTS.
- Text creation accepts a relative filename in the safe shared directory, while still requiring one-time confirmation of the target and complete content.
