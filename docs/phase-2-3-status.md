# Phase 2-3 status (M1)

Completed on 2026-07-01.

## Delivered

- FastAPI sidecar bound to `127.0.0.1` with environment-backed configuration and rotating JSON logs.
- Bearer-authenticated `/health` and `/version` endpoints.
- Authenticated `/ws/v1` endpoint with contract-based diagnostic echo events.
- Electron Sidecar lifecycle with random port, 256-bit one-time token, readiness polling, one automatic restart and shutdown cleanup.
- Context-isolated, sandboxed preload exposing only the five approved capabilities.
- Renderer diagnostics panel for backend state, app version, port and WebSocket echo.
- Contract generation updated for diagnostic and backend-status events.

## Verified

- `npm run verify:m1` passes frontend, contract, security, backend and Sidecar integration tests.
- Real child-process integration verifies HTTP authentication, network WebSocket echo, crash/restart, token rotation and cleanup.
- `npm run electron:build` creates the Windows NSIS and unpacked artifacts.
- `npm run smoke:electron` starts the packaged app and confirms no Python process remains after normal Electron exit.

## Environment notes

- Development was verified with Python 3.10 because Python 3.12 and `uv` are not installed on this machine. The code and `pyproject.toml` remain compatible with the planned Python 3.12 environment.
- Packaged M1 currently uses an installed system Python. Bundling a Python-free executable remains phase 9 work.
- Existing Vite warnings for `/index.css`, bundle size, package metadata and the default Electron icon remain outside the M1 exit gate.
