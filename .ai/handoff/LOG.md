# LOG.md - conduit-vscode

_Reverse chronological. Latest session first._

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
