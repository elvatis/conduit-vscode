# LOG.md — conduit-vscode

_Reverse chronological. Latest session first._

---

## Session 2 — 2026-03-12 — BridgeManager + BridgePanel (Akido / claude-sonnet-4-6)

**Goal:** Integrate conduit-bridge management directly into the extension.

**Decisions:**
- `BridgeManager` spawns conduit-bridge as child process (not embedded as library) — cleaner process isolation, easier to debug
- Logger `onLine()` subscription API in conduit-bridge means VS Code Output Channel gets all bridge logs with zero extra code
- Health poll every 15s (not faster — avoids log spam)
- Status bar shows `N/4` providers format (more informative than just online/offline)
- `BridgePanel` is a WebviewPanel (not sidebar view) — avoids interfering with chat sidebar

**What was built:**
- `src/bridge-manager.ts` — BridgeManager (spawn, stop, restart, login, logout, status poll, log streaming)
- `src/bridge-panel.ts` — BridgePanel webview (start/stop/restart buttons, provider cards with login/logout)
- `extension.ts` — wired up BridgeManager, 10 new commands registered
- `package.json` — 10 new command contributions

**Commit:** `afb07fc`

---

## Session 1 — 2026-03-12 — Initial Build (Akido / claude-sonnet-4-6)

**Goal:** Full-featured VS Code extension for conduit-bridge.

**Decisions:**
- Single bundled file (`dist/extension.js`) via esbuild — simple, fast, no module resolution issues
- `proxy-client.ts` uses raw Node.js `http` — no external deps, works offline
- `ConduitChatPanel` is a WebviewPanel (not a sidebar TreeView) — richer UI, easier to implement streaming
- Ghost text uses `vscode.InlineCompletionItemProvider` — official API, works in all editors
- Context builder sends up to 80 lines prefix/suffix + 3 open files + diagnostics — good balance of context vs. token cost
- Keybindings: `Ctrl+Shift+G` (chat), `Ctrl+Shift+I` (inline edit), `Ctrl+Shift+E` (explain)

**What was built:** (see STATUS.md feature table)

**Commit:** `a800f01`
