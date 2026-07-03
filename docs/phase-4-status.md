# Phase 4 status (M2)

Completed on 2026-07-03.

## Delivered

- OpenAI-compatible Python LLM Provider with DeepSeek defaults, SSE streaming and normalized provider errors.
- Agent Runtime with backend-owned character prompts, per-character in-memory history, bounded context and commit-on-success semantics.
- Concurrent WebSocket handling for streamed deltas, final messages, cancellation, busy rejection and connection cleanup.
- Renderer AgentClient with correlation IDs, streamed message updates, real backend cancellation and recoverable UI errors.
- LLM credentials moved out of Renderer into `backend/.env.local` for development and `%APPDATA%\Garfield Chat\backend.env` for packaged builds.
- Speech recognition and synthesis isolated from the LLM boundary; missing or failed TTS never blocks text chat.
- Removed the former model SDK, direct Renderer model paths, key-selection UI, remote import map, model constants and stale documentation.
- Build cleanup now removes only the approved `dist` and `release` directories before rebuilding, preventing old hashed bundles from entering packages.

## Verified

- `npm run verify:m2` passes contract generation, TypeScript, source-boundary, production build, secret scan, 12 backend tests, 4 Sidecar tests and 4 Renderer tests.
- The production Renderer contains one 308.90 kB JavaScript bundle.
- `npm run electron:build` produces the Windows NSIS installer.
- `npm run smoke:electron` confirms packaged startup and no residual Sidecar process.
- Source and packaged-resource scans contain none of the removed integration identifiers.
- The packaged backend contains no `.env`, `.env.local` or `backend.env` secret file.

## Manual acceptance

Add `LLM_API_KEY` to `backend/.env.local`, then verify two turns for each character, visible streaming, Stop cancellation and a retry after a forced invalid endpoint or timeout. Do not commit the local environment file.