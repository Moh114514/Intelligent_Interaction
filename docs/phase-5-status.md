# Phase 5 status (M3)

Implemented on 2026-07-03.

## Delivered

- OpenAI-compatible streaming tool calls with fragmented argument assembly and multi-step result feedback.
- Allowlisted Tool Registry with JSON Schema validation and L0/L1/L2 risk enforcement.
- Current time, basic system information, approved URL/application opening, clipboard text, shared-directory file search and confirmed text-file reads.
- Shared-directory path containment, reparse-point rejection, extension and size limits, URL validation and application allowlisting.
- One-time L2 confirmation modal with expiry, rejection, request cancellation and correlated confirmation responses.
- Rotating JSONL audit records without clipboard contents, file contents, URL query strings or credentials.
- Maximum five tool calls per request, tool timeout handling and commit-on-success conversation history.
- Package exclusions and automatic scans preventing local environment files, logs, tests and Python caches from entering releases.

## Automated verification

- M3 verification passes 8 contract/source-boundary tests, 22 backend tests, 4 Sidecar tests and 5 Renderer tests.
- TypeScript checks, production build and Renderer secret scan pass.
- Windows NSIS installer builds successfully.
- Packaged credential and removed-integration scan passes.
- Packaged backend contains no local environment files, tests, logs, pycache directories or bytecode files.
- Packaged startup and Sidecar cleanup smoke test passes.

## Manual acceptance

1. Put a UTF-8 note.txt file smaller than 64 KiB in Documents/Garfield Chat Shared.
2. Start Vite and Electron with a valid DeepSeek key.
3. Ask for the current local time and basic system information.
4. Ask to open Notepad, Calculator and one HTTPS URL.
5. Ask to write and read harmless clipboard text.
6. Ask to search for note.txt, then ask to read it.
7. Verify Reject and confirmation timeout never reveal the file, while Allow once returns its content.
8. Press Stop while the confirmation dialog is open and verify no tool runs afterward.
9. Check the tool-audit.jsonl log: statuses and safe summaries should exist, while clipboard and file contents must not.

M3 is ready to exit after these real desktop checks pass.