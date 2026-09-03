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
| TypeScript compiles with zero errors | verified | tool_verified | 2026-09-03 | claude-opus-5 | 90d | 2026-12-03 | `npm run typecheck` (tsc --noEmit) exits 0 and runs in CI. Earlier today this row was downgraded on a count of 159 errors said to include 33 genuine noImplicitAny defects; that reading was wrong. tsconfig declared no "types", so node globals were missing and the implicit-any errors were downstream of that. With "types": ["node"] only 2 real errors remained, both fixed here. |
| esbuild bundle succeeds | verified | tool_verified | 2026-09-03 | claude-opus-5 | 90d | 2026-12-03 | `dist/extension.js` ~123kb |
| All VS Code API calls use correct types | verified | tool_verified | 2026-09-03 | claude-opus-5 | 90d | 2026-12-03 | `@types/vscode ^1.90.0` |
| Extension activates and runs in VS Code | verified | runtime_observed | 2026-09-03 | claude-opus-5 | 90d | 2026-12-03 | tested locally |
| Model selection works correctly | verified | runtime_observed | 2026-09-03 | claude-opus-5 | 90d | 2026-12-03 | tier icon stripping verified |
| Agent step cards render with spinner/checkmark transitions | verified | runtime_observed | 2026-09-03 | claude-opus-5 | 90d | 2026-12-03 |  |
| Markdown rendering handles headings, lists, tables, blockquotes, code blocks | verified | runtime_observed | 2026-09-03 | claude-opus-5 | 90d | 2026-12-03 |  |
| #workspace and #codebase mentions resolve correctly | verified | runtime_observed | 2026-09-03 | claude-opus-5 | 90d | 2026-12-03 |  |
| .vsix packaging works | verified | tool_verified | 2026-09-03 | claude-opus-5 | 90d | 2026-12-03 | `npx @vscode/vsce package --no-dependencies` |
| GitHub releases created with .vsix attached | verified | tool_verified | 2026-09-03 | claude-opus-5 | 90d | 2026-12-03 | v0.3.0, v0.10.0, v0.10.1 carry a .vsix. v0.1.0, v0.2.0 and v0.6.0 have ZERO assets, measured via the releases API on 2026-09-03; the earlier claim that v0.1.0 and v0.2.0 had one was wrong. Enforced from v0.10.1 by .github/workflows/release.yml. |
| 30 tests passing (vitest) | verified | test_verified | 2026-09-03 | claude-opus-5 | 90d | 2026-12-03 |  |

---

## Assumed / Not Yet Tested

| Property | Status | Provenance | Last Verified | Agent | TTL | Expires | Notes |
|----------|--------|------------|---------------|-------|-----|---------|-------|
| Multi-turn agent loop | untested | - | - | - | - | - | T-016 |
| VS Code Marketplace publishing | untested | - | - | - | - | - | T-006 |
| All provider login flows end-to-end | untested | - | - | - | - | - | depends on bridge + account access |
| Performance with very large workspaces (>1000 files) for #codebase mention | untested | - | - | - | - | - |  |

---

## Security Notes

- Webview has `enableScripts: true` - all postMessage data must be validated
- `BridgeManager._findBridgeCli()` only looks in known safe paths - no arbitrary execution
- Proxy URL is user-configurable - validate it's a localhost URL before use in production
- Extension has no network access outside `conduit.proxyUrl` (localhost only by default)
- #codebase reads up to 30 files, each capped at 3K chars - prevents OOM on large repos

---

*Trust degrades over time. Re-verify periodically, especially after major refactors.*
