# TRUST.md - conduit-vscode

## Verified
- TypeScript compiles with zero errors
- esbuild bundle succeeds (`dist/extension.js` ~123kb)
- All VS Code API calls use correct types (`@types/vscode ^1.90.0`)
- Extension activates and runs in VS Code (tested locally)
- Model selection works correctly (tier icon stripping verified)
- Agent step cards render with spinner/checkmark transitions
- Markdown rendering handles headings, lists, tables, blockquotes, code blocks
- #workspace and #codebase mentions resolve correctly
- .vsix packaging works (`npx @vscode/vsce package --no-dependencies`)
- GitHub releases created with .vsix attached (v0.1.0, v0.2.0, v0.3.0)
- 30 tests passing (vitest)

## Assumed / Not Yet Tested
- Multi-turn agent loop (not yet implemented - T-016)
- VS Code Marketplace publishing (T-006)
- All provider login flows end-to-end (depends on bridge + account access)
- Performance with very large workspaces (>1000 files) for #codebase mention

## Security Notes
- Webview has `enableScripts: true` - all postMessage data must be validated
- `BridgeManager._findBridgeCli()` only looks in known safe paths - no arbitrary execution
- Proxy URL is user-configurable - validate it's a localhost URL before use in production
- Extension has no network access outside `conduit.proxyUrl` (localhost only by default)
- #codebase reads up to 30 files, each capped at 3K chars - prevents OOM on large repos
