# STATUS — conduit-vscode

## Current Version: 0.1.0 (GitHub only — pre-release, not yet on VS Code Marketplace)

## Feature Status
| Feature | Status | Notes |
|---|---|---|
| Chat Panel (sidebar webview) | ✅ | Streaming, model switching, history, copy button |
| Inline Suggestions (ghost text) | ✅ | Debounced, context-aware, toggleable |
| Inline Edit (Ctrl+Shift+I) | ✅ | Rewrites selection in-place |
| Explain / Refactor / Generate Tests | ✅ | Right-click context menu |
| Fix Diagnostics | ✅ | Sends errors+warnings to AI |
| Terminal Command Suggestions | ✅ | Describe task → shell command → run or copy |
| Editor Context Builder | ✅ | Prefix/suffix, open files, diagnostics |
| Status Bar | ✅ | Live proxy health + provider count |
| Bridge Manager Panel | ✅ | Start/stop/restart/logs + per-provider login/logout |
| BridgeManager (process lifecycle) | ✅ | Spawn/monitor conduit-bridge as child process |
| Live Log Streaming | ✅ | Output Channel 'Conduit Bridge' |

## Architecture
- Extension activates on VS Code startup (`onStartupFinished`)
- `BridgeManager` manages conduit-bridge process + polls `/v1/status` every 15s
- `ConduitChatPanel` is a WebviewPanel (retained when hidden)
- `ConduitInlineProvider` implements `vscode.InlineCompletionItemProvider`
- All AI requests go through `proxy-client.ts` → `conduit.proxyUrl` (default: `http://127.0.0.1:31338`)
- Status bar shows `Conduit N/4` (connected providers out of 4)

## Build Status
- TypeScript strict ✅
- Build: `npm run build` → `dist/extension.js` (37.8kb bundled) ✅
- Tests: none yet (T-004)
- VS Code Marketplace: not published (T-006)

## Known Issues / Gaps
- No tests (T-004)
- No `.vsix` packaging yet (T-005)
- Inline suggestion quality depends on model — may need system prompt tuning (T-003)
- Bridge auto-start on extension activate not implemented yet (T-002)

## Release History
| Version | Date | Notes |
|---|---|---|
| 0.1.0 | 2026-03-12 | Initial build — full feature set + BridgeManager |
