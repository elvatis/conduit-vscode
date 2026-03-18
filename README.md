# Conduit - Universal AI Bridge for VS Code

[![CI](https://github.com/elvatis/conduit-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/elvatis/conduit-vscode/actions/workflows/ci.yml)
[![LLM Validation](https://github.com/elvatis/conduit-vscode/actions/workflows/llm-validation.yml/badge.svg)](https://github.com/elvatis/conduit-vscode/actions/workflows/llm-validation.yml)

Connect VS Code to **any AI provider** through a single extension. One chat interface for Grok, Claude, Gemini, ChatGPT, OpenAI Codex, OpenCode, Pi, and local models, powered by [conduit-bridge](https://github.com/elvatis/conduit-bridge).

**Current version:** 0.7.0

> **Status:** Active development. All core features implemented and tested (301 tests). Requires conduit-bridge running locally.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Background Agents](#background-agents)
- [Supported Models](#supported-models)
- [Chat Interface](#chat-interface)
- [Chat Modes](#chat-modes)
- [Agent Mode](#agent-mode)
- [Model Selection](#model-selection)
- [Session Management](#session-management)
- [Slash Commands](#slash-commands)
- [Context Mentions](#context-mentions)
- [Code Intelligence](#code-intelligence)
- [Inline Chat](#inline-chat)
- [Custom Instructions](#custom-instructions)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Configuration](#configuration)
- [Provider Setup](#provider-setup)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Roadmap](#roadmap)

---

## Quick Start

### Prerequisites

- VS Code 1.90 or newer
- [conduit-bridge](https://github.com/elvatis/conduit-bridge) installed and running

### Installation

**Option A - From .vsix file:**
```bash
code --install-extension conduit-vscode-0.7.0.vsix
```
Or in VS Code: `Extensions > ... > Install from VSIX...`

**Option B - From source:**
```bash
git clone https://github.com/elvatis/conduit-vscode
cd conduit-vscode
npm install --include=dev
npx @vscode/vsce package --no-dependencies
code --install-extension conduit-vscode-0.7.0.vsix
```

### First Launch

1. Start the bridge: `conduit-bridge start`
2. Open VS Code, the extension activates automatically
3. The **Conduit AI** panel appears in the bottom panel area
4. **Drag the Conduit AI tab** to the secondary sidebar (right side) to place it next to Copilot / Claude Code
5. Click the model name in the toolbar to select your preferred model
6. Start chatting

> **Note:** After first install, you must **fully close and reopen VS Code** (not just reload) for the Sessions panel to appear. VS Code only reads new view registrations on startup.

---

## Features

### Chat Interface
- Streaming responses with full Markdown rendering (headings, code blocks, tables, lists, blockquotes, bold, italic, links)
- Copy and insert-code actions on every response
- Per-message model tag showing which model generated each response
- Automatic context window management, trims conversation history to fit model limits
- Token usage tracking via `/cost`

### Agent Step Cards
- In Agent mode, responses are structured as collapsible step cards
- Each step shows an animated **spinner** while streaming, then a **green checkmark** when complete
- Steps are click-to-expand/collapse for easy navigation
- Models are instructed to use `### Step N: Title` format for structured output

### Sessions (History)
- Native VS Code tree view panel (like GitHub Copilot's Sessions)
- Persistent across VS Code restarts (up to 50 sessions)
- Click any session to reload the full conversation
- **New Session** button (+) and **Refresh** button in the panel title bar
- **Delete** button (trash icon) on hover for each session
- Sessions auto-save after each message exchange

### Model Selection
- **Native VS Code QuickPick**, opens a full-width, searchable picker at the top of the editor
- Models grouped by provider (WEB-GROK, WEB-CLAUDE, WEB-GEMINI, etc.)
- Tier icons: star for flagship models, half-star for mid-tier
- Context window size shown next to each model (131K, 200K, 1M)
- Friendly display names with version numbers (e.g. "Claude Sonnet 4.6", "Grok Expert")
- **Auto mode**, automatically selects the best model based on task complexity
- Model-mode compatibility warnings when a model doesn't support the current chat mode

### Code Intelligence
- **Inline completions** (ghost text), language-aware for 20+ languages
- **Inline Chat** (`Ctrl+I`), describe a change at the cursor, review as a diff
- **Explain / Refactor / Generate Tests**, right-click context menu on selections
- **Fix diagnostics**, send all file errors/warnings to the AI
- **Terminal command suggestions**, describe what you want, get a shell command
- **Commit message generation** (`Ctrl+Shift+M`), generates from staged git diff

### Infrastructure
- **Health dashboard** (`Conduit: Health Dashboard`), real-time provider status
- **Bridge manager**, start/stop/restart conduit-bridge from VS Code
- **Per-provider login**, Grok, Claude, Gemini, ChatGPT login commands
- **Auto-start bridge**, starts automatically if not running on activation
- **Consolidated status bar**, bridge status, model count, and current model in one item

---

## Background Agents

Conduit supports spawning background coding agents that work independently while you continue coding.

### Spawn Agent
`Conduit: Spawn Agent` - select a model and enter a task. The agent runs in the background with its own output channel.

### Fix Issue (Worktree Isolation)
`Conduit: Fix Issue` - enter a GitHub issue number. Conduit:
1. Creates a git worktree on a dedicated branch (`fix/issue-<N>`)
2. Spawns an agent in the isolated worktree
3. The agent reads the codebase, implements the fix, and commits

**Parallel safety:** Multiple Fix Issue commands can run simultaneously. Worktree creation is serialized via a file lock (`$REPO/.git/worktree-create.lock`) with 2.5s stagger to prevent `.git/config.lock` contention. ([Credit: @m13v](https://github.com/m13v/tmux-background-agents))

### Safe Worktree Cleanup
When removing worktrees, Conduit checks branch merge status:
- **Merged branches:** safe to remove
- **Unmerged + recently active (within 24h):** removal blocked (prevents losing review feedback)
- **Unmerged + abandoned (>24h idle):** allowed
- **Force flag:** overrides all safety checks

### Agent Tools
Background agents have access to these workspace tools:

| Tool | Permission | Description |
|------|-----------|-------------|
| `readFile` | safe | Read file contents (with optional line range) |
| `writeFile` | destructive | Create or overwrite files |
| `listFiles` | safe | List files matching a glob pattern |
| `searchCode` | safe | Regex search across workspace files |
| `runCommand` | destructive | Execute shell commands |
| `readDiagnostics` | safe | Read VS Code errors and warnings |
| `applyDiff` | destructive | Search-and-replace within a file |
| `createWorktree` | destructive | Create a git worktree for parallel work |
| `removeWorktree` | destructive | Remove a worktree (merge-status aware) |

### Batch Fix Issues
`Conduit: Batch Fix Issues` - fix multiple GitHub issues in parallel:
1. Enter a label filter (e.g. `bug`, `good-first-issue`) or leave empty for all open issues
2. Set max issues to process
3. Select a model
4. Conduit fetches matching issues via `gh`, shows a confirmation dialog, then spawns agents with worktree isolation
5. Max 3 concurrent agents (serialized worktree creation via lock)
6. Progress and summary shown in a dedicated "Conduit Batch Fix" output channel

### Session Panel
The Sessions tree view shows all background agents:
- **Running:** animated spinner icon (blue)
- **Completed:** checkmark icon (green)
- **Failed:** error icon (red)
- Click to view output, right-click to kill running agents

### Model Fallback Chain
When a model fails with a transient error (rate limit, timeout, capacity, auth failure), Conduit automatically retries with the next model in the fallback chain:
- Gemini 2.5 Pro → Gemini 2.5 Flash
- Gemini 3 Pro Preview → Gemini 3 Flash Preview
- Claude Opus 4.6 → Claude Sonnet 4.6 → Claude Haiku 4.5

Fallback is triggered by: 429/503 errors, rate limits, capacity issues, timeouts, and auth failures. Non-transient errors (syntax, missing args) are not retried. The `RouteResult` metadata tracks which model was actually used and why.

---

## Supported Models

Models are served by conduit-bridge. The extension displays whatever the bridge reports via `/v1/models`. Available models depend on which providers are logged in.

### Web Session Models (browser automation, no API key needed)

| Provider | Models | Context |
|---|---|---|
| **Grok** | Grok Expert, Grok Fast, Grok Heavy, Grok 4.20 Beta | 131K |
| **Claude** | Claude Sonnet 4.6, Claude Opus 4.6, Claude Haiku 4.5 | 200K |
| **Gemini** | Gemini 3 Fast, Gemini 3 Thinking, Gemini 3.1 Pro | 1M |
| **ChatGPT** | GPT-5.4 Pro, GPT-5.4 Thinking, GPT-5.3 Instant, GPT-5 Thinking Mini, o3 | 128K |

### CLI Models (requires CLI tool installed)

| Provider | Models | Context |
|---|---|---|
| **Claude CLI** | Claude Sonnet 4.6, Claude Opus 4.6, Claude Haiku 4.5 | 200K |
| **Gemini CLI** | Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 3.0 Pro Preview, Gemini 3.0 Flash Preview | 1M |
| **OpenCode** | Default model (auto-detected) | varies |
| **Pi** | Default model (configurable provider/model) | varies |

### API Models (requires OAuth / API key)

| Provider | Models | Context |
|---|---|---|
| **OpenAI Codex** | GPT-5.4, GPT-5.3 Codex, GPT-5.3 Codex Spark, GPT-5.2 Codex, GPT-5.1 Codex Mini | 200K |

### Local Models

| Provider | Models | Context |
|---|---|---|
| **BitNet** | BitNet 1.58 2B (CPU inference) | 4K |

---

## Chat Interface

The Conduit Chat panel lives in the bottom panel area by default. For the best experience, **drag it to the secondary sidebar** (right side) where it sits alongside GitHub Copilot and Claude Code.

### Toolbar

The toolbar at the bottom of the chat has:
- **+** - Attach context (current selection or file from disk)
- **Mode button** (Ask/Edit/Agent/Plan) - click to switch chat mode via QuickPick
- **Model button** (e.g. "Claude Sonnet 4.6") - click to switch model via QuickPick
- **Settings** - open Conduit extension settings
- **Send** - send your message (or press Enter)

---

## Chat Modes

Click the mode button in the toolbar to switch between modes:

| Mode | Purpose | System Behavior |
|---|---|---|
| **Ask** | Answer questions about code | Conversational, explains concepts, provides examples |
| **Edit** | Modify and refactor code | Focuses on producing code changes, minimal explanation |
| **Agent** | Plan and build features | Multi-step reasoning with collapsible step cards |
| **Plan** | Create implementation plans | Produces structured plans with steps, file lists, and considerations |

### Mode Compatibility

Models are classified into tiers that determine which modes they support:

| Tier | Modes | Examples |
|---|---|---|
| **Tier 1** (flagship) | Ask, Edit, Agent, Plan | Claude Opus 4.6, GPT-5.4 Pro, Gemini 3.1 Pro |
| **Tier 2** (mid-tier) | Ask, Edit, Plan | Claude Haiku 4.5, Grok Fast, GPT-5.3 Instant |
| **Tier 3** (fast) | Ask only | GPT-5 Thinking Mini, BitNet 2B |

If you select a mode that your current model doesn't support, Conduit shows a warning with a suggested alternative model.

---

## Agent Mode

In Agent mode, models produce structured output with step-by-step reasoning. Each step is rendered as a **collapsible card** in the chat:

- While the model streams a step, it shows an **animated spinner**
- When a step finishes (the next step begins), it shows a **green checkmark**
- When the full response is done, all steps show checkmarks
- Click any step header to expand/collapse its contents

This gives you a clear overview of the model's reasoning process without being overwhelmed by long responses.

---

## Model Selection

Click the model name in the toolbar (or use `/model`) to open the model picker.

The QuickPick shows all available models grouped by provider:
```
  Auto  best for task
  --- WEB-GROK ---
  * Grok Expert                  131K context - Ask, Edit, Agent, Plan
    Grok Fast                    131K context - Ask, Edit, Plan
  --- WEB-CLAUDE ---
  * Claude Sonnet 4.6            200K context - Ask, Edit, Agent, Plan
    Claude Opus 4.6              200K context - Ask, Edit, Agent, Plan
  ...
```

- Type to search/filter models
- The checkmark shows the currently selected model
- Star icons indicate model tier (full star = tier 1, half star = tier 2)
- Supported modes are shown next to each model
- **Auto** mode picks the best model per message based on complexity

### Auto Model Selection

When set to **Auto**, Conduit analyzes your message to determine complexity:
- **Simple** (short questions, "explain this", "fix typo") → fast models like Grok Fast, Gemini 3 Fast
- **Moderate** (code changes, debugging) → mid-tier models like Gemini 3 Thinking, Claude Sonnet
- **Complex** (architecture, multi-file, "build a system") → flagship models like Claude Opus, GPT-5.4 Pro

---

## Session Management

The **Sessions** panel appears below the Chat panel (or as a separate collapsible section). It works like GitHub Copilot's session history.

### Actions
- **New Session** (+) - start a fresh conversation (saves the current one)
- **Refresh** - reload the session list
- **Click a session** - load that conversation into the chat
- **Rename** (edit icon on hover) - give the session a custom name
- **Delete** (trash icon on hover) - remove a session permanently

### Session Rename
You can rename any session to keep track of what you were working on:
- Use `/rename My Feature Work` in the chat input
- Or click the edit icon next to a session in the Sessions panel
- Custom names persist and are shown in the session list

### Model Switch Handoff
When models change mid-conversation (either via Auto mode or manual switch), Conduit automatically injects a compressed summary of the previous context. This means the new model understands what was discussed before and can continue seamlessly.

### Working Context Persistence
Each session stores a "working summary", a compressed snapshot of what you were working on. When you switch between sessions, this summary is restored so no context is lost.

Sessions are stored in VS Code's global state and persist across restarts. Up to 50 sessions are kept.

### Move to Secondary Sidebar
To place Conduit next to GitHub Copilot and Claude Code in the secondary sidebar (right side), run the command **"Conduit: Move to Secondary Sidebar"** from the command palette (`Ctrl+Shift+P`).

---

## Slash Commands

Type `/` in the chat input to see autocomplete suggestions.

| Command | Description |
|---|---|
| `/help` | Show all available commands, context mentions, and keyboard shortcuts |
| `/fix` | Fix errors and warnings in the current file |
| `/explain` | Explain the selected code |
| `/tests` | Generate tests for the selected code |
| `/refactor [instruction]` | Refactor selected code (optional instruction) |
| `/plan [task]` | Create a structured implementation plan |
| `/commit` | Generate a commit message from staged git changes |
| `/clear` | Clear the current chat (without saving) |
| `/new` | Save current chat and start a new session |
| `/cost` | Show estimated token usage for this session |
| `/model [name]` | Switch model by name, or list all available |
| `/rename [name]` | Rename the current session |
| `/mode [ask\|edit\|agent\|plan]` | Switch chat mode |

---

## Context Mentions

Add context to your messages by typing `#` followed by a mention:

| Mention | What it attaches |
|---|---|
| `#file:src/main.ts` | Full content of the file |
| `#file:src/main.ts:10-20` | Lines 10-20 of the file |
| `#selection` | Current editor selection |
| `#problems` | All errors/warnings in the current file |
| `#workspace` | Lightweight workspace folder structure overview |
| `#codebase` | Deep search: file tree + contents of up to 30 source files (~80K chars) |
| `#terminal` | Terminal output (select text in terminal first) |

### Examples
```
Explain this function #file:src/utils/parser.ts:45-80
Fix the errors in this file #problems
How does authentication work? #codebase
Where are the API routes? #workspace
Refactor #selection based on patterns in #file:src/helpers.ts
```

### #workspace vs #codebase

- **#workspace** is lightweight, just the folder structure. Use it when you need a quick overview of where things are.
- **#codebase** is deep, includes the folder structure PLUS the actual contents of up to 30 prioritized source files. Use it when the model needs to understand how your code works. Files are prioritized: config files first, then entry points, then by directory depth.

---

## Code Intelligence

### Right-click Context Menu
Select code in the editor and right-click to access:
- **Conduit: Explain Selected Code** - get a detailed explanation
- **Conduit: Refactor Selected Code** - suggest improvements
- **Conduit: Generate Tests for Selection** - create unit tests
- **Conduit: Inline Edit** - edit code with a prompt

### Inline Completions (Ghost Text)
Conduit provides inline code suggestions as you type, similar to GitHub Copilot:
- Works for 20+ programming languages
- Respects language-specific conventions
- Configurable delay (`conduit.inlineTriggerDelay`)
- Toggle on/off with `Conduit: Toggle Inline Suggestions`

---

## Inline Chat

Press `Ctrl+I` (or `Cmd+I` on Mac) anywhere in the editor to open the inline chat:

1. Type a description of what you want to change (e.g. "add error handling", "convert to async")
2. Conduit generates the code change
3. A diff view opens showing the proposed changes
4. Click **Accept** to apply or **Reject** to discard

---

## Custom Instructions

Customize Conduit's behavior for your project by creating instruction files:

### Project-level (checked into repo)
- `.conduit/instructions.md` - Conduit-specific instructions
- `CLAUDE.md` - also recognized (Claude Code compatible)
- `.github/copilot-instructions.md` - also recognized (Copilot compatible)

### User-level (global, all projects)
- `~/.conduit/instructions.md`

### Example `.conduit/instructions.md`
```markdown
## Project Context
This is a React 19 + TypeScript project using Tailwind CSS.
The backend is a Node.js Express API with PostgreSQL.

## Coding Conventions
- Use functional components with hooks
- Prefer named exports
- Use descriptive variable names
- Always add JSDoc comments to exported functions
- Tests use vitest with React Testing Library

## Important
- Never use `any` type
- Always handle loading and error states
- API calls go through the `/lib/api` module
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+G` | Open/focus the Conduit Chat panel |
| `Ctrl+I` | Inline Chat - edit code at cursor |
| `Ctrl+Shift+I` | Inline Edit - edit selected code with prompt |
| `Ctrl+Shift+E` | Explain selected code |
| `Ctrl+Shift+M` | Generate commit message from staged changes |
| `Enter` | Send message in chat |
| `Shift+Enter` | Insert new line in chat |

---

## Configuration

Open settings with `Ctrl+,` and search for "conduit", or use the gear icon in the chat toolbar.

| Setting | Default | Description |
|---|---|---|
| `conduit.proxyUrl` | `http://127.0.0.1:31338` | Base URL of the conduit-bridge proxy |
| `conduit.apiKey` | `cli-bridge` | API key for the proxy |
| `conduit.defaultModel` | `cli-gemini/gemini-2.5-pro` | Default model (full ID from the model picker) |
| `conduit.inlineSuggestions` | `true` | Enable inline ghost-text completions |
| `conduit.inlineTriggerDelay` | `600` | Delay in ms before requesting inline suggestion |
| `conduit.contextLines` | `80` | Lines of surrounding code to include as context |
| `conduit.includeOpenFiles` | `true` | Include other open editor tabs as additional context |
| `conduit.maxOpenFilesContext` | `3` | Maximum number of open files to include |
| `conduit.terminalIntegration` | `true` | Enable terminal command suggestions |
| `conduit.autoStatusBar` | `true` | Show connection status in the status bar |

---

## Provider Setup

Each AI provider needs to be authenticated through the bridge. The extension provides login commands for each.

### Web Session Providers (Grok, Claude, Gemini, ChatGPT)

These use browser session cookies, no API keys needed.

1. Run the login command: `Ctrl+Shift+P` → `Conduit: Login - Grok` (or Claude, Gemini, ChatGPT)
2. A browser window opens to the provider's website
3. Log in with your account
4. The bridge captures the session and the models become available

### CLI Providers (Claude CLI, Gemini CLI, OpenCode, Pi)

These require the respective CLI tools to be installed:
- **Claude CLI**: Install [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and authenticate
- **Gemini CLI**: Install the [Gemini CLI](https://github.com/google-gemini/gemini-cli) and authenticate
- **OpenCode**: Install [OpenCode](https://github.com/opencode-ai/opencode) (auto-detected)
- **Pi**: Install [Pi](https://github.com/pi-ai/pi) with `--provider` and `--model` flags for different backends

The bridge automatically detects installed CLIs.

### OpenAI Codex (GPT-5.4, GPT-5.3 Codex, etc.)

Requires the Codex CLI with OAuth tokens:
1. Install the [Codex CLI](https://github.com/openai/codex)
2. Run `codex login` to authenticate
3. Run `openclaw models auth login --provider openai-codex` and select "Codex CLI (existing login)"
4. The codex models (including GPT-5.4) appear in the model picker

### Local Models (BitNet)

Local CPU inference, no authentication needed:
1. Install BitNet runtime
2. The bridge auto-detects and serves the model

### Checking Provider Status

Use `Ctrl+Shift+P` → `Conduit: Health Dashboard` to see which providers are connected and which models are available.

---

## Testing

Conduit has a comprehensive test suite with **301 tests** across **18 test files**.

### Running Tests

```bash
npm test                    # run all tests
npm run test:coverage       # run with coverage report
```

### Test Categories

| Test File | Tests | Coverage |
|-----------|-------|---------|
| `agent-parser.test.ts` | 25 | Agent output parsing, step card extraction |
| `agent-tools.test.ts` | 18 | Tool execution (readFile, writeFile, applyDiff, etc.) |
| `worktree-tools.test.ts` | 17 | Worktree lock serialization, merge-status safety |
| `cli-runner-failover.test.ts` | 7 | Model failover chain, fallback pattern matching |
| `aahp-context.test.ts` | 10 | AAHP v3 context detection, loading, block building |
| `agent-backends.test.ts` | 20 | Shared backend: prompt formatting, env, CLI config |
| `llm-tool-validation.test.ts` | 14 | Tool catalog schema, LLM tool-call validation |
| `model-registry.test.ts` | 39 | Model capabilities, tiers, auto-selection |
| `sessions-tree-provider.test.ts` | 19 | Session tree, background agent status |
| `proxy-client.test.ts` | 19 | HTTP streaming, error handling |
| `chat-view-provider.test.ts` | 17 | Chat webview, slash commands |
| `context-builder.test.ts` | 16 | Editor context collection |
| `mention-parser.test.ts` | 11 | #file, #selection, #codebase parsing |
| `custom-instructions.test.ts` | 8 | Instruction file loading |
| `utils.test.ts` | 17 | Shared utilities |
| `config.test.ts` | 4 | Settings reader |
| `inline-provider.test.ts` | 7 | Ghost-text completions |

### LLM Tool-Call Validation

The `llm-tool-validation.test.ts` suite includes a live LLM test that sends a sample prompt to a model and validates the response contains correct tool calls. Run against a specific model:

```bash
LLM_MODEL=cli-claude/claude-sonnet-4-6 npx vitest run src/__tests__/llm-tool-validation.test.ts
LLM_MODEL=cli-gemini/gemini-2.5-flash npx vitest run src/__tests__/llm-tool-validation.test.ts
LLM_MODEL=openai-codex/gpt-5.3-codex npx vitest run src/__tests__/llm-tool-validation.test.ts
```

The test validates: correct tool names, required args present, expected values, no hallucinated tools.

---

## Troubleshooting

### "No view is registered with id: conduit.sessionsView"
**Fully close and reopen VS Code.** VS Code only reads new view registrations on startup, not on extension reload.

### Models not showing up
The model list comes from the bridge (`/v1/models`). Check:
1. Is the bridge running? Run `Conduit: Check Proxy Status`
2. Is the provider logged in? Run the login command for that provider
3. Check the Health Dashboard for provider status

### Empty responses / "No response received"
- The provider may not be authenticated, run the login command
- The model may not support your request type
- Check the bridge logs: `Conduit: Show Bridge Logs`

### Chat panel not visible
1. Open the command palette (`Ctrl+Shift+P`)
2. Run `Conduit: Open Chat`
3. If the panel appears at the bottom, right-click the tab and select **"Move to Secondary Side Bar"**

### Inline completions not working
1. Check that `conduit.inlineSuggestions` is enabled in settings
2. Ensure the bridge is running and at least one model is available
3. Try increasing `conduit.inlineTriggerDelay` if suggestions are too slow

### Bridge not starting
The extension tries to auto-start the bridge on activation. If it fails:
1. Check if conduit-bridge is installed: `conduit-bridge --version`
2. Check if port 31338 is already in use
3. Start manually: `conduit-bridge start`
4. Check bridge logs: `Conduit: Show Bridge Logs`

---

## Development

### Setup
```bash
git clone https://github.com/elvatis/conduit-vscode
cd conduit-vscode
npm install --include=dev
```

### Build and Run
```bash
npm run dev     # watch mode with source maps
npm run build   # production build (minified)
npm run lint    # eslint
npm test        # run tests (vitest, 301 tests)
```

Press **F5** in VS Code to launch the Extension Development Host for debugging.

### CI

Two GitHub Actions workflows run automatically:

- **CI** (`.github/workflows/ci.yml`): Runs on every push/PR to `main`. Builds, runs all tests, uploads coverage artifacts.
- **LLM Validation** (`.github/workflows/llm-validation.yml`): Weekly smoke test (Mondays 06:00 UTC) that runs `llm-tool-validation.test.ts` against Claude Sonnet, Gemini Flash, and GPT-5.3 Codex. Can also be triggered manually via `workflow_dispatch`. Requires `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GOOGLE_APPLICATION_CREDENTIALS` secrets.

### Package for Distribution
```bash
npx @vscode/vsce package --no-dependencies
# produces conduit-vscode-0.7.0.vsix
```

### Project Structure
```
conduit-vscode/
  src/
    extension.ts              - activation, command registration
    commands.ts               - command palette registrations (spawn, fix issue, etc.)
    chat-view-provider.ts     - main chat webview (sidebar), slash commands, markdown
    chat-panel.ts             - chat panel webview host
    sessions-tree-provider.ts - native sessions tree view + background agent sessions
    models-tree-provider.ts   - model picker tree view
    model-registry.ts         - model capabilities, display names, tiers, auto-selection
    proxy-client.ts           - HTTP/streaming client for the bridge
    embedded-proxy.ts         - embedded proxy server (bridgeless mode)
    agent-backends.ts         - shared agent backend abstraction (CLI detection, env, prompt, spawn)
    cli-runner.ts             - CLI subprocess routing (Claude, Gemini, Codex, OpenCode, Pi)
    cost-tracker.ts           - token usage parsing and cost estimation per agent session
    agent-loop.ts             - multi-turn agent loop with tool execution
    agent-parser.ts           - agent output parsing (step cards, tool calls)
    agent-tools.ts            - workspace tools (read/write/search/worktree/diff)
    agent-types.ts            - shared type definitions for the agent system
    aahp-context.ts           - AAHP v3 context auto-detection and injection
    mention-parser.ts         - #file, #selection, #workspace, #codebase parsing
    context-builder.ts        - editor context collection
    bridge-manager.ts         - bridge lifecycle management
    bridge-panel.ts           - bridge manager webview
    browser-session.ts        - browser automation for web providers
    inline-provider.ts        - ghost-text inline completions
    inline-chat.ts            - Ctrl+I inline chat with diff
    custom-instructions.ts    - .conduit/instructions.md loader
    commit-message.ts         - git commit message generation
    config.ts                 - settings reader
    health-panel.ts           - health dashboard webview
    status-bar.ts             - consolidated status bar item
    utils.ts                  - shared utilities
  src/__tests__/              - 18 test files, 301 tests (vitest)
  dist/
    extension.js              - bundled output (esbuild)
  media/
    icon.png                  - extension icon
    icon.svg                  - extension icon (vector)
    sidebar-icon.svg          - panel icon
```

### Related Projects

| Project | Description | Overlap |
|---------|-------------|---------|
| [aahp-orchestrator](https://github.com/homeofe/aahp-orchestrator) | VS Code extension for AAHP v3 context injection | Context building for coding agents |
| [aahp-runner](https://github.com/homeofe/aahp-runner) | Autonomous CLI agent runner | CLI agent spawning, backend routing |
| [aahp-cron](https://github.com/homeofe/aahp-cron) | Pipeline orchestrator for multi-repo agent runs | Batch agent execution pattern |

---

## Roadmap

Open issues tracking planned features:

| # | Feature | Status |
|---|---------|--------|
| [#6](https://github.com/elvatis/conduit-vscode/issues/6) | Model failover chain for agent sessions | ✅ Done |
| [#7](https://github.com/elvatis/conduit-vscode/issues/7) | AAHP context integration for agent sessions | ✅ Done |
| [#8](https://github.com/elvatis/conduit-vscode/issues/8) | Multi-issue batch mode (aahp-cron pattern) | ✅ Done |
| [#9](https://github.com/elvatis/conduit-vscode/issues/9) | Agent output streaming to session panel | ✅ Done |
| [#10](https://github.com/elvatis/conduit-vscode/issues/10) | Shared agent backend abstraction with aahp-runner | ✅ Done |
| [#11](https://github.com/elvatis/conduit-vscode/issues/11) | LLM tool-call validation CI (multi-model smoke test) | ✅ Done |
| [#12](https://github.com/elvatis/conduit-vscode/issues/12) | Agent session persistence and resume | ✅ Done |
| [#13](https://github.com/elvatis/conduit-vscode/issues/13) | Cost tracking per agent session | ✅ Done |

---

## Changelog

### v0.7.0 (2026-03-18)
- Agent backends: Claude CLI, Gemini CLI, OpenAI Codex, OpenCode, Pi
- Background agent sessions with spawn/monitor/kill
- Git worktree isolation for parallel agent work
- Worktree lock serialization (prevents .git/config.lock contention)
- Merge-status aware worktree cleanup
- Fix Issue command (auto-worktree + agent spawn)
- Model fallback chain definitions
- 301 tests across 18 test files

### v0.5.0
- Reliable agent loop with tool execution
- Multi-model auto-selection
- Local model support (BitNet)
- Smart fallback on model errors

### v0.4.0
- Per-provider sessions with model-aware completions
- Streaming metadata display (timestamps, duration, tokens)
- Inline chat with diff preview

### v0.3.0
- Initial release: chat interface, model picker, inline completions
- Session management with persistence
- Custom instructions support
