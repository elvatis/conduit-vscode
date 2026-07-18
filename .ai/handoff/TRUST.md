# TRUST.md - conduit-vscode

> Tracks verification status of critical system properties.
> In multi-agent pipelines, hallucinations and drift are real risks.
> Every claim here has a confidence level tied to how it was verified.

---

## Confidence Levels

| Level | Meaning |
|-------|---------|
| **verified** | An agent executed code, ran tests, or observed output to confirm this |
| **assumed** | Derived from docs, config files, or chat, not directly tested |
| **untested** | Status unknown; needs verification |

---

## Provenance (Draft v0.1, proposed)

The Grounded Reflection Layer adds an orthogonal *provenance* field recording HOW a
claim was checked, separate from the Status column. Provenance tokens, weakest to
strongest: `model_claim`, `self_reviewed`, `cross_model_reviewed`, `source_verified`,
`tool_verified`, `test_verified`, `runtime_observed`, `human_confirmed`.
`cross_model_reviewed` maps to status `assumed`, never `verified`; only
`source_verified` / `tool_verified` / `test_verified` / `runtime_observed` /
`human_confirmed` can support `verified` (grounded). It is recorded in the Provenance
column of the tables below, using `-` when it is unknown. TTL and expiry stay governed
by the Trust Decay rule (README section 2.5). See GROUNDING.md for the anchor matrix
and README section 2.10 for the doctrine.

---

## Verified

| Property | Status | Provenance | Last Verified | Agent | TTL | Expires | Notes |
|----------|--------|------------|---------------|-------|-----|---------|-------|
| TypeScript compiles with zero errors | verified | tool_verified | - | - | - | - | tsc type-check |
| esbuild bundle succeeds | verified | tool_verified | - | - | - | - | `dist/extension.js` ~123kb |
| All VS Code API calls use correct types | verified | tool_verified | - | - | - | - | `@types/vscode ^1.90.0` |
| Extension activates and runs in VS Code | verified | runtime_observed | - | - | - | - | tested locally |
| Model selection works correctly | verified | runtime_observed | - | - | - | - | tier icon stripping verified |
| Agent step cards render with spinner/checkmark transitions | verified | runtime_observed | - | - | - | - | |
| Markdown rendering handles headings, lists, tables, blockquotes, code blocks | verified | runtime_observed | - | - | - | - | |
| #workspace and #codebase mentions resolve correctly | verified | runtime_observed | - | - | - | - | |
| .vsix packaging works | verified | tool_verified | - | - | - | - | `npx @vscode/vsce package --no-dependencies` |
| GitHub releases created with .vsix attached | verified | human_confirmed | - | - | - | - | v0.1.0, v0.2.0, v0.3.0 |
| 30 tests passing (vitest) | verified | test_verified | - | - | - | - | |

---

## Assumed / Not Yet Tested

| Property | Status | Provenance | Last Verified | Agent | TTL | Expires | Notes |
|----------|--------|------------|---------------|-------|-----|---------|-------|
| Multi-turn agent loop | untested | - | - | - | - | - | T-016 |
| VS Code Marketplace publishing | untested | - | - | - | - | - | T-006 |
| All provider login flows end-to-end | untested | - | - | - | - | - | depends on bridge + account access |
| Performance with very large workspaces (>1000 files) for #codebase mention | untested | - | - | - | - | - | |

---

## Security Notes

- Webview has `enableScripts: true` - all postMessage data must be validated
- `BridgeManager._findBridgeCli()` only looks in known safe paths - no arbitrary execution
- Proxy URL is user-configurable - validate it's a localhost URL before use in production
- Extension has no network access outside `conduit.proxyUrl` (localhost only by default)
- #codebase reads up to 30 files, each capped at 3K chars - prevents OOM on large repos

---

*Trust degrades over time. Re-verify periodically, especially after major refactors.*
