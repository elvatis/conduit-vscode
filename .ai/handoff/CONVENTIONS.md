# CONVENTIONS.md - conduit-vscode

## Language & Runtime
- TypeScript strict mode, CommonJS output (VS Code extension requirement)
- Target: ES2022
- VS Code engine: `^1.90.0`

## Package
- Name: `conduit-vscode`
- Publisher: `elvatis`
- Extension ID: `elvatis.conduit-vscode`
- Bundler: esbuild (single-file bundle `dist/extension.js`)
- `vscode` is external (not bundled) - always `--external:vscode`

## File Layout
```
.ai/handoff/              AAHP protocol files
src/
  extension.ts            activate() / deactivate() entry point
  config.ts               getConfig() / onConfigChange()
  proxy-client.ts         HTTP client for conduit-bridge API (complete/stream/listModels/checkHealth)
  chat-view-provider.ts   Main sidebar chat UI (webview), model/mode selection, slash commands, agent steps, markdown rendering
  model-registry.ts       Model metadata, capabilities, display names, tier classification, auto-selection
  mention-parser.ts       Parses #file:path, #selection, #problems, #workspace, #codebase, #terminal mentions
  context-builder.ts      Editor context (prefix/suffix, open files, diagnostics, system prompt)
  inline-provider.ts      InlineCompletionItemProvider (ghost text)
  inline-chat.ts          Inline chat for in-editor edits
  commands.ts             VS Code command handlers
  status-bar.ts           ConduitStatusBar (proxy health + model name)
  bridge-manager.ts       BridgeManager (conduit-bridge process lifecycle + /v1/status polling)
  bridge-panel.ts         BridgePanel webview (provider login/logout UI)
  commit-message.ts       Commit message generation from git diff
  custom-instructions.ts  Load .conduit/instructions.md, CLAUDE.md, etc.
dist/extension.js         Bundled output (gitignored)
media/                    Icons (sidebar-icon.svg, icon.svg, icon.png)
package.json              Extension manifest + contributes
tsconfig.json
```

## VS Code Extension Rules
- `package.json` contributes section is the source of truth for commands/menus/keybindings
- Webview HTML must be self-contained (inline CSS + JS) - no external resources
- All `postMessage` between extension and webview must have typed `type` field
- Model quick pick labels contain VS Code icons (`$(star-full)`, etc.) - always strip ALL icons before matching against `m.name`

## Code Style
- `getConfig()` is called fresh on every request - no caching needed
- `proxy-client.ts` uses raw Node.js `http`/`https` - no fetch, no axios
- `BridgeManager` polls every 15s - do not reduce this (spammy logs)
- Commands that need selection: always check `editor.selection.isEmpty` first
- Inline provider: debounce 600ms, max_tokens 256, temperature 0.1
- Markdown renderer is inline in chat-view-provider.ts - no external markdown libraries

## Chat Modes
| Mode | Agent step format | System prompt behavior |
|---|---|---|
| Ask | N/A | Answer questions, explain code |
| Edit | N/A | Return ONLY modified code in fenced blocks |
| Agent | `### Step N: Title` | Structured steps, rendered as collapsible cards |
| Plan | N/A | Numbered implementation plan, no code |

## Context Mentions
| Mention | Function | Content |
|---|---|---|
| `#file:path` | `resolveFileMention()` | Full file or line range |
| `#selection` | inline | Currently highlighted code |
| `#problems` | inline | Errors/warnings from current file |
| `#workspace` | `buildCodebaseSummary()` | Folder structure overview |
| `#codebase` | `buildWorkspaceContext()` | File tree + up to 30 source files (~80K chars) |
| `#terminal` | inline | Terminal output reference |

## Release Checklist
1. `npm run build` - must succeed
2. Bump version in `package.json`
3. `npx @vscode/vsce package --no-dependencies` - generates `.vsix`
4. Test `.vsix` locally: `code --install-extension conduit-vscode-X.Y.Z.vsix`
5. Git commit + tag + `gh release create` (attach `.vsix`)
6. Update `.ai/handoff/` files (STATUS, DASHBOARD, LOG, MANIFEST, NEXT_ACTIONS)
