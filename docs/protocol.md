# Local protocol V1

The Python sidecar binds only to `127.0.0.1`. Electron allocates a random port and 256-bit one-time token.

## Authentication

- HTTP: `Authorization: Bearer <token>`
- WebSocket protocols: `agent.v1` and the token
- The token is exposed to Renderer only through the sandboxed preload bridge.

## Endpoints

- `GET /health`
- `GET /version`
- `WS /ws/v1`

Every event includes `type`, `version`, `session_id`, `request_id`, `timestamp` and `data`.

## M2 conversation flow

Client sends `client.message` with `content` and `character_id` (`BLACK` or `WHITE`).

Normal response order:

1. `agent.state` with `thinking`
2. zero or more `assistant.delta` events
3. `assistant.message` with complete content
4. `agent.state` with `idle`

To cancel, the client sends `request.cancel` using the active request ID. The server returns `request.cancelled`, then `idle`.

Errors use `error_code`, `message`, `recoverable` and `request_id`. Only one generation may be active per WebSocket session.