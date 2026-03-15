# DASHBOARD - conduit-vscode

_Quick-glance state for autonomous agents. Last updated: 2026-03-15_

## Current State

| Item | Value |
|---|---|
| Version | 0.3.0 |
| Build | passes (`npm run build`, ~123kb) |
| Tests | 30 passing (`npm test`, vitest) |
| .vsix packaged | conduit-vscode-0.3.0.vsix (49.56 KB) |
| Installed locally | elvatis.conduit-vscode |
| Default proxy | http://127.0.0.1:31338 |
| Marketplace | not yet (T-006) |
| GitHub | https://github.com/elvatis/conduit-vscode |
| Latest release | v0.3.0 |
| Next task | T-016 - Multi-turn agent loop |

## Features (v0.3.0)

| Feature | Status |
|---|---|
| Chat Panel | Done |
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
1. **T-016** [high] - Multi-turn agent loop architecture
2. **T-006** [low] - Marketplace listing

## Related Projects
- `conduit-bridge` - Playwright-based proxy (must be installed separately)
- `openclaw-cli-bridge-elvatis` - Server-side equivalent (OpenClaw plugin)
