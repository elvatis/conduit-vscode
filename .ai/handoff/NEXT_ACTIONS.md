# NEXT_ACTIONS.md - conduit-vscode

Current version: **v0.10.1**

_Last updated: 2026-09-02_

## Status Summary

| Status  | Count |
|---------|-------|
| Done    | 19    |
| Ready   | 0     |
| Blocked | 0     |
| Dropped | 1     |

---

## Ready - Work These Next

_No open tasks. The backlog is clear._

---

## Blocked

_No blocked tasks._

---

## Dropped

### T-006: [low] - VS Code Marketplace listing (issue #53 closed, issue #85 locked)

- Dropped 2026-07-17 and confirmed 2026-09-02: there is no plan to publish conduit to the VS Code Marketplace. Distribution stays via the .vsix from GitHub. Issue #85 is locked.

---

## Recently Completed

| Task  | Title | Date |
|---|---|---|
| T-001 | Scaffold extension + all core features | 2026-03-12 |
| T-007 | Add BridgeManager + BridgePanel | 2026-03-12 |
| T-002 | Auto-start bridge on extension activate | 2026-03-14 |
| T-003 | Inline suggestion system prompt tuning (per-language) | 2026-03-14 |
| T-004 | Add test suite (vitest, 30 tests) | 2026-03-14 |
| T-005 | Package as .vsix + icon | 2026-03-14 |
| T-008 | Chat history persistence | 2026-03-14 |
| T-009 | Model selector in status bar + chat toolbar | 2026-03-14 |
| T-010 | Health dashboard webview panel | 2026-03-14 |
| T-011 | Native QuickPick model/mode selectors | 2026-03-14 |
| T-012 | Native Sessions tree view | 2026-03-14 |
| T-013 | 30+ model registry with display names | 2026-03-14 |
| T-014 | Streaming error handling | 2026-03-14 |
| T-015 | Comprehensive README documentation | 2026-03-14 |
| T-017 | Fix model selection (tier icon label matching bug) | 2026-03-15 |
| T-018 | Full markdown rendering (headings, lists, blockquotes, etc.) | 2026-03-15 |
| T-019 | #workspace and #codebase context mentions | 2026-03-15 |
| T-020 | Agent step cards with collapsible UI | 2026-03-15 |
| T-016 | Multi-turn agent loop (issue #52) - shipped incrementally in v0.5.0-v0.7.0, docs reconciled 2026-07-17 | 2026-07-17 |

## Open after the 2026-09-03 governance parity pass

Both repositories were audited against each other and 26 of 32 asymmetries
were closed across six pull requests. Every gate that was switched on was
mutation-proved (18 proofs, each turning its gate red on the exact staleness
it exists to catch, with the unmodified tree green). What is left needs a
decision or source work, so it is recorded here rather than assumed.

1. **`aahp-verify` is not a required status check.** Only `test` is required
   on `main`, so the gate that runs every governance check added on
   2026-09-03 cannot block a merge. Needs a repository settings change.
   Verify afterwards with a throwaway pull request that violates one gate.

2. ~~Nothing type-checks this repository.~~ **DONE 2026-09-03.**
   `npm run typecheck` exists, exits 0, and runs in CI before the
   build. Correction to what this entry said: the "33 genuine
   noImplicitAny errors" were not genuine. tsconfig declared no
   `"types"`, so node globals resolved to nothing and the implicit-any
   errors were downstream of that. Adding `"types": ["node"]` took 159
   errors to 2. Both remaining ones were real and are fixed: a dynamic
   import missing its `.js` extension under Node16 resolution, and
   `SessionsTreeProvider.refresh` typed too narrowly to accept the
   `null` its own event emits.

3. **Three releases are permanently empty**: v0.1.0, v0.2.0 and v0.6.0 carry
   zero assets. `release.yml` prevents new ones from being published without
   a `.vsix`, but those three trees predate the changelog and the AAHP CLI,
   so they fail earlier gates and cannot be repaired by the dispatch path.
   Repair by hand or leave them; either way `TRUST.md` now records the fact.

4. **`.claude/settings.local.json` remains in history and in 75 pull-request
   refs.** It was untracked on 2026-09-03 and is excluded going forward. It
   holds no credentials, but it does carry the operator username and an
   internal host name. `refs/pull/N/head` cannot be deleted or rewritten by
   the repository owner, so a history rewrite alone does NOT remove it: that
   needs a GitHub Support request, or deleting and recreating the repository.
   Emre's decision, deliberately not taken by an agent.

5. **`npm run lint` references an eslint config this repository does not
   have**, is run by no workflow, and its Dependabot ignore holds TypeScript
   a major version back. Either add the config or delete the script, the
   dependencies and the ignore rule.

