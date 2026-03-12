# Conduit — Universal AI Bridge for VS Code

Connect VS Code to **any AI provider** via an OpenAI-compatible local proxy.
Out of the box: Grok, Claude, Gemini, ChatGPT — powered by [cli-bridge](https://github.com/elvatis/openclaw-cli-bridge-elvatis).

> **Status:** Early development — private repo. Requires cli-bridge running locally.

---

## Features

- **Chat Panel** — full conversation UI in the sidebar, with model switching and history
- **Inline Suggestions** — ghost-text completions as you type (like Copilot)
- **Inline Edit** — select code, give instruction, AI rewrites it in-place (`Ctrl+Shift+I`)
- **Explain / Refactor / Generate Tests** — right-click context menu on any selection
- **Fix Diagnostics** — send all errors/warnings in a file to the AI with one click
- **Terminal Command Suggestions** — describe what you want to do, get a shell command
- **Editor Context** — open files, diagnostics, and surrounding code included automatically
- **Status Bar** — live proxy health indicator with model count
- **Provider switching** — switch between Grok, Claude, Gemini, ChatGPT from the UI

## Requirements

- VS Code 1.90+
- [openclaw-cli-bridge-elvatis](https://github.com/elvatis/openclaw-cli-bridge-elvatis) running on `127.0.0.1:31337`

## Setup

1. Start cli-bridge (part of OpenClaw gateway)
2. Install this extension (`.vsix` or from source)
3. Open command palette → `Conduit: Check Proxy Status` to verify

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+G` | Open Chat |
| `Ctrl+Shift+I` | Inline Edit selection |
| `Ctrl+Shift+E` | Explain selection |

## Configuration

| Setting | Default | Description |
|---|---|---|
| `conduit.proxyUrl` | `http://127.0.0.1:31337` | Proxy base URL |
| `conduit.apiKey` | `cli-bridge` | API key |
| `conduit.defaultModel` | `cli-gemini/gemini-2.5-pro` | Default model |
| `conduit.inlineSuggestions` | `true` | Enable ghost-text completions |
| `conduit.inlineTriggerDelay` | `600` | Delay before requesting completion (ms) |
| `conduit.contextLines` | `80` | Lines of code context to include |
| `conduit.includeOpenFiles` | `true` | Include other open tabs as context |
| `conduit.terminalIntegration` | `true` | Enable terminal command suggestions |

## Development

```bash
git clone https://github.com/elvatis/conduit-vscode
cd conduit-vscode
npm install
npm run dev   # watch mode
# Press F5 in VS Code to launch Extension Development Host
```
