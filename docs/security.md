# Security baseline

- LLM credentials exist only in the Python sidecar environment.
- Development reads the ignored `backend/.env.local`; packaged builds read `%APPDATA%\Garfield Chat\backend.env`.
- The Renderer receives only the authenticated loopback connection details through preload.
- Renderer and packaged frontend assets contain no provider credentials, signing logic or direct provider endpoints.
- `npm run security:scan` rejects common credential formats and exact local credential values in build output.
- Provider errors returned to the Renderer never include credentials or raw provider response bodies.

Any credential that appeared in a historical build must be revoked at its provider. Removing it from Git does not revoke it.