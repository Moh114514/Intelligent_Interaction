# Phase 6 status: Three.js avatar system (M4)

Implemented:

- CSS cats and the Three.js Vanguard GLB are explicit peer avatar modes.
- First-run mode is Three.js; legacy Unity preferences migrate to Three.js and the latest choice is persisted.
- The upstream `3D模型/` Unity project is ignored. The committed GLB is the only runtime 3D asset.
- Runtime bounding-box normalization centers the character, places its feet on the ground and maintains a full-body camera margin across resizes.
- The Talking animation has model root and Hips translation removed to prevent character drift.
- All eight AgentState values remain visible; `speaking` controls Talking and other states restore the bind pose.
- The 3D mode uses the independent SOLDIER identity/session and Vanguard veteran persona. Kuro/Shiro prompts are unchanged.
- 3D errors provide retry and manual CSS switching without interrupting chat.

Verification:

Run `npm run verify:m4`. It validates M3 regressions, Renderer mode/framing behavior and GLB structure, animation root lock and the 20 MiB budget. Installer generation is intentionally separate and only runs through `npm run electron:build` when requested.