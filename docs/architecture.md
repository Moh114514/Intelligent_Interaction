# Architecture migration

The repository is migrated incrementally so every phase remains runnable.

Current boundaries:

- `features/conversation`: per-character message history and conversation controls.
- `features/speech`: microphone capture, PCM WAV encoding, cancellable playback and volume-envelope presentation.
- `features/avatar`: selectable CSS and direct Three.js renderers, local mode preference, responsive model framing and AgentState animation control.
- `services/agentClient`: authenticated Renderer-to-Python event transport.
- `services/speechClient`: authenticated ASR upload, TTS request and one-time audio download; provider credentials remain in Python.
- `contracts`: protocol source of truth; generated TypeScript and Python files are not edited manually.
- `backend`: LLM and speech providers, prompts, Agent runtime, secure tools and audit lifecycle.
- `public/models/vanguard-soldier.glb`: self-contained runtime model, materials, textures, skin and root-locked Talking animation.

React owns visual state and Three.js only renders presentation. The 3D renderer never connects to Python, stores business state or executes tools. CSS and 3D are explicit peer modes; a 3D load failure remains isolated from conversation, tool and speech flows and never changes mode automatically.

The `SOLDIER` protocol identity is selected only in 3D mode and has independent frontend/backend history. BLACK and WHITE remain the two CSS cat identities.
