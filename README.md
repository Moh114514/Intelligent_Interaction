# Garfield Chat

Garfield Chat is a Windows Electron application with a React renderer and an authenticated local Python Agent sidecar.

## Architecture

- Electron owns the Python sidecar lifecycle, random loopback port and one-time authentication token.
- React renders conversations, character state, diagnostics and selectable CSS/Three.js avatar modes.
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
- `AGENT_MAX_TOOL_STEPS` (default `5`)
- `TOOL_TIMEOUT_SECONDS` (default `10`)
- `TOOL_CONFIRMATION_TIMEOUT_SECONDS` (default `30`)
- `TOOL_SHARED_ROOT` (legacy shared-directory default: `%USERPROFILE%\Documents\Garfield Chat Shared`)

Development reads `backend/.env.local`. Packaged builds read `%APPDATA%\Garfield Chat\backend.env`.

Speech credentials remain in ignored `api.config.ts` until their phase 7 migration.

## Local tools

The Python Agent exposes only allowlisted tools. Time and basic system information are L0. Approved URL/application opening and clipboard reads are L1. Fixed-drive filename search, file reads, text-file creation/replacement and clipboard writes are L2 and always require one-time confirmation.

Search resolves exact absolute paths immediately or uses prioritized breadth-first filename discovery across non-sensitive local fixed drives. It returns short-lived file IDs and skips system, application-data, credential, hidden and reparse-point locations. Reads accept only those IDs: UTF-8 text and supported PDF/Office documents yield bounded text, while media yields metadata only.

Text creation accepts an approved absolute path; replacement requires a searched file ID, verifies that the file has not changed, creates a timestamped backup and then atomically replaces it. The Agent cannot delete, move, rename, execute or write binary files. Audit logs contain statuses and redacted targets, never file or clipboard content.

## Avatar modes

CSS cats and the Three.js Vanguard character are peer renderers selected explicitly by the user. Three.js is the first-run default; an existing `unity` preference is migrated automatically, and the last selection is stored locally. A 3D load error exposes retry and manual CSS-switch actions without interrupting chat.

The ignored `3D模型/` directory remains the user-provided upstream Unity project. Its FBX model, Talking clip and textures are converted once with `scripts/convert-vanguard.py` into the committed `public/models/vanguard-soldier.glb`. Normal development and packaging do not require Unity or Blender.

Three.js frames the complete model from its runtime bounding box and removes root/Hips translation from the Talking clip. The 3D mode uses an independent `SOLDIER` identity, session history and Vanguard veteran prompt; CSS mode retains Kuro and Shiro unchanged.

## Verification

- `npm run verify:m1`: M1 regression suite
- `npm run test:renderer`: AgentClient and streaming UI tests
- `npm run verify:m2`: complete M2 suite
- `npm run verify:m3`: complete M3 tool and M2 regression suite
- `npm run verify:m4`: complete M4 avatar and M3 regression suite
- `npm run electron:build`: Windows installer build
- `npm run smoke:electron`: packaged startup and sidecar cleanup test
