# Architecture migration

The repository is being migrated incrementally so every phase stays runnable.

Current phase 0-1 boundaries:

- `features/conversation`: message history and conversation controls.
- `features/speech`: recording interfaces and browser audio playback lifecycle.
- `features/avatar`: the current CSS avatar boundary; Unity will replace its implementation in phase 6.
- `contracts`: protocol source of truth. Generated TypeScript and Python files are never edited by hand.
- Legacy provider code remains under `services` until the Python Agent migration in phases 2-4.

Target ownership and security boundaries remain those in the refactor plan: Renderer owns UI, Electron owns privileged lifecycle and IPC, Python owns Agent/provider/tool business logic, and Unity owns visual presentation only.
