> Note (2026-07-14, claude-opus-4-8): Synced the canonical AAHP gate scripts from homeofe/improvements (v3.5.0 fixes: aahp-manifest.sh --phase documentation + cross_repo_ref preservation, lint-handoff.sh SC2034), AAHP_HANDOFF_FILES preserved, and refreshed the local hook tooling (scripts/hooks/, install-hooks.sh, verify-hooks.sh). Fleet re-sync.

> Note (2026-07-14, claude-opus-4-8): Synced the canonical Layer 3 tolerance fix from homeofe/improvements. verify-handoff.sh now downgrades a non-ancestor MANIFEST.last_session.commit from FAIL to WARN so a squash-merge or rebase-merge no longer trips AAHP Verify Layer 3 on main; Layers 1-2 still gate real staleness.

# STATUS - conduit-vscode

## Current Version: 0.7.4 (GitHub .vsix only - Marketplace publishing dropped by decision 2026-07-17)

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
| Multi-turn Agent Loop (T-016) | Done | AgentLoop controller: stream -> parse tool calls -> execute -> feed results back; duplicate-call detection, error feedback loop, destructive-action confirmation, abort |
| Agent Tools | Done | readFile, writeFile, runCommand, searchCode + worktree tools; command/branch args validated, execFile no-shell (CWE-78 hardening) |
| Agent Backends | Done | Claude CLI, Gemini CLI, OpenAI Codex, OpenCode, Pi; background sessions with spawn/monitor/kill and model failover chain |
| Git Worktree Isolation | Done | Parallel agent work in isolated worktrees, serialized creation, merge-aware cleanup |
| Agent Session Persistence | Done | Sessions survive VS Code restarts; Resume/Remove/Clear commands |
| Cost Tracking | Done | Per-session token/cost tracking, budget limits, per-model cost summary |

## Architecture
- Extension activates on VS Code startup (`onStartupFinished`)
- `ConduitChatViewProvider` is a WebviewViewProvider with persistent session storage via `globalState`
- Agent mode instructs models to use `### Step N: Title` format, rendered as collapsible `<details>` cards
- Markdown renderer is custom inline (no external lib), supports full GFM subset
- Model registry with 3-tier system: Tier 1 (all modes), Tier 2 (ask/edit/plan), Tier 3 (ask only)
- All AI requests go through `proxy-client.ts` -> `conduit.proxyUrl` (default: `http://127.0.0.1:31338`)
- Bridge uses Playwright browser automation (Grok, Claude, Gemini, ChatGPT web UIs)

## Build Status
- Build: `npm run build` - `dist/extension.js` (~201kb): Done
- Tests: `npm test` - vitest, 314 passing / 1 skipped across 17 files: Done
- .vsix packaging: `npx @vscode/vsce package --no-dependencies`: Done

## Known Issues / Gaps
- Bridge must be rebuilt separately when models change
- Marketplace listing (T-006): dropped 2026-07-17 - no plan to publish, distribution stays via GitHub .vsix

## Release History
| Version | Date | Notes |
|---|---|---|
| 0.1.0 | 2026-03-12 | Initial build - full feature set + BridgeManager |
| 0.2.0 | 2026-03-14 | Chat history, model selector, health dashboard, auto-start, tests, .vsix |
| 0.3.0 | 2026-03-15 | Agent step cards, full markdown rendering, #workspace/#codebase, model selection fix |
| 0.4.0 | 2026-03-15 | Per-provider sessions, streaming metadata, inline chat diff preview |
| 0.5.0 | 2026-03-16 | Multi-turn agent loop with tool execution (T-016 core), auto model selection, local models, smart fallback |
| 0.6.0 | 2026-03-18 | Agent backends (Claude/Gemini/Codex/OpenCode/Pi), background sessions, worktree isolation |
| 0.7.0 | 2026-03-18 | CI + LLM validation workflows, shared backend abstraction, session persistence/resume, cost tracking |
| 0.7.1-0.7.4 | 2026-03-24 to 2026-05-17 | Windows bridge spawn fix, security dep updates, dev dep major bumps (see README changelog) |

<!-- aahp-gate -->
_AAHP verify gate: v3.0.2 synced 2026-06-20._

> 2026-06-21 install-hooks.sh: Windows drive-letter path fix propagated from AAHP.

> 2026-06-21 ci: add supply-chain-guard v5.2.35 Action workflow (fail-on critical).

> 2026-06-21 ci(aahp): fix unquoted next_task_id + lint-handoff noreply@ PII exclusion.

> 2026-06-27 ci: re-pin supply-chain-guard Action to v5.2.37 (be1d718b17cc38e4bce7fa48579b7112e557943b) and enable Dependabot github-actions weekly updates.

> 2026-06-28 security: fix 3 command-injection findings (CWE-78) - validate branch names and command tokens from LLM tool args; switch toolCreateWorktree and toolRunCommand to execFile with no-shell; validate GitHub label in batchFixIssues before passing to execFileSync; add 17 security regression tests.

> 2026-06-28 security: harden 2 residual CWE-78 sinks in toolRemoveWorktree and getBranchStatus - validate extracted branch name before any git call; switch cp.exec to cp.execFile for worktree remove; switch cp.execSync to cp.execFileSync for branch status and branch delete/force-delete; add 5 regression tests (shell metachar, leading hyphen, "..", exec vs execFile, execFileSync vs execSync assertions).

> 2026-06-30 verify: added reviewed expiring PII allowlist, rolled out from AAHP v3.2.0.

> 2026-06-30 ci: exempt Dependabot from the aahp-verify handoff gate (keep supply-chain-guard/codeql/build).
- 2026-07-03: ci: supply-chain-guard now tracks the moving @v5 release branch instead of a stale SHA pin (owner rule: consumers pin @v5, the release workflow moves it - currently v5.6.1). Ends the recurring stale/broken-pin churn (v5.2.35 crash wave). Config change only.

> 2026-07-17 docs: reconciled handoff docs with reality - version 0.3.0 -> 0.7.4, T-016 multi-turn agent loop marked done (shipped v0.5.0-v0.7.0, issue #52 closed), T-006 marketplace listing dropped by decision (issue #53 closed), test count 314. Merged Dependabot PRs #62-#66 and #69 the same day. No code changes.
