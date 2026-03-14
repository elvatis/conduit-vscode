# STATUS - conduit-vscode

## Current Version: 0.1.0 (GitHub only - not yet on VS Code Marketplace)

## Feature Status
| Feature | Status | Notes |
|---|---|---|
| Chat Panel (sidebar webview) | Done | Streaming, model switching, history, copy button |
| Inline Suggestions (ghost text) | Done | Debounced, context-aware, toggleable, per-language prompts |
| Inline Edit (Ctrl+Shift+I) | Done | Rewrites selection in-place |
| Explain / Refactor / Generate Tests | Done | Right-click context menu |
| Fix Diagnostics | Done | Sends errors+warnings to AI |
| Terminal Command Suggestions | Done | Describe task - shell command - run or copy |
| Editor Context Builder | Done | Prefix/suffix, open files, diagnostics |
| Status Bar | Done | Live proxy health + provider count |
| Bridge Manager Panel | Done | Start/stop/restart/logs + per-provider login/logout |
| BridgeManager (process lifecycle) | Done | Spawn/monitor conduit-bridge as child process |
| Live Log Streaming | Done | Output Channel 'Conduit Bridge' |
| Auto-start bridge | Done | Starts conduit-bridge on activate if proxy unreachable |
| Per-language inline prompts | Done | Tuned hints for TS, JS, Python, Go, Rust, Markdown, etc. |

## Architecture
- Extension activates on VS Code startup (`onStartupFinished`)
- `BridgeManager` manages conduit-bridge process + polls `/v1/status` every 15s
- On activate, checks proxy health and auto-starts bridge if offline
- `ConduitChatPanel` is a WebviewPanel (retained when hidden)
- `ConduitInlineProvider` implements `vscode.InlineCompletionItemProvider`
- Per-language inline hints in `context-builder.ts` (18 languages mapped)
- All AI requests go through `proxy-client.ts` - `conduit.proxyUrl` (default: `http://127.0.0.1:31337`)
- Status bar shows `Conduit N/4` (connected providers out of 4)

## Build Status
- TypeScript strict: Done
- Build: `npm run build` - `dist/extension.js` (39.8kb bundled): Done
- Tests: `npm test` - 30 tests, 3 files, all passing (vitest): Done
- .vsix packaging: `npx @vscode/vsce package` - 17.65 KB: Done
- VS Code Marketplace: not published (T-006)

## Known Issues / Gaps
- No marketplace listing yet (T-006)
- npm on this machine has `omit=dev` globally - use `npm install --include=dev` for dev dependencies

## Release History
| Version | Date | Notes |
|---|---|---|
| 0.1.0 | 2026-03-12 | Initial build - full feature set + BridgeManager |
| 0.1.0 | 2026-03-14 | Added auto-start, per-language prompts, tests, .vsix packaging |
