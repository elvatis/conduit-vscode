# CLAUDE.md - conduit-vscode

## Project Overview

Conduit is a VS Code extension that connects VS Code to any OpenAI-compatible AI provider (Grok, Claude, Gemini, ChatGPT, etc.) via a local proxy bridge (`conduit-bridge`).

- Publisher: `elvatis`
- Extension ID: `elvatis.conduit-vscode`

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
3. `vsce package` - generates `.vsix`
4. Test locally: `code --install-extension conduit-vscode-X.Y.Z.vsix`
5. Git commit + tag + `gh release create` (attach `.vsix`)

**Always bump the version in `package.json` before committing changes.**

## Architecture

- **Runtime**: TypeScript, CommonJS output, ES2022 target
- **Bundler**: esbuild (single-file `dist/extension.js`, `vscode` is external)
- **VS Code engine**: `^1.90.0`

### Key Files

| File | Purpose |
|------|---------|
| `src/extension.ts` | `activate()` / `deactivate()` entry point |
| `src/chat-view-provider.ts` | Main sidebar chat UI (webview), model/mode selection, slash commands, message handling |
| `src/model-registry.ts` | Model metadata, capabilities, display names, tier classification, auto-selection |
| `src/proxy-client.ts` | HTTP client for conduit-bridge API (raw Node.js http/https, no fetch/axios) |
| `src/mention-parser.ts` | Parses `#file:path`, `#selection`, `#problems`, `#codebase`, `#terminal` mentions |
| `src/context-builder.ts` | Editor context (prefix/suffix, open files, diagnostics, system prompt) |
| `src/inline-provider.ts` | InlineCompletionItemProvider (ghost text suggestions) |
| `src/inline-chat.ts` | Inline chat for in-editor edits |
| `src/bridge-manager.ts` | conduit-bridge process lifecycle + `/v1/status` polling |
| `src/bridge-panel.ts` | Bridge webview (provider login/logout UI) |
| `src/config.ts` | `getConfig()` / settings access |
| `src/commands.ts` | VS Code command handlers |
| `src/status-bar.ts` | Status bar (proxy health indicator) |

### Conventions

- `package.json` contributes section is the source of truth for commands/menus/keybindings
- Webview HTML must be self-contained (inline CSS + JS) - no external resources
- All `postMessage` between extension and webview must have a typed `type` field
- `getConfig()` is called fresh on every request - no caching
- `BridgeManager` polls every 15s - do not reduce (spammy logs)
- Inline provider: debounce 600ms, max_tokens 256, temperature 0.1

## Code Style

- English only for all code, comments, docs, and commit messages
- No em dashes - use regular hyphens (-)
- Follow existing patterns in the codebase
- Keep webview JS inline within TypeScript template strings
