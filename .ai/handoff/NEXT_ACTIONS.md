# NEXT_ACTIONS.md — conduit-vscode

_Last updated: 2026-03-12_

## Status Summary

| Status  | Count |
|---------|-------|
| Done    | 2     |
| Ready   | 5     |
| Blocked | 0     |

---

## ⚡ Ready — Work These Next

### T-002: [high] — Auto-start bridge on extension activate

- **Goal:** When the extension activates and the proxy is not reachable, automatically start conduit-bridge.
- **What to do:**
  1. In `extension.ts` activate(), after creating BridgeManager: call `bridgeManager.start()` if `!(await checkHealth())`
  2. Show progress notification while starting
  3. If conduit-bridge binary not found: show install prompt (already in BridgeManager.start())
- **Definition of done:** Opening VS Code starts conduit-bridge automatically if not running.

### T-003: [medium] — Inline suggestion system prompt tuning

- **Goal:** Improve ghost text quality for different languages.
- **What to do:**
  1. Per-language system prompts in `context-builder.ts`
  2. For Python/JS/TS: optimize for code completion style
  3. For Markdown: complete sentence/paragraph style
  4. Test with Grok-3, Claude-Sonnet, Gemini-Pro
- **Definition of done:** Inline suggestions feel natural in Python, TypeScript, and Markdown.

### T-004: [medium] — Add test suite (vitest or @vscode/test-cli)

- **Goal:** Basic tests for proxy-client, context-builder, config.
- **What to do:**
  1. Mock `vscode` API for unit tests
  2. Test `buildEditorContext` with mock TextDocument
  3. Test `proxy-client` with mock HTTP server
  4. Test `buildSystemPrompt` output format
- **Definition of done:** `npm test` green, at least 20 tests.

### T-005: [medium] — Package as .vsix

- **Goal:** Distributable `.vsix` file for manual install.
- **What to do:**
  1. `npm install -g @vscode/vsce`
  2. Add real `media/icon.png` (128x128)
  3. `vsce package`
  4. Attach to GitHub Release
- **Definition of done:** `.vsix` attached to GitHub Release v0.1.0.

### T-006: [low] — VS Code Marketplace listing

- **Goal:** Public listing on marketplace.visualstudio.com.
- **Prerequisite:** T-004 (tests) + T-005 (.vsix)
- **Note:** Requires publisher account + review. Consider making repo public first.
- **Definition of done:** `vsce publish` successful, extension findable on marketplace.

---

## 🚫 Blocked

_No blocked tasks._

---

## ✅ Recently Completed

| Task  | Title | Date |
|---|---|---|
| T-001 | Scaffold extension + all core features | 2026-03-12 |
| T-007 | Add BridgeManager + BridgePanel | 2026-03-12 |
