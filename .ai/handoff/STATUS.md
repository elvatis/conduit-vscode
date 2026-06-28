# STATUS - conduit-vscode

## Current Version: 0.3.0 (GitHub only - not yet on VS Code Marketplace)

## Feature Status
| Feature | Status | Notes |
|---|---|---|
| Chat Panel (sidebar webview) | Done | Streaming, full Markdown rendering, copy/insert actions, per-message model tags |
| Agent Step Cards | Done | Collapsible step cards with spinner/checkmark in agent mode |
| Markdown Renderer | Done | Custom inline renderer: headings, lists, tables, blockquotes, code blocks, bold/italic/links |
| Native Sessions Tree View | Done | VS Code tree view, persistent, New/Refresh/Delete actions |
| Native QuickPick Model Selector | Done | Grouped by provider, tier icons, context window sizes |
| Native QuickPick Mode Selector | Done | Ask/Edit/Agent/Plan modes via VS Code QuickPick |
| Auto Model Selection | Done | Picks best model per message based on complexity analysis |
| 30+ Model Registry | Done | Friendly display names, tier classification, mode compatibility |
| Context Mentions | Done | #file:path, #selection, #problems, #workspace, #codebase, #terminal |
| #workspace mention | Done | Lightweight folder structure overview |
| #codebase mention | Done | Deep search: file tree + up to 30 source files (~80K chars) |
| Health Dashboard | Done | Real-time webview with providers, models, uptime, auto-refresh 15s |
| Inline Suggestions (ghost text) | Done | Debounced, context-aware, toggleable, per-language prompts |
| Inline Chat (Ctrl+I) | Done | Describe change at cursor, review as diff, accept/reject |
| Inline Edit (Ctrl+Shift+I) | Done | Rewrites selection in-place |
| Explain / Refactor / Generate Tests | Done | Right-click context menu |
| Fix Diagnostics | Done | Sends errors+warnings to AI |
| Terminal Command Suggestions | Done | Describe task - shell command - run or copy |
| Commit Message Generation | Done | Ctrl+Shift+M, generates from staged git diff |
| Custom Instructions | Done | .conduit/instructions.md, CLAUDE.md, copilot-instructions.md |
| Slash Commands | Done | /help, /fix, /explain, /tests, /refactor, /plan, /commit, /clear, /new, /cost, /model, /mode, /rename |
| Editor Context Builder | Done | Prefix/suffix, open files, diagnostics |
| Status Bar | Done | Live proxy health + current model name |
| Bridge Manager Panel | Done | Start/stop/restart/logs + per-provider login/logout |
| Auto-start bridge | Done | Starts conduit-bridge on activate if proxy unreachable |
| Model-Mode Compatibility | Done | Warnings when model doesn't support current mode |
| Model Switch Handoff | Done | Context summary when switching models mid-conversation |

## Architecture
- Extension activates on VS Code startup (`onStartupFinished`)
- `ConduitChatViewProvider` is a WebviewViewProvider with persistent session storage via `globalState`
- Agent mode instructs models to use `### Step N: Title` format, rendered as collapsible `<details>` cards
- Markdown renderer is custom inline (no external lib), supports full GFM subset
- Model registry with 3-tier system: Tier 1 (all modes), Tier 2 (ask/edit/plan), Tier 3 (ask only)
- All AI requests go through `proxy-client.ts` -> `conduit.proxyUrl` (default: `http://127.0.0.1:31338`)
- Bridge uses Playwright browser automation (Grok, Claude, Gemini, ChatGPT web UIs)

## Build Status
- Build: `npm run build` - `dist/extension.js` (~123kb): Done
- Tests: `npm test` - vitest: Done
- .vsix packaging: `npx @vscode/vsce package --no-dependencies`: Done

## Known Issues / Gaps
- No marketplace listing yet (T-006)
- No multi-turn agent loop yet (planned - T-016)
- Bridge must be rebuilt separately when models change

## Release History
| Version | Date | Notes |
|---|---|---|
| 0.1.0 | 2026-03-12 | Initial build - full feature set + BridgeManager |
| 0.2.0 | 2026-03-14 | Chat history, model selector, health dashboard, auto-start, tests, .vsix |
| 0.3.0 | 2026-03-15 | Agent step cards, full markdown rendering, #workspace/#codebase, model selection fix |

<!-- aahp-gate -->
_AAHP verify gate: v3.0.2 synced 2026-06-20._

> 2026-06-21 install-hooks.sh: Windows drive-letter path fix propagated from AAHP.

> 2026-06-21 ci: add supply-chain-guard v5.2.35 Action workflow (fail-on critical).

> 2026-06-21 ci(aahp): fix unquoted next_task_id + lint-handoff noreply@ PII exclusion.

> 2026-06-27 ci: re-pin supply-chain-guard Action to v5.2.37 (be1d718b17cc38e4bce7fa48579b7112e557943b) and enable Dependabot github-actions weekly updates.

> 2026-06-28 security: fix 3 command-injection findings (CWE-78) - validate branch names and command tokens from LLM tool args; switch toolCreateWorktree and toolRunCommand to execFile with no-shell; validate GitHub label in batchFixIssues before passing to execFileSync; add 17 security regression tests.

> 2026-06-28 security: harden 2 residual CWE-78 sinks in toolRemoveWorktree and getBranchStatus - validate extracted branch name before any git call; switch cp.exec to cp.execFile for worktree remove; switch cp.execSync to cp.execFileSync for branch status and branch delete/force-delete; add 5 regression tests (shell metachar, leading hyphen, "..", exec vs execFile, execFileSync vs execSync assertions).
