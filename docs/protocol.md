# Local protocol V1

The Python sidecar binds only to `127.0.0.1`. Electron allocates the port and a 256-bit one-time token for every sidecar process.

## Authentication

- HTTP: `Authorization: Bearer <token>`.
- WebSocket: protocols `agent.v1` and `<token>` in `Sec-WebSocket-Protocol`; the server selects `agent.v1`.
- The token is available to Renderer only through the preload API and is never included in a WebSocket URL.

## M1 endpoints

- `GET /health`
- `GET /version`
- `WS /ws/v1`

Every WebSocket event includes `type`, `version`, `session_id`, `request_id`, `timestamp`, and `data`. M1 supports `diagnostics.echo.request` and returns `diagnostics.echo.response` with matching correlation IDs.
