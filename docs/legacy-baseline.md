# Legacy V1.0 baseline

Recorded on 2026-07-01 from commit `8355c2f` and preserved by tag `legacy-v1.0`.

## Reproduce

- Install: `npm ci`
- Renderer development: `npm run dev` (Vite listens on port 3000)
- Electron development: start Vite first, then run `npm run electron:dev`
- Renderer production build: `npm run build`
- Windows installer: `npm run electron:build`

## Verified baseline

- `npm run build`: passed; 461 modules; main JavaScript bundle 537.32 kB (144.77 kB gzip).
- `npm run electron:build`: passed; produced `Garfield Chat Setup 1.0.0.exe` and unpacked application.
- Text path: user input -> Gemini/custom handler -> transcript -> TTS playback. Provider credentials and a network are required, so it remains a manual smoke test.
- Speech path: external ASR is selected by default; press-and-hold microphone populates the input without auto-submitting. Browser ASR is the fallback.
- Interrupt path: clears UI state, stops ASR, reconnects the live session and recreates the audio context.

## Known baseline warnings and risks

- Vite reports a missing `/index.css` reference.
- The main bundle exceeds Vite's 500 kB warning threshold.
- Package metadata lacks `description` and `author`; the default Electron icon is used.
- Renderer directly contains model and speech-provider integration. This is retained during phase 0-1 for behavior compatibility and must be removed in phase 4.
- No automated browser/audio regression existed at the baseline; phase 0-1 adds contract, type, build and source-boundary checks first.
