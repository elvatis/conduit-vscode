# TRUST.md — conduit-vscode

## Verified ✅
- TypeScript compiles with zero errors
- esbuild bundle succeeds (`dist/extension.js` 37.8kb)
- All VS Code API calls use correct types (`@types/vscode ^1.90.0`)
- `InlineCompletionItemProvider` registration syntax correct
- WebviewPanel retained when hidden (retainContextWhenHidden: true)
- BridgeManager process spawn logic correct for Node.js child_process

## Assumed / Not Yet Tested ⚠️
- Extension actually activates in VS Code (not tested in Extension Development Host)
- Chat panel streaming renders correctly in webview
- Inline suggestions appear as ghost text (depends on VS Code version + model latency)
- Bridge auto-detect paths cover Windows + macOS + Linux correctly
- BridgePanel provider login buttons trigger correct behavior end-to-end
- `.vsix` packaging works (vsce not yet run)

## Security Notes
- Webview has `enableScripts: true` — all postMessage data must be validated
- `BridgeManager._findBridgeCli()` only looks in known safe paths — no arbitrary execution
- Proxy URL is user-configurable — validate it's a localhost URL before use in production
- Extension has no network access outside `conduit.proxyUrl` (localhost only by default)
