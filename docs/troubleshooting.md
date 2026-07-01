# Troubleshooting

## Backend shows `failed`

1. Confirm `python --version` is available to Electron, or set `AGENT_PYTHON` to the interpreter path.
2. Run `python -m backend.app.main` only with `AGENT_AUTH_TOKEN` set to at least 32 characters.
3. Check Electron logs under the application user-data `logs/main.log` and backend logs under `logs/backend/backend.log`.

## WebSocket echo fails

- Confirm the diagnostics panel reports `ready` and a numeric port.
- The client must request both `agent.v1` and the one-time token as WebSocket subprotocols.
- Restart Electron to obtain a fresh connection after a Sidecar restart.

## Test commands

- Full M1 gate: `npm run verify:m1`
- Packaged lifecycle smoke test: `npm run smoke:electron`
