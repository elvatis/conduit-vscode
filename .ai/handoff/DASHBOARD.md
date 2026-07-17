# DASHBOARD - conduit-vscode

_Quick-glance state for autonomous agents. Last updated: 2026-07-17_

## Current State

| Item | Value |
|---|---|
| Version | 0.7.5 |
| Build | passes (`npm run build`, ~201kb) |
| Tests | 314 passing / 1 skipped (`npm test`, vitest, 17 files) |
| .vsix packaged | conduit-vscode-0.7.5.vsix |
| Installed locally | elvatis.conduit-vscode |
| Default proxy | http://127.0.0.1:31338 |
| Marketplace | dropped by decision 2026-07-17 (no plan to publish; GitHub .vsix only) |
| GitHub | https://github.com/elvatis/conduit-vscode |
| Latest release | v0.7.5 |
| Next task | none - backlog clear |

## Features (v0.7.5)

| Feature | Status |
|---|---|
| Chat Panel | Done |
| Multi-turn Agent Loop (tool calls, confirmation, error feedback) | Done |
| Agent Tools (readFile/writeFile/runCommand/searchCode/worktrees) | Done |
| Agent Backends (Claude CLI, Gemini CLI, Codex, OpenCode, Pi) | Done |
| Background Agent Sessions (spawn/monitor/kill, persistence, resume) | Done |
| Git Worktree Isolation | Done |
| Cost Tracking (per session, budget limits) | Done |
| Agent Step Cards (collapsible) | Done |
| Full Markdown Rendering | Done |
| Chat History Persistence | Done |
| Model Selector (QuickPick + status bar) | Done |
| Mode Selector (Ask/Edit/Agent/Plan) | Done |
| Auto Model Selection | Done |
| Context Mentions (#file, #selection, #problems, #workspace, #codebase, #terminal) | Done |
| Health Dashboard | Done |
| Inline Suggestions | Done |
| Inline Edit / Inline Chat | Done |
| Explain / Refactor / Tests / Fix | Done |
| Terminal Suggestions | Done |
| Commit Message Generation | Done |
| Custom Instructions | Done |
| Bridge Manager Panel | Done |
| Auto-start bridge | Done |
| Model-Mode Compatibility | Done |

## Unblocked Tasks (priority order)

_None. T-016 done (issue #52 closed), T-006 dropped (issue #53 closed)._

## Related Projects
- `conduit-bridge` - Playwright-based proxy (must be installed separately)
- `openclaw-cli-bridge-elvatis` - Server-side equivalent (OpenClaw plugin)
