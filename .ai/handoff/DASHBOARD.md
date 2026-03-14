# DASHBOARD - conduit-vscode

_Quick-glance state for autonomous agents. Last updated: 2026-03-14_

## Current State

| Item | Value |
|---|---|
| Version | 0.2.0 |
| Build | passes (`npm run build`, 54.8kb) |
| Tests | 30 passing (`npm test`, vitest) |
| .vsix packaged | conduit-vscode-0.2.0.vsix (20.86 KB) |
| Installed locally | elvatis.conduit-vscode |
| Default proxy | http://127.0.0.1:31338 |
| Marketplace | not yet (T-006) |
| GitHub | https://github.com/elvatis/conduit-vscode |
| Next task | T-006 - VS Code Marketplace listing |

## Features

| Feature | Status |
|---|---|
| Chat Panel | Done |
| Chat History Persistence | Done |
| Model Selector (toolbar + status bar) | Done |
| Health Dashboard | Done |
| Inline Suggestions | Done |
| Inline Edit | Done |
| Explain / Refactor / Tests | Done |
| Fix Diagnostics | Done |
| Terminal Suggestions | Done |
| Bridge Manager Panel | Done |
| Auto-start bridge | Done |
| Per-language inline prompts | Done |

## Unblocked Tasks (priority order)
1. **T-006** [low] - Marketplace listing

## Related Projects
- `conduit-bridge` - The proxy this extension manages (must be installed separately for now)
- `openclaw-cli-bridge-elvatis` - Server-side equivalent (OpenClaw plugin)
