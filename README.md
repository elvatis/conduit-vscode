# Conduit - Universal AI Bridge for VS Code

Connect VS Code to **any AI provider** via an OpenAI-compatible local proxy.
Out of the box: Grok, Claude, Gemini, ChatGPT - powered by [conduit-bridge](https://github.com/elvatis/conduit-bridge).

> **Status:** Early development - private repo. Requires conduit-bridge running locally.

---

## Features

- **Chat Panel** - full conversation UI with model switching, streaming, and persistent history
- **Chat History** - sessions saved across panel close and VS Code restart (up to 50 sessions)
- **Model Selector** - switch models from the chat toolbar or status bar, persisted to settings
- **Health Dashboard** - real-time status page showing providers, models, uptime, and version
- **Inline Suggestions** - ghost-text completions as you type (like Copilot)
- **Inline Edit** - select code, give instruction, AI rewrites it in-place (`Ctrl+Shift+I`)
- **Explain / Refactor / Generate Tests** - right-click context menu on any selection
- **Fix Diagnostics** - send all errors/warnings in a file to the AI with one click
- **Terminal Command Suggestions** - describe what you want to do, get a shell command
- **Editor Context** - open files, diagnostics, and surrounding code included automatically
- **Status Bar** - live proxy health + current model display, click to open health dashboard
- **Bridge Manager** - start/stop/restart conduit-bridge, per-provider login/logout, live logs
- **Auto-start bridge** - automatically starts conduit-bridge on extension activation if not running
- **Per-language inline prompts** - tuned completion prompts for TypeScript, Python, Go, Rust, Markdown, and more
- **Provider switching** - switch between Grok, Claude, Gemini, ChatGPT from the UI

## Requirements

- VS Code 1.90+
- [conduit-bridge](https://github.com/elvatis/conduit-bridge) running on `127.0.0.1:31338`

## Setup

1. Start conduit-bridge: `conduit-bridge start`
2. Install this extension (`.vsix` or from source)
3. Open command palette - `Conduit: Health Dashboard` to verify connection

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+G` | Open Chat |
| `Ctrl+Shift+I` | Inline Edit selection |
| `Ctrl+Shift+E` | Explain selection |

## Configuration

| Setting | Default | Description |
|---|---|---|
| `conduit.proxyUrl` | `http://127.0.0.1:31338` | Proxy base URL |
| `conduit.apiKey` | `cli-bridge` | API key |
| `conduit.defaultModel` | `cli-gemini/gemini-2.5-pro` | Default model |
| `conduit.inlineSuggestions` | `true` | Enable ghost-text completions |
| `conduit.inlineTriggerDelay` | `600` | Delay before requesting completion (ms) |
| `conduit.contextLines` | `80` | Lines of code context to include |
| `conduit.includeOpenFiles` | `true` | Include other open tabs as context |
| `conduit.terminalIntegration` | `true` | Enable terminal command suggestions |

## Install from .vsix

```bash
code --install-extension conduit-vscode-0.2.0.vsix
```

Or in VS Code: Extensions > ... > Install from VSIX...

## Development

```bash
git clone https://github.com/elvatis/conduit-vscode
cd conduit-vscode
npm install --include=dev
npm run dev   # watch mode
npm test      # run tests (vitest)
# Press F5 in VS Code to launch Extension Development Host
```

## Packaging

```bash
npx @vscode/vsce package --allow-missing-repository
```
