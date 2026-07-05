# Phase 7 status: Python speech service (M5)

Implemented on `codex/refactor-phase-7`:

- Renderer records mono 16 kHz PCM16 WAV and sends it only to the authenticated loopback sidecar.
- Python owns Volcengine Doubao Speech 2.0 and Xunfei credentials, ASR/TTS calls, error mapping, timeout and cancellation.
- Volcengine is the default provider; Xunfei remains selectable with `SPEECH_PROVIDER=xunfei`.
- ASR fills the text input without automatically sending it.
- TTS uses only final assistant messages, stores generated audio in memory, and exposes a one-time authenticated download.
- Stop cancels the Agent, recording, ASR/TTS provider task, audio download and playback queue.
- CSS and Three.js avatars receive a normalized playback volume envelope.

## Real-provider acceptance

Add the following to ignored `backend/.env.local`, then restart Electron/the backend:

```dotenv
SPEECH_PROVIDER=volcengine
VOLCENGINE_AUTH_MODE=auto
# Old console:
VOLCENGINE_APP_ID=your-app-id
VOLCENGINE_ACCESS_TOKEN=your-access-token
# Or new console / Agent Plan:
# VOLCENGINE_SPEECH_API_KEY=your-doubao-speech-2-api-key
SPEECH_VOICE_BLACK=your-enabled-speaker-id
SPEECH_VOICE_WHITE=your-enabled-speaker-id
SPEECH_VOICE_SOLDIER=your-enabled-speaker-id
```

Verify: hold/release microphone, edit recognized text, send it, hear one reply, cancel during recognition and synthesis, and confirm text chat remains usable after a provider error.

Automated gate: 
pm run verify:m5`.
