# Garfield Chat

Garfield Chat is a Windows Electron application with a React renderer and an authenticated local Python Agent sidecar.

## Architecture

- Electron owns the Python sidecar lifecycle, random loopback port and one-time authentication token.
- React renders conversations, character state and diagnostics.
- Python owns LLM credentials, character prompts, multi-turn history, streaming and cancellation.
- Text generation uses an OpenAI-compatible provider; the default configuration targets DeepSeek.
- Speech recognition and synthesis remain separate Renderer services until phase 7.

## Development

1. Install JavaScript dependencies with `npm ci`.
2. Install Python dependencies from `backend/pyproject.toml`.
3. Copy `backend/.env.example` to `backend/.env.local` and set `LLM_API_KEY`.
4. Run `npm run dev`.
5. In another terminal run `npm run electron:dev`.

Do not place LLM credentials in root `.env.local`, `api.config.ts`, Vite variables or Renderer code.

## Configuration

Python Agent configuration:

- `LLM_API_KEY`
- `LLM_BASE_URL` (default `https://api.deepseek.com/v1`)
- `LLM_MODEL` (default `deepseek-chat`)
- `LLM_TIMEOUT_SECONDS` (default `30`)
- `LLM_MAX_HISTORY_MESSAGES` (default `20`)

Development reads `backend/.env.local`. Packaged builds read `%APPDATA%\Garfield Chat\backend.env`.

Speech credentials remain in ignored `api.config.ts` until their phase 7 migration.

## Verification

- `npm run verify:m1`: M1 regression suite
- `npm run test:renderer`: AgentClient and streaming UI tests
- `npm run verify:m2`: complete M2 suite
- `npm run electron:build`: Windows installer build
- `npm run smoke:electron`: packaged startup and sidecar cleanup test