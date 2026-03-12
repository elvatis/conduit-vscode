# CONVENTIONS.md — conduit-vscode

## Language & Runtime
- TypeScript strict mode, CommonJS output (VS Code extension requirement)
- Target: ES2022
- VS Code engine: `^1.90.0` (minimum for `InlineCompletionItemProvider` + `TabInputText`)

## Package
- Name: `conduit-vscode`
- Publisher: `elvatis`
- Extension ID: `elvatis.conduit-vscode`
- Bundler: esbuild (single-file bundle `dist/extension.js`)
- `vscode` is external (not bundled) — always `--external:vscode`

## File Layout
```
.ai/handoff/            ← AAHP protocol files
src/
  extension.ts          ← activate() / deactivate() entry point
  config.ts             ← getConfig() / onConfigChange()
  proxy-client.ts       ← HTTP client for conduit-bridge API (complete/stream/listModels/checkHealth)
  context-builder.ts    ← Editor context (prefix/suffix, open files, diagnostics, system prompt)
  inline-provider.ts    ← InlineCompletionItemProvider (ghost text)
  chat-panel.ts         ← WebviewPanel chat UI (HTML + JS)
  commands.ts           ← All VS Code commands (explain, refactor, tests, fix, terminal, edit)
  status-bar.ts         ← ConduitStatusBar (simple proxy health)
  bridge-manager.ts     ← BridgeManager (conduit-bridge process lifecycle + /v1/status polling)
  bridge-panel.ts       ← BridgePanel webview (provider login/logout UI)
dist/extension.js       ← Bundled output (gitignored)
media/sidebar-icon.svg  ← Activity bar icon
package.json            ← Extension manifest + contributes
tsconfig.json
```

## VS Code Extension Rules
- `package.json` contributes section is the source of truth for commands/menus/keybindings
- Webview HTML must be self-contained (inline CSS + JS) — no external resources
- All `postMessage` between extension and webview must have typed `type` field
- Use `vscode.window.withProgress` for any operation > 1s
- Use `vscode.ViewColumn.Beside` for new editor panels (don't steal focus)

## Code Style
- `getConfig()` is called fresh on every request — no caching needed
- `proxy-client.ts` uses raw Node.js `http`/`https` — no fetch, no axios
- `BridgeManager` polls every 15s — do not reduce this (spammy logs)
- Commands that need selection: always check `editor.selection.isEmpty` first
- Inline provider: debounce 600ms, max_tokens 256, temperature 0.1

## Configuration Settings (conduit.*)
| Key | Default | Description |
|---|---|---|
| `proxyUrl` | `http://127.0.0.1:31338` | conduit-bridge URL |
| `apiKey` | `cli-bridge` | API key |
| `defaultModel` | `cli-gemini/gemini-2.5-pro` | Default model |
| `inlineSuggestions` | `true` | Ghost text completions |
| `inlineTriggerDelay` | `600` | Debounce ms |
| `contextLines` | `80` | Lines of context |
| `includeOpenFiles` | `true` | Include open tabs as context |
| `maxOpenFilesContext` | `3` | Max open files |
| `terminalIntegration` | `true` | Terminal command suggestions |
| `autoStatusBar` | `true` | Status bar visibility |

## Release Checklist
1. `npm run build` — must succeed
2. Bump version in `package.json` + `STATUS.md`
3. `vsce package` → generates `.vsix`
4. Test `.vsix` locally: `code --install-extension conduit-vscode-X.Y.Z.vsix`
5. Git commit + tag + `gh release create` (attach `.vsix`)
6. Optional: `vsce publish` (VS Code Marketplace — when ready to go public)

> ⚠️ `gh release create` is MANDATORY — git tags alone don't create GitHub Releases.
