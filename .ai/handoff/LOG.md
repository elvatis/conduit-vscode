# LOG.md - conduit-vscode

_Reverse chronological. Latest session first._

---

## Session 6 - 2026-09-02 - conduit-bridge 0.8.x alignment

- Request timeout is a whole-turn budget, not an idle timer (the bridge sends nothing until the CLI exits). Configurable, default 330s.
- A timeout no longer triggers the fallback chain; it used to spend four budgets and four CLI runs.
- Typed RequestTimeoutError; the old substring test classified every case backwards.
- Stop now aborts the request, which is what makes the bridge kill the CLI.
- Removed the retired cli-gemini/gemini-3.5-flash-high and repointed its fallback.
- spawnCliAgent fails early without a workspace instead of an opaque HTTP 400.
- Unknown model ids default to tier 1; the picker uses the bridge's display_name and matches by id.
- Trimming honours max_prompt_chars (conduit-bridge 0.8.1) so an agy prompt cannot exceed its argv ceiling.
- OPEN: MODEL_LIMITS/MODEL_TIERS/MODEL_DISPLAY_NAMES can only be deleted once /v1/models also reports
  context_window and max_output_tokens; the bridge does not yet.

---

## Session 5 - 2026-09-02 - conduit-bridge v0.5.2 align + CLI connected detection

**Goal:** Match conduit-vscode to conduit-bridge v0.5.2, fix CLI providers not showing as available, clear Dependabot PRs #78-#83, close/lock AAHP issues #84 and #85.

**Decisions:**
- Provider availability is `/v1/status.connected` (plus `loginType` / `credentialSource`). Playwright `sessionValid`/`hasProfile` is gone with the web providers.
- Login in VS Code opens the bridge dashboard. `/v1/login` and `/v1/logout` 404 on v0.5.2.
- supply-chain-guard pinned to exact `@v6.0.10` (2026-09-02 threat-intel batch + vscode-scanner), not the old `@v5` rolling pin.
- T-016 (#84) already shipped in v0.5.0-v0.7.0; close the resurrected issue. T-006 (#85) stays dropped and is locked.

**What was done:**
- Added `src/bridge-status.ts` to normalize v0.5.2 status payloads
- Wired Bridge Manager, Health Dashboard, and status bar to `connected`
- Refreshed model registry / CLI catalog / default model to live IDs (`cli-grok`, `cli-claude`, `cli-gemini`, `cli-codex`, `api-*`, `lmstudio`)
- AAHP 3.12.0 + verify workflow contract; Dependabot batch superseded in this bump

---

## Session 4 - 2026-07-17 - Backlog close-out + Dependabot sweep (claude-fable-5)

**Goal:** Merge open Dependabot PRs, resolve the two remaining backlog issues, reconcile stale handoff docs.

**Decisions:**
- T-006 (Marketplace listing, issue #53) dropped: no plan to publish conduit to the VS Code Marketplace, matching the same-day decision to keep conduit tooling off npm. Distribution stays via GitHub .vsix.
- T-016 (Multi-turn agent loop, issue #52) was already fully shipped in v0.5.0-v0.7.0 (AgentLoop controller, tool executor, confirmation UI, step cards, error feedback, persistence, cost tracking) - the handoff docs were simply stale at v0.3.0. Verified: 314 tests pass, build clean. Closed as done rather than re-implemented.

**What was done:**
- Merged Dependabot PRs #62-#66, #69 (setup-node 7, eslint 10.6, vitest 4.1.10, typescript-eslint 8.63, coverage-v8) via sequential rebase queue
- Closed issues #52 (done) and #53 (dropped)
- Reconciled STATUS.md, NEXT_ACTIONS.md, DASHBOARD.md, MANIFEST.json task states with the actual v0.7.4 codebase
- Added `.ai/logs/` to .gitignore
- Cut release v0.7.5: first release since 2026-05-17, ships the June CWE-78 hardening + dep sweep; fixed brace-expansion GHSA-jxxr-4gwj-5jf2 via npm audit fix; re-pinned @types/vscode to ~1.90.0 (vsce packaging vs engines.vscode, the Dependabot 1.120 bump had silently undone the v0.7.4 pin) and added a Dependabot ignore rule for it; packaged and attached conduit-vscode-0.7.5.vsix to the GitHub release
- Cut release v0.7.6: the v0.7.5 publish triggered a new Dependabot batch (#72-#75). Merged the 3 green dev-dep bumps (ts-eslint plugin 8.64, eslint 10.7, @types/node 26.1.1). Held #73 (typescript 6->7): ts-eslint plugin 8.64 peers on typescript ">=4.8.4 <6.1.0" so TS 7 fails npm install; closed it and added a Dependabot ignore for the typescript major. Cleaned up two merged-but-lingering remote branches (docs/handoff-refresh, release/v0.7.5). Dev-only, dist unchanged; packaged conduit-vscode-0.7.6.vsix.

---

## Session 3 - 2026-03-15 - Agent Steps, Markdown, Codebase Search (claude-opus-4-6)

**Goal:** Fix model selection bug, improve output formatting, add workspace context, agent step UI.

**Decisions:**
- Model quick pick label cleaning must strip ALL VS Code icons (`$(check)`, `$(star-full)`, `$(star-half)`) before matching - previous code only stripped `$(check)`
- Markdown renderer rewritten from scratch - line-by-line block processing with inline formatting pass, no external libraries (webview must be self-contained)
- `#workspace` = folder structure (lightweight), `#codebase` = folder structure + file contents (deep) - swapped from initial design per user feedback that "codebase" implies reading code, "workspace" implies the folder
- Agent step detection happens inside `renderMd()` itself - detects `### Step N: Title` pattern and wraps in `<details>` elements with CSS spinner/checkmark
- Agent system prompt instructs models to use `### Step N:` format for structured output

**What was built:**
- Fixed model selection bug (tier icons in label matching)
- Complete markdown renderer: h1-h6, ul/ol, blockquotes, tables, hr, bold/italic, links, code blocks
- `#workspace` mention (folder overview) + `#codebase` mention (deep file search, 30 files, ~80K chars)
- Agent step cards: collapsible `<details>`, spinner while streaming, checkmark when done
- Comprehensive `/help` command with examples and keyboard shortcuts
- CLAUDE.md created for project conventions

**Commits:** `660b7fe`, `11d3b73`, `28f28e8`

---

## Session 2 - 2026-03-12 - BridgeManager + BridgePanel (claude-sonnet-4-6)

**Goal:** Integrate conduit-bridge management directly into the extension.

**Decisions:**
- `BridgeManager` spawns conduit-bridge as child process - cleaner process isolation
- Health poll every 15s (not faster - avoids log spam)
- Status bar shows `N/4` providers format
- `BridgePanel` is a WebviewPanel (not sidebar view)

**What was built:**
- `src/bridge-manager.ts` - BridgeManager (spawn, stop, restart, login, logout, status poll, log streaming)
- `src/bridge-panel.ts` - BridgePanel webview (start/stop/restart buttons, provider cards with login/logout)
- `extension.ts` - wired up BridgeManager, 10 new commands registered

**Commit:** `afb07fc`

---

## Session 1 - 2026-03-12 - Initial Build (claude-sonnet-4-6)

**Goal:** Full-featured VS Code extension for conduit-bridge.

**Decisions:**
- Single bundled file (`dist/extension.js`) via esbuild
- `proxy-client.ts` uses raw Node.js `http` - no external deps
- `ConduitChatPanel` is a WebviewPanel - richer UI, easier streaming
- Ghost text uses `vscode.InlineCompletionItemProvider`
- Keybindings: `Ctrl+Shift+G` (chat), `Ctrl+Shift+I` (inline edit), `Ctrl+Shift+E` (explain)

**Commit:** `a800f01`
