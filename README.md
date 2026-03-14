# Conduit - Universal AI Bridge for VS Code

Connect VS Code to **any AI provider** via an OpenAI-compatible local proxy.
Out of the box: Grok, Claude, Gemini, ChatGPT, OpenAI Codex, BitNet - powered by [conduit-bridge](https://github.com/elvatis/conduit-bridge).

> **Status:** Early development - private repo. Requires conduit-bridge running locally.

---

## Features

### Chat
- **Panel chat** (alongside Copilot/Claude Code tabs) with streaming responses and Markdown rendering
- **4 chat modes** - Ask (Q&A), Edit (code changes), Agent (autonomous multi-step), Plan (implementation planning)
- **Native Sessions tree view** - persistent across VS Code restarts, load/delete/new with toolbar actions (like Copilot)
- **Slash commands** - `/help`, `/fix`, `/explain`, `/tests`, `/refactor`, `/plan`, `/commit`, `/clear`, `/new`, `/cost`, `/model`, `/mode`
- **#-mention context** - `#file:path`, `#selection`, `#problems`, `#codebase`, `#terminal` to attach context inline
- **Autocomplete for commands** - type `/` to see available commands with descriptions

### Models
- **30+ models** from all providers (CLI, web session, Codex, local inference)
- **Native QuickPick model selector** - full-width searchable picker grouped by provider with context window sizes
- **Auto model selection** - automatically picks the best model based on task complexity
- **Per-message model tracking** - see which model generated each response
- **Context window awareness** - automatically trims conversation history to fit model limits
- **Friendly display names** - "Claude Opus 4.6" instead of raw model IDs

### Code Intelligence
- **Inline completions** (ghost text) - like Copilot, language-aware for 20+ languages
- **Inline Chat (Ctrl+I)** - describe a change at the cursor, see a diff, accept or reject
- **Inline diffs** - proposed changes shown as a VS Code diff for review
- **Explain / Refactor / Generate Tests** - right-click context menu on any selection
- **Fix diagnostics** - send all errors/warnings in a file to the AI
- **Terminal command suggestions** - describe what you want, get a shell command

### Context & Intelligence
- **Custom instructions** - `.conduit/instructions.md` (project), `~/.conduit/instructions.md` (global), also reads `CLAUDE.md` and `.github/copilot-instructions.md`
- **Editor context** - open files, diagnostics, and surrounding code included automatically
- **Cost tracking** - `/cost` shows estimated token usage per session
- **Commit message generation** (`Ctrl+Shift+M`) - generates from staged git diff and sets in SCM input

### Infrastructure
- **Health dashboard** - real-time provider status, model listing, uptime
- **Bridge manager** - start/stop/restart conduit-bridge, per-provider login/logout, live logs
- **Auto-start bridge** - automatically starts on activation if not running
- **Status bar** - live health + current model display

## Requirements

- VS Code 1.90+
- [conduit-bridge](https://github.com/elvatis/conduit-bridge) running on `127.0.0.1:31338`

## Setup

1. Start conduit-bridge: `conduit-bridge start`
2. Install this extension (`.vsix` or from source)
3. Conduit Chat appears in the bottom panel - drag it to the secondary sidebar (right side) next to Copilot/Claude Code
4. Use `Conduit: Health Dashboard` to verify all providers

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+G` | Open Chat panel |
| `Ctrl+I` | Inline Chat (edit at cursor) |
| `Ctrl+Shift+I` | Inline Edit selection |
| `Ctrl+Shift+E` | Explain selection |
| `Ctrl+Shift+M` | Generate commit message |

## Slash Commands

| Command | Description |
|---|---|
| `/help` | Show all commands and shortcuts |
| `/fix` | Fix errors in current file |
| `/explain` | Explain selected code |
| `/tests` | Generate tests for selection |
| `/refactor [instruction]` | Refactor selected code |
| `/plan [task]` | Create implementation plan |
| `/commit` | Generate commit message from staged changes |
| `/clear` | Clear current chat |
| `/new` | Start new chat session |
| `/cost` | Show estimated token usage |
| `/model [name]` | Switch model (or list available) |
| `/mode [ask\|edit\|agent\|plan]` | Switch chat mode |

## Context Mentions

Type these in your chat message to attach context:

| Mention | What it attaches |
|---|---|
| `#file:src/main.ts` | Full file content |
| `#file:src/main.ts:10-20` | Lines 10-20 of a file |
| `#selection` | Current editor selection |
| `#problems` | Errors/warnings in current file |
| `#codebase` | Workspace file structure overview |
| `#terminal` | Terminal output (via paste) |

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

## Custom Instructions

Create a `.conduit/instructions.md` file in your project root to provide project-specific context to all chat interactions. Conduit also reads:
- `~/.conduit/instructions.md` - global instructions
- `CLAUDE.md` - project-level (Claude Code compatible)
- `.github/copilot-instructions.md` - project-level (Copilot compatible)

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
