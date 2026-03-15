# NEXT_ACTIONS.md - conduit-vscode

_Last updated: 2026-03-15_

## Status Summary

| Status  | Count |
|---------|-------|
| Done    | 18    |
| Ready   | 2     |
| Blocked | 0     |

---

## Ready - Work These Next

### T-016: [high] - Multi-turn agent loop

- **Goal:** Autonomous agent that can execute multi-step plans with tool use (file read/write, terminal commands), self-correct on errors, and show each step as a visible sub-process bubble.
- **Architecture needed:**
  - Agent loop controller (orchestrates multiple model calls)
  - Tool definitions (readFile, writeFile, runCommand, searchCode)
  - User confirmation UI for destructive actions
  - Step status bubbles in the chat (running/done/failed)
  - Error feedback loop (agent sees errors and retries)
- **Definition of done:** Agent can autonomously complete a multi-file task with visible progress.

### T-006: [low] - VS Code Marketplace listing

- **Goal:** Public listing on marketplace.visualstudio.com.
- **Note:** Requires publisher account + review.
- **Definition of done:** `vsce publish` successful, extension findable on marketplace.

---

## Blocked

_No blocked tasks._

---

## Recently Completed

| Task  | Title | Date |
|---|---|---|
| T-001 | Scaffold extension + all core features | 2026-03-12 |
| T-007 | Add BridgeManager + BridgePanel | 2026-03-12 |
| T-002 | Auto-start bridge on extension activate | 2026-03-14 |
| T-003 | Inline suggestion system prompt tuning (per-language) | 2026-03-14 |
| T-004 | Add test suite (vitest, 30 tests) | 2026-03-14 |
| T-005 | Package as .vsix + icon | 2026-03-14 |
| T-008 | Chat history persistence | 2026-03-14 |
| T-009 | Model selector in status bar + chat toolbar | 2026-03-14 |
| T-010 | Health dashboard webview panel | 2026-03-14 |
| T-011 | Native QuickPick model/mode selectors | 2026-03-14 |
| T-012 | Native Sessions tree view | 2026-03-14 |
| T-013 | 30+ model registry with display names | 2026-03-14 |
| T-014 | Streaming error handling | 2026-03-14 |
| T-015 | Comprehensive README documentation | 2026-03-14 |
| T-017 | Fix model selection (tier icon label matching bug) | 2026-03-15 |
| T-018 | Full markdown rendering (headings, lists, blockquotes, etc.) | 2026-03-15 |
| T-019 | #workspace and #codebase context mentions | 2026-03-15 |
| T-020 | Agent step cards with collapsible UI | 2026-03-15 |
