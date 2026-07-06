# Phase 8.5 status

Phase 8.5 adds controlled, cross-session long-term memory.

- SQLite schema version 2 stores pending and active global memories with categories, keywords, importance, pin state and source request metadata.
- Explicit remember, update and forget actions are L2 tools and show the exact memory content before execution.
- Ordinary visible user messages use a local heuristic before asynchronous LLM candidate extraction. Candidates are inert until approved.
- Recall is local and structured, limited to 12 items and 2,000 characters. Memories are treated as untrusted user data and cannot override tool policy or persona.
- Kuro, Shiro and Vanguard share approved memories across all sessions.
- The Chinese memory panel supports paging, manual creation, candidate editing and approval, pinning and permanent deletion.
- Credential-like and identifier data is rejected. Logs and tool audits contain no memory body.
- Permanent deletion enables SQLite secure deletion and truncates the WAL.

Run `npm run verify:m6-5` for the complete acceptance suite. No installer is produced in this phase.