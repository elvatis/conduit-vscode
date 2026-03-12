# DASHBOARD — conduit-vscode

_Quick-glance state for autonomous agents. Last updated: 2026-03-12_

## 🚦 Current State

| Item | Value |
|---|---|
| Version | 0.1.0 |
| Build | ✅ passes (`npm run build`, 37.8kb) |
| Tests | ❌ none yet (T-004) |
| .vsix packaged | ❌ not yet (T-005) |
| Marketplace | ❌ not yet (T-006) |
| GitHub | ✅ https://github.com/elvatis/conduit-vscode |
| Next task | T-002 — Auto-start bridge on activate |

## 📦 Features

| Feature | Status |
|---|---|
| Chat Panel | ✅ |
| Inline Suggestions | ✅ |
| Inline Edit | ✅ |
| Explain / Refactor / Tests | ✅ |
| Fix Diagnostics | ✅ |
| Terminal Suggestions | ✅ |
| Bridge Manager Panel | ✅ |
| Auto-start bridge | ❌ T-002 |

## ⚡ Unblocked Tasks (priority order)
1. **T-002** [high] — Auto-start bridge on activate
2. **T-003** [medium] — Inline suggestion system prompt tuning
3. **T-004** [medium] — Test suite
4. **T-005** [medium] — Package .vsix
5. **T-006** [low] — Marketplace listing

## 🔗 Related Projects
- `conduit-bridge` — The proxy this extension manages (must be installed separately for now)
- `openclaw-cli-bridge-elvatis` — Server-side equivalent (OpenClaw plugin)
