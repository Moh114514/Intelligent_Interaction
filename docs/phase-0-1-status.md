# Phase 0-1 status

Started: 2026-07-01

## Completed in the first implementation pass

- Preserved commit `8355c2f` as `legacy-v1.0` and created `codex/refactor-phase-0-1`.
- Recorded renderer, speech, interrupt and Electron packaging baselines.
- Added contract schemas, deterministic TypeScript/Python generation and contract tests.
- Extracted conversation state/view, speech playback lifecycle and the avatar import boundary from `App.tsx`.
- Added type checking, source-boundary tests, production build verification and build-secret scanning.
- Removed local provider credentials from production bundles; production builds use the credential-free example config.
- Rebuilt the renderer and NSIS installer successfully.

## Required before phase 0-1 exit

- Revoke and replace every provider credential that appeared in a historical `dist` bundle. This requires provider-console access and cannot be completed by source changes.
- Run manual text, microphone, TTS, interrupt, cat-switch, feed and sing smoke tests with development credentials.
- Decide whether to move the remaining interaction orchestration out of `App.tsx` now or defer it until `AgentClient` arrives in phase 4.

Do not restore production credentials to Vite. Packaged provider connectivity resumes through the authenticated Python sidecar in phases 2-4.
