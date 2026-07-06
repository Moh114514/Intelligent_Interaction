# Phase 9 status

Phase 9 adds the reproducible Windows x64 V1.0 release pipeline.

- Python 3.12.10 and PyInstaller 6.21.0 produce an onedir Sidecar. The packaged Electron process launches only `resources/backend-sidecar/agent-backend.exe` and never falls back to system Python.
- Electron Builder produces an x64 assisted NSIS installer and a portable executable. Both use `%APPDATA%\Garfield Chat`; upgrade and uninstall preserve user data.
- Release scanning rejects environment files, credentials, Python source/cache files, tests, databases, logs and removed integration identifiers.
- Sidecar self-test, authenticated health check, forced cleanup, packaged startup without Python in PATH, package resource scan and the full M6.5 regression suite pass.
- The setup and portable artifacts are unsigned by design. SHA-256 values and machine-readable metadata are generated in `release/`.
- Windows Sandbox automation covers a clean environment, portable startup, 0.9.0 upgrade, Sidecar crash recovery and uninstall retention. On the current host, the Sandbox reaches the clean-environment check but its inherited Application Control policy blocks the unsigned portable before application startup. This is recorded as a release blocker in `sandbox-results.json` and must not be reported as an application test pass.

Run `npm run release:build` to regenerate release artifacts. Run `npm run sandbox:fixture` and `npm run sandbox:verify` on a Windows 10/11 x64 host whose policy permits unsigned test binaries, or sign the artifacts with a trusted certificate before the final clean-machine acceptance. Create `v1.0.0` only after that acceptance and the user's manual check pass.
