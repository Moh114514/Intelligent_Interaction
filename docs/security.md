# Security baseline

- `.env.local` and `api.config.ts` are local-only and ignored by Git.
- Production Vite builds replace `api.config.ts` with `api.config.example.ts` and do not inject `GEMINI_API_KEY`.
- `npm run security:scan` rejects common key formats and any exact credential values found in local configuration files.
- Development mode temporarily retains the legacy direct-provider path so phase 0-1 behavior can be verified.
- Production provider credentials must not be restored to Renderer. Phase 4 moves LLM credentials to the authenticated Python sidecar; phase 7 does the same for ASR/TTS.

Any credential that existed in a historical bundle must be revoked at its provider. Removing it from the repository or rebuilding does not revoke it.
