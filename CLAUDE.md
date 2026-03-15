# CLAUDE.md - conduit-vscode

## Project Overview

Conduit is a VS Code extension that connects VS Code to any OpenAI-compatible AI provider (Grok, Claude, Gemini, ChatGPT, etc.) via a local proxy bridge (`conduit-bridge`).

- Publisher: `elvatis`
- Extension ID: `elvatis.conduit-vscode`
- Current version: `0.3.0`

## Build & Test

```bash
npm run build        # esbuild single-file bundle to dist/extension.js
npm run dev          # esbuild watch mode with sourcemaps
npm run lint         # eslint
npm test             # vitest run
```

## Release Checklist

1. Bump version in `package.json`
2. `npm run build` - must succeed
3. `npx @vscode/vsce package --no-dependencies` - generates `.vsix`
4. Test locally: `code --install-extension conduit-vscode-X.Y.Z.vsix`
5. Git commit + tag + `gh release create` (attach `.vsix`)

**Always bump the version in `package.json` before committing changes.**

## Architecture

- **Runtime**: TypeScript, CommonJS output, ES2022 target
- **Bundler**: esbuild (single-file `dist/extension.js`, `vscode` is external)
- **VS Code engine**: `^1.90.0`
- **Bridge**: conduit-bridge (separate repo) - Playwright-based browser automation proxy

### Key Files

| File | Purpose |
|------|---------|
| `src/extension.ts` | `activate()` / `deactivate()` entry point |
| `src/chat-view-provider.ts` | Main sidebar chat UI (webview), model/mode selection, slash commands, agent steps, markdown rendering |
| `src/model-registry.ts` | Model metadata, capabilities, display names, tier classification, auto-selection |
| `src/proxy-client.ts` | HTTP client for conduit-bridge API (raw Node.js http/https, no fetch/axios) |
| `src/mention-parser.ts` | Parses `#file:path`, `#selection`, `#problems`, `#workspace`, `#codebase`, `#terminal` mentions |
| `src/context-builder.ts` | Editor context (prefix/suffix, open files, diagnostics, system prompt) |
| `src/inline-provider.ts` | InlineCompletionItemProvider (ghost text suggestions) |
| `src/inline-chat.ts` | Inline chat for in-editor edits |
| `src/bridge-manager.ts` | conduit-bridge process lifecycle + `/v1/status` polling |
| `src/bridge-panel.ts` | Bridge webview (provider login/logout UI) |
| `src/config.ts` | `getConfig()` / settings access |
| `src/commands.ts` | VS Code command handlers |
| `src/status-bar.ts` | Status bar (proxy health indicator) |

### Chat Modes

| Mode | System Prompt Behavior |
|------|----------------------|
| **Ask** | Answer questions, explain code |
| **Edit** | Return only modified code in fenced blocks |
| **Agent** | Structured step-by-step output with `### Step N: Title` format, rendered as collapsible cards |
| **Plan** | Numbered implementation plan, no code yet |

### Context Mentions

| Mention | What it provides |
|---------|-----------------|
| `#file:path` | Full file contents (or line range with `:L-L`) |
| `#selection` | Currently highlighted code in the editor |
| `#problems` | Errors and warnings from the current file |
| `#workspace` | Lightweight folder structure overview |
| `#codebase` | Deep search: file tree + contents of up to 30 prioritized source files (~80K chars) |
| `#terminal` | Terminal output reference (user must select text first) |

### Markdown Rendering (renderMd)

The webview uses a custom inline markdown renderer (no external libraries). Supports:
- Headings (h1-h6), bold, italic, bold+italic, inline code, links
- Fenced code blocks with language hint
- Ordered/unordered lists
- Tables, blockquotes, horizontal rules
- Agent step detection: `### Step N: Title` lines become collapsible `<details>` cards with spinner/checkmark status

### Agent Step Cards

In agent mode, the `renderMd` function detects `### Step N:` headings and wraps them in collapsible cards:
- While streaming: last step shows animated spinner, previous steps show green checkmark
- When done: all steps show checkmarks
- Steps are click-to-expand/collapse via `<details>` elements
- CSS classes: `.agent-step`, `.step-done`, `.step-spinner`, `.step-check`

### Conventions

- `package.json` contributes section is the source of truth for commands/menus/keybindings
- Webview HTML must be self-contained (inline CSS + JS) - no external resources
- All `postMessage` between extension and webview must have a typed `type` field
- `getConfig()` is called fresh on every request - no caching
- `BridgeManager` polls every 15s - do not reduce (spammy logs)
- Inline provider: debounce 600ms, max_tokens 256, temperature 0.1
- Model quick pick labels contain VS Code icons (`$(star-full)`, `$(star-half)`, `$(check)`) - always strip all icons before matching against `m.name`

## Code Style

- English only for all code, comments, docs, and commit messages
- No em dashes - use regular hyphens (-)
- Follow existing patterns in the codebase
- Keep webview JS inline within TypeScript template strings

## Planned: Multi-Turn Agent Loop

Next major feature - autonomous agent that can:
- Execute multi-step plans with tool use (file read/write, terminal commands)
- Show each step as a visible sub-process bubble in the chat
- Self-correct by reading errors and retrying
- Requires new architecture: agent loop controller, tool definitions, confirmation UI
