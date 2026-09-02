> Note (2026-09-03, claude-opus-5): Release hygiene for v0.10.0, which shipped incomplete. The GitHub release carried no .vsix, so the only distribution channel this repo has was empty while the tag claimed a release; v0.9.0 had one, so this was a regression in practice, not a change of policy. README still read "Current version: 0.9.0", named conduit-vscode-0.9.0.vsix in the packaging step, and had no v0.10.0 changelog section; docs/CHANGELOG.md stopped at [0.9.0] and never recorded 0.9.1 at all; this file still said 0.9.0. All four now match the tag, and the .vsix is attached to the release. Lesson worth keeping: bumping package.json and cutting the tag is not the release - the version appears in four documents plus one asset, and nothing in CI checks that they agree.

> Note (2026-09-02, claude-opus-5): Deleted MODEL_LIMITS, PROVIDER_FALLBACK_LIMITS, MODEL_DISPLAY_NAMES and MODEL_TIERS from model-registry.ts - 129 lines. conduit-bridge 0.9.0 reports context_window, max_output_tokens and display_name on /v1/models, discovered per provider where one says (the Codex endpoint returns the account's real window) and otherwise from one table in the bridge that ~/.conduit/models.json can override. Verified against a live bridge: all 36 CLI models arrive with both, no gaps. Tiering is gone with them: it was a local guess that silently withheld Agent mode from any id this build had not heard of, which with a discovered catalog is most of them - every model now reports every mode. One fallback stays and is not the same problem: `local-*` models are fetched by this extension straight from a configured endpoint, so the bridge never sees them and cannot report their limits; they assume a small 8192-token window, because a small local model is the one that actually overflows. Requires conduit-bridge 0.9.0.

> Note (2026-09-02, claude-opus-5): Aligned with conduit-bridge 0.8.x. Eight defects. (1) The 120s request timeout was a budget on the whole turn, not an idle timer: no CLI provider streams and the bridge writes nothing until the child exits - measured, the socket is silent for 100% of the run - so it capped answers below the bridge's own 300s CLI ceiling. Now `conduit.requestTimeout`, default 330s. (2) streamWithFallback retried on any error including that timeout, spending up to four budgets and four killed CLI runs. (3) The timeout classifier tested `msg.includes('timeout')` against "timed out", so the friendly branch was dead while the bridge's own "timeout: ... killed by supervisor" was mislabelled as a client timeout; replaced with a typed RequestTimeoutError. (4) Stop set a flag and stopped reading but never closed the socket, so the CLI ran to completion - CompletionOptions now carries an AbortSignal and chat can cancel too, not just the agent loop. (5) cli-gemini/gemini-3.5-flash-high is retired upstream but was offered in three quick pickers; in fixIssue the worktree and branch are created before the spawn, so picking it orphaned both. (6) spawnCliAgent sent mode=agent without cwd, which the bridge refuses with HTTP 400 that surfaced only in the output channel. (7) Unknown model ids defaulted to tier 2, which excludes Agent mode - with a discovered catalog every new model is unknown, so 21 of 36 live CLI models were silently barred; default is now tier 1 and the picker prefers the bridge's display_name and matches selections by id, not by a label that is not unique. (8) cli-gemini advertises a million-token window but agy takes the prompt on argv and the bridge rejects past 30000 chars; trimming now honours `max_prompt_chars` from conduit-bridge 0.8.1. Requires conduit-bridge 0.8.1 for (8) only; the field is optional and its absence changes nothing.

> Note (2026-09-02, grok-4.6): Removed `.github/workflows/llm-validation.yml` (not a PR gate; last cron died at npm ci). Schema tests stay in CI. Cutting GitHub Release v0.9.0 with vsix. Requires conduit-bridge v0.7.0+.

> Note (2026-09-02, grok-4.6): Plan chat sends `mode: plan` and spawn sends `mode: agent` with workspace `cwd`. Host-side Agent mode stays `mode: chat`. Requires conduit-bridge `mode` on chat completions. Version 0.9.0.

> Note (2026-07-18, claude-opus-4-8): Adopted CLI-based AAHP conformance v3.8.0. Stopped vendoring the package-provided gate scripts (removed scripts/_aahp-lib.sh, aahp-manifest.sh, lint-handoff.sh, verify-handoff.sh, install-hooks.sh, verify-hooks.sh, scripts/hooks/pre-commit, scripts/hooks/pre-push); the repo-specific scripts/validate-pii-allowlist.py stays. CI (.github/workflows/aahp-verify.yml) now runs the pinned CLI (npm ci + npx aahp verify/doctor) instead of bash scripts/verify-handoff.sh. Added GROUNDING.md, LOG-ARCHIVE.md, .aiignore and a TRUST.md Provenance section via aahp migrate-grounding. Pinned @elvatis_com/aahp 3.8.0 (exact) in devDependencies + aahp.config.json (pinnedDep, em-dash forbidden pattern). Regenerated MANIFEST (fixes next_task_id integer type).

> Note (2026-07-14, claude-opus-4-8): Synced the canonical AAHP gate scripts from homeofe/improvements (v3.5.0 fixes: aahp-manifest.sh --phase documentation + cross_repo_ref preservation, lint-handoff.sh SC2034), AAHP_HANDOFF_FILES preserved, and refreshed the local hook tooling (scripts/hooks/, install-hooks.sh, verify-hooks.sh). Fleet re-sync.

> Note (2026-07-14, claude-opus-4-8): Synced the canonical Layer 3 tolerance fix from homeofe/improvements. verify-handoff.sh now downgrades a non-ancestor MANIFEST.last_session.commit from FAIL to WARN so a squash-merge or rebase-merge no longer trips AAHP Verify Layer 3 on main; Layers 1-2 still gate real staleness.

# STATUS - conduit-vscode

## Current Version: 0.10.1 (GitHub .vsix only - Marketplace publishing dropped by decision 2026-07-17; issue #85 locked)

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
| Bridge Manager Panel | Done | Start/stop/restart/logs + Open Dashboard; connected via `/v1/status.connected` |
| Auto-start bridge | Done | Starts conduit-bridge on activate if proxy unreachable |
| Model-Mode Compatibility | Done | Warnings when model doesn't support current mode |
| Model Switch Handoff | Done | Context summary when switching models mid-conversation |
| Multi-turn Agent Loop (T-016) | Done | AgentLoop controller: stream -> parse tool calls -> execute -> feed results back; duplicate-call detection, error feedback loop, destructive-action confirmation, abort |
| Agent Tools | Done | readFile, writeFile, runCommand, searchCode + worktree tools; command/branch args validated, execFile no-shell (CWE-78 hardening) |
| Agent Backends | Done | Background spawn goes through conduit-bridge HTTP; `@elvatis_com/agent-backends` removed |
| Git Worktree Isolation | Done | Parallel agent work in isolated worktrees, serialized creation, merge-aware cleanup |
| Agent Session Persistence | Done | Sessions survive VS Code restarts; Resume/Remove/Clear commands |
| Cost Tracking | Done | Per-session token/cost tracking, budget limits, per-model cost summary |

## Architecture
- Extension activates on VS Code startup (`onStartupFinished`)
- `ConduitChatViewProvider` is a WebviewViewProvider with persistent session storage via `globalState`
- Agent mode instructs models to use `### Step N: Title` format, rendered as collapsible `<details>` cards
- Markdown renderer is custom inline (no external lib), supports full GFM subset
- Model registry with 3-tier system: Tier 1 (all modes), Tier 2 (ask/edit/plan), Tier 3 (ask only)
- All AI requests (chat and background spawn) go through `proxy-client.ts` -> `conduit.proxyUrl` (default: `http://127.0.0.1:31338`)
- Bridge is the only runtime: API, CLI, and LM Studio. vscode does not spawn CLIs itself. Completions send workspace `cwd`. Plan chat sends `mode: plan`. Spawn sends `mode: agent`. Host Agent mode sends `mode: chat`. Requires conduit-bridge v0.7.0+.

## Build Status
- Build: `npm run build` - `dist/extension.js` (~201kb): Done
- Tests: `npm test` - vitest, 314 passing / 1 skipped across 17 files: Done
- .vsix packaging: `npx @vscode/vsce package --no-dependencies`: Done

## Known Issues / Gaps
- Bridge must be rebuilt separately when models change
- Marketplace listing (T-006 / issue #85): dropped 2026-07-17, confirmed 2026-09-02 - no plan to publish, distribution stays via GitHub .vsix
- T-016 / issue #84 (multi-turn agent loop): already shipped in v0.5.0-v0.7.0; resurrected AAHP issue closed as done in 0.8.0

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
| 0.7.5 | 2026-07-17 | CWE-78 hardening in agent tools, brace-expansion GHSA fix, dep sweep, @types/vscode re-pin + Dependabot ignore, CI action bumps, docs reconciliation |
| 0.7.6 | 2026-07-17 | Dev-dep maintenance: ts-eslint plugin 8.64 / eslint 10.7 / @types/node 26.1.1; held TS 6->7 (toolchain peer conflict) + Dependabot ignore for the typescript major; no runtime change |
| 0.8.0 | 2026-09-02 | Align with conduit-bridge v0.5.2: treat `connected` as provider availability so CLI/API/local providers show up; new model IDs; dashboard instead of browser login; AAHP 3.12; supply-chain-guard v6.0.10 |
| 0.9.0 | 2026-09-02 | Plan/agent CLI modes through conduit-bridge `mode` + `cwd`; dropped weekly llm-validation.yml; GitHub .vsix |

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

> 2026-07-17 release: cut v0.7.5 (first release since 2026-05-17). Ships the 2026-06-28 CWE-78 agent-tool hardening plus the dep sweep. Also: brace-expansion GHSA-jxxr-4gwj-5jf2 fixed via npm audit fix; @types/vscode re-pinned to ~1.90.0 (the Dependabot bump to 1.120 had silently undone the v0.7.4 pin and broke vsce packaging against engines.vscode ^1.90.0) with a Dependabot ignore rule added so it stays pinned; conduit-vscode-0.7.5.vsix packaged and attached to the GitHub release.

> 2026-07-17 release: cut v0.7.6. Publishing v0.7.5 triggered a fresh Dependabot batch (#72-#75); merged the 3 green dev-dep bumps (ts-eslint plugin 8.64, eslint 10.7, @types/node 26.1.1) and released them. Held #73 (typescript 6->7): @typescript-eslint/eslint-plugin@8.64 peers on typescript ">=4.8.4 <6.1.0", so TS 7 (native port) fails npm install (ERESOLVE); added a Dependabot ignore for the typescript major. Also cleaned up two merged-but-lingering remote branches (docs/handoff-refresh from #70, release/v0.7.5 from #71). Dev-only bumps, dist/extension.js unchanged.

> Note (2026-07-19): Moved the AAHP conformance pin from 3.8.0 to 3.8.1 (picks up the v3.8.1 Windows/MSYS manifest-regen fix so tasks, next_task_id and cross_repo_ref survive regeneration). No runtime behavior change on Linux or CI. Handoff refreshed and MANIFEST regenerated.

> 2026-09-02: Align extension with conduit-bridge v0.5.2. Root cause of "CLI providers not available": status UI keyed off Playwright `sessionValid`/`hasProfile`; v0.5.2 reports `connected`+`loginType`. Also refreshed model catalog, default model, dashboard login, AAHP 3.12.0, supply-chain-guard v6.0.10, and the stale Dependabot batch. Issue #84 closed as already shipped (T-016). Issue #85 locked (no Marketplace listing).

> 2026-09-02: Align extension with conduit-bridge v0.5.2. Root cause of "CLI providers not available": status UI keyed off Playwright `sessionValid`/`hasProfile`; v0.5.2 reports `connected`+`loginType`. Also refreshed model catalog, default model, dashboard login, AAHP 3.12.0, supply-chain-guard @v6, and the stale Dependabot batch. Issue #84 closed as already shipped (T-016). Issue #85 locked (no Marketplace listing).
