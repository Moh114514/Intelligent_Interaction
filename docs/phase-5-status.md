# Phase 5 status (M3)

Implemented on 2026-07-04.

## Delivered

- OpenAI-compatible streaming tool calls with fragmented argument assembly and multi-step result feedback.
- Allowlisted Tool Registry with JSON Schema validation and L0/L1/L2 risk enforcement.
- Current time, basic system information, approved URL/application opening, clipboard access, confirmed exact-path resolution and fixed-drive filename search, short-lived file references, bounded document reads and confirmed atomic text writes.
- Fixed-drive sensitive-area exclusion, reparse-point rejection, extension and size limits, file-change detection, timestamped backups, URL validation and application allowlisting.
- One-time L2 confirmation modal with expiry, rejection, request cancellation and correlated confirmation responses.
- Rotating JSONL audit records without clipboard contents, file contents, URL query strings or credentials.
- Maximum five tool calls per request, tool timeout handling and commit-on-success conversation history.
- Package exclusions and automatic scans preventing local environment files, logs, tests and Python caches from entering releases.

## Automated verification

- M3 verification passes 8 contract/source-boundary tests, 32 backend tests, 4 Sidecar tests and 6 Renderer tests.
- TypeScript checks, production build and Renderer secret scan pass.
- Windows NSIS installer builds successfully.
- Packaged credential and removed-integration scan passes.
- Packaged backend contains no local environment files, tests, logs, pycache directories or bytecode files.
- Packaged startup and Sidecar cleanup smoke test passes.

## Manual acceptance

1. Put harmless test files on two local fixed drives, including TXT, PDF or Office and one image/media file.
2. Start Vite and Electron with a valid DeepSeek key.
3. Ask for current time and system information, then verify both deterministic L0 tools run.
4. Search for the test filenames; verify the L2 dialog shows the search scope and Reject performs no search.
5. Approve search, then ask to read a returned text/document file and inspect media metadata.
6. Ask to create a new UTF-8 text file; verify the dialog shows the exact path and complete content.
7. Search for that file, request replacement, verify the complete new content and backup warning, then approve and inspect both file and timestamped backup.
8. Test clipboard write approval, rejection, timeout and Stop; no denied operation may change its target.
9. Try a system/AppData/credential path and verify it is rejected even if requested.
10. Check tool-audit.jsonl for statuses, confirmation outcomes and redacted targets without file or clipboard contents.

M3 is ready to exit after these real desktop checks pass.