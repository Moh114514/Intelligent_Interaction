# Legacy V1.0 baseline

Recorded on 2026-07-01 from commit `8355c2f` and preserved by tag `legacy-v1.0`.

## Reproduce

- Install: `npm ci`
- Renderer development: `npm run dev`
- Electron development: start Vite, then run `npm run electron:dev`
- Renderer build: `npm run build`
- Windows installer: `npm run electron:build`

## Historical baseline

- The original Renderer directly combined model, speech and playback integrations.
- External ASR was selected by default; browser ASR was the fallback.
- Interrupt reset local UI, recording and playback state.
- The baseline build passed with known missing stylesheet, bundle-size, package metadata and icon warnings.

The current architecture supersedes these direct-provider paths. The tag remains the authoritative source for historical implementation details.