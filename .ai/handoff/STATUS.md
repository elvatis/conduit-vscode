# STATUS - conduit-vscode

## Current Version: 0.2.0 (GitHub only - not yet on VS Code Marketplace)

## Feature Status
| Feature | Status | Notes |
|---|---|---|
| Chat Panel (panel webview) | Done | Streaming, Markdown rendering, copy/insert actions, per-message model tags |
| Native Sessions Tree View | Done | VS Code tree view (like Copilot), persistent, New/Refresh/Delete actions |
| Native QuickPick Model Selector | Done | Full-width searchable picker, grouped by provider, context window sizes |
| Native QuickPick Mode Selector | Done | Ask/Edit/Agent/Plan modes via VS Code QuickPick |
| Auto Model Selection | Done | Picks best model per message based on complexity analysis |
| 30+ Model Registry | Done | Friendly display names with version numbers, all providers mapped |
| Health Dashboard | Done | Real-time webview with providers, models, uptime, version, auto-refresh 15s |
| Inline Suggestions (ghost text) | Done | Debounced, context-aware, toggleable, per-language prompts |
| Inline Chat (Ctrl+I) | Done | Describe change at cursor, review as diff, accept/reject |
| Inline Edit (Ctrl+Shift+I) | Done | Rewrites selection in-place |
| Explain / Refactor / Generate Tests | Done | Right-click context menu |
| Fix Diagnostics | Done | Sends errors+warnings to AI |
| Terminal Command Suggestions | Done | Describe task - shell command - run or copy |
| Commit Message Generation | Done | Ctrl+Shift+M, generates from staged git diff |
| Custom Instructions | Done | .conduit/instructions.md, CLAUDE.md, copilot-instructions.md |
| Context Mentions | Done | #file:path, #selection, #problems, #codebase, #terminal |
| Slash Commands | Done | /help, /fix, /explain, /tests, /refactor, /plan, /commit, /clear, /new, /cost, /model, /mode |
| Editor Context Builder | Done | Prefix/suffix, open files, diagnostics |
| Status Bar | Done | Live proxy health + current model name |
| Bridge Manager Panel | Done | Start/stop/restart/logs + per-provider login/logout |
| Auto-start bridge | Done | Starts conduit-bridge on activate if proxy unreachable |
| Streaming Error Handling | Done | HTTP status codes, 120s timeout, empty response fallback |

## Architecture
- Extension activates on VS Code startup (`onStartupFinished`)
- View registered in `panel` viewsContainers (appears alongside Copilot/Claude Code tabs)
- `ConduitChatViewProvider` is a WebviewViewProvider with persistent session storage via `globalState`
- `SessionsTreeProvider` is a native VS Code TreeDataProvider for session history
- Model and mode selection use `vscode.window.showQuickPick` (native UI, no HTML dropdowns)
- `BridgeManager` manages conduit-bridge process + polls `/v1/status` every 15s
- `ConduitInlineProvider` implements `vscode.InlineCompletionItemProvider`
- All AI requests go through `proxy-client.ts` -> `conduit.proxyUrl` (default: `http://127.0.0.1:31338`)
- Model registry in `model-registry.ts` with display names, context windows, auto-selection logic

## Build Status
- TypeScript strict: Done
- Build: `npm run build` - `dist/extension.js` (~102kb bundled via esbuild): Done
- Tests: `npm test` - vitest: Done
- .vsix packaging: `npx @vscode/vsce package`: Done
- VS Code Marketplace: not published (T-006)

## Important: Deployment
The installed extension lives at `~/.vscode/extensions/elvatis.conduit-vscode-0.2.0/`.
After building, files must be copied there (or reinstall via .vsix) for changes to take effect.
VS Code only reads `package.json` view contributions on full restart (not reload).

## Known Issues / Gaps
- No marketplace listing yet (T-006)
- npm on this machine has `omit=dev` globally - use `npm install --include=dev` for dev dependencies
- Bridge must be rebuilt separately when models change (separate repo: openclaw-cli-bridge-elvatis)

## Release History
| Version | Date | Notes |
|---|---|---|
| 0.1.0 | 2026-03-12 | Initial build - full feature set + BridgeManager |
| 0.2.0 | 2026-03-14 | Chat history, model selector, health dashboard, auto-start, per-language prompts, tests, .vsix |
| 0.2.0+ | 2026-03-14 | Native QuickPick selectors, Sessions tree view, 30+ models with display names, Grok 4.0, streaming error handling, comprehensive docs |
