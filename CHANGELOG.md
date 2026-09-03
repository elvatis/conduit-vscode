# Changelog

All notable changes to conduit-vscode are documented here.

## [Unreleased]

### Added

- `npm run typecheck` (`tsc --noEmit`), run in CI before the build. Nothing had
  ever type-checked this extension: esbuild bundles without checking types, so
  159 errors accumulated unseen while TRUST.md recorded the opposite as verified.

### Fixed

- `tsconfig.json` declared no `"types"`, so node globals resolved to nothing.
  That alone accounted for 157 of the 159 errors, including every implicit-any
  one, which had been misread as independent source defects.
- A dynamic `import()` in the LLM validation test omitted the `.js` extension
  that Node16 module resolution requires.
- `SessionsTreeProvider.refresh` took `string | undefined` while the event it
  listens to emits `string | null`. `null` means "no active session", and the
  narrow type meant the tree could never clear its highlight; `undefined` still
  means "leave it alone", so background refreshes are unaffected.

## [0.10.1] - 2026-09-03

### Fixed

- v0.10.0 was tagged and released without its `.vsix`. GitHub releases are the only
  way this extension is distributed (Marketplace publishing was dropped 2026-07-17),
  so the release was effectively empty. Documentation disagreed with the tag in four
  places: README said 0.9.0, both install snippets said 0.7.6, STATUS.md said 0.9.0
  and DASHBOARD.md said 0.8.0.
- README claimed conduit-bridge v0.7.0+; 0.10.0 deleted the local model tables and
  needs the limits only 0.9.0 reports.
- Removed banned em dashes, including in the `displayName` users see.

### Added

- `.github/workflows/release.yml`. Building the `.vsix` and publishing the release
  were two manual acts and one was forgettable: v0.1.0, v0.2.0 and v0.6.0 are still
  empty, and v0.10.0 was published five minutes before its asset was uploaded by
  hand. The workflow does both in one run, gates the tag against package.json, main
  ancestry and the changelog, re-runs the AAHP gates plus build and tests, and then
  asserts the published release is not a draft and carries a fully uploaded,
  non-empty asset matching the digest the gates passed. Split into an unprivileged
  build job and a publish job that runs no repository or registry code, so nothing
  installed from npm can reach the token that writes releases.
- `versionSites` in `aahp.config.json`. The `version-sync` gate reported
  `SKIP - no versionSites configured` through every release that drifted.
- `aahp check` in CI. Only `verify` and `doctor` ran, so the governance gates,
  including `forbidden-patterns`, could not fail a build.
## [0.10.0] - 2026-09-03

### Removed

- `MODEL_LIMITS`, `PROVIDER_FALLBACK_LIMITS`, `MODEL_DISPLAY_NAMES` and `MODEL_TIERS`
  (129 lines). conduit-bridge v0.9.0 reports `context_window`, `max_output_tokens` and
  `display_name`, discovered per provider. The tables knew nothing about the gemini-3.8
  family, gpt-5.4, gpt-5.4-mini or the models agy resells, so 493 of 508 live models
  rendered as a bare slug and 21 of 36 CLI models were barred from Agent mode.

### Changed

- Every model reports every chat mode; tiering was a local guess with no source of truth.
- History trimming honours `max_prompt_chars` so a prompt cannot exceed its transport.
- `local-*` models, which the bridge never sees, assume a conservative 8192-token window.

## [0.9.1] - 2026-09-02

### Fixed

- The 120s request timeout capped the whole turn rather than idle time: no CLI provider
  streams, and the bridge writes nothing until the child exits, so a long turn died with
  no output. Now `conduit.requestTimeout`, default 330s.
- A timeout no longer falls back to the next model, which spent four budgets and four
  killed CLI runs before anything appeared.
- Timeout classification used `msg.includes('timeout')` against "timed out", so the
  friendly branch was dead code while a provider failure was mislabelled a client
  timeout. Replaced with a typed error.
- Stop now aborts the request; the bridge kills the CLI when the client disconnects, and
  nothing was closing the socket.
- Removed `cli-gemini/gemini-3.5-flash-high`, retired upstream but still offered in three
  quick pickers and a fallback chain.
- Background spawn sends `mode: agent` and now refuses early without a workspace `cwd`,
  instead of an HTTP 400 visible only in the output channel.
## [0.9.0] - 2026-09-02

### Added
- Plan chat sends `mode: plan` (plus workspace `cwd`) so conduit-bridge calls each CLI's native planner.
- Background spawn/fix-issue sends `mode: agent` with `cwd` so CLI providers can write the workspace. VS Code chat Agent mode stays host-side and does not send `agent`.

### Removed
- Weekly `llm-validation.yml` GitHub Action. It was not a PR gate, GitHub-hosted runners never had the CLIs, and the last scheduled run failed at `npm ci`. Tool-catalog schema tests remain in the regular CI suite.

## [0.8.0] - 2026-09-02

### Fixed
- CLI/API/local providers from conduit-bridge v0.5.2 now show as connected in the Bridge Manager, Health Dashboard, and status bar. The extension was still reading Playwright `sessionValid` / `hasProfile`, which the bridge no longer sends. Availability is `connected` (with `loginType` / `credentialSource`).

### Changed
- Aligned with conduit-bridge v0.6.0: API, CLI, and LM Studio transports only. Browser-session `web-*` providers and `/v1/login` / `/v1/logout` are gone. Spawn sends workspace `cwd`.
- Default model: `cli-gemini/gemini-3.1-pro-high`
- Model registry, spawn-agent catalog, and fallbacks use live CLI IDs (`cli-grok`, `cli-claude`, `cli-gemini`, `cli-codex`)
- Login commands open the bridge dashboard at `conduit.proxyUrl` instead of a Playwright browser
- Background agents (`spawnCliAgent`) call conduit-bridge `/v1/chat/completions` instead of spawning CLIs through `@elvatis_com/agent-backends`
- supply-chain-guard Action pin `@v5` -> exact `@v6.0.10` (2026-09-02 threat-intel batch + vscode-scanner)
- AAHP pin 3.8.1 -> 3.12.0; verify workflow matches the 3.10+ contract (`AAHP_BASE_SHA`, `persist-credentials: false`, Node 24)
- Dev deps: eslint 10.9.1, typescript-eslint 8.69.0, @types/node 26.4.1, vitest 4.1.11, esbuild 0.28.2 (supersedes Dependabot PRs #78-#83)

### Removed
- Web/Playwright provider identification in the status UI

## [0.7.6] - 2026-07-17

### Changed

- Dev deps: `@typescript-eslint/eslint-plugin` 8.63.0 -> ^8.64.0 (now aligned with `@typescript-eslint/parser` 8.64.0), `eslint` 10.6.0 -> ^10.7.0, `@types/node` 26.1.0 -> ^26.1.1
- No runtime changes; dev-only bumps, so the packaged `dist/extension.js` is functionally unchanged from v0.7.5
- Held back: `typescript` 6 -> 7 (Dependabot #73, closed): `@typescript-eslint/eslint-plugin@8.64` declares a peer of `typescript@">=4.8.4 <6.1.0"`, so the lint toolchain cannot resolve against the TypeScript 7 native port. Added a Dependabot ignore for the `typescript` major; revisit when typescript-eslint's peer range includes TS 7

## [0.7.5] - 2026-07-17

### Security

- Command-injection hardening (CWE-78) in the agent tool executors: validate branch names and command tokens coming from LLM tool args; switch `toolCreateWorktree`, `toolRunCommand`, `toolRemoveWorktree`, `getBranchStatus` and branch delete to `execFile`/`execFileSync` with no shell; validate the GitHub label in `batchFixIssues` before passing it to `execFileSync`. 32 regression tests added (shell metachars, leading hyphen, `..`, exec vs execFile assertions)
- Transitive `brace-expansion` bump - GHSA-jxxr-4gwj-5jf2 (ReDoS via large numeric range)

### Changed

- Dev deps: `eslint` ^10.6.0, `vitest` 4.1.10 (with `@vitest/coverage-v8` resolving 4.1.10 via the existing ^4.1.6 range), `@typescript-eslint/eslint-plugin` ^8.63.0, `@typescript-eslint/parser` ^8.64.0, `esbuild` ^0.28.1, `@types/node` ^26.1.0; transitive `vite` now resolves 8.1.3
- Re-pinned `@types/vscode` to `~1.90.0` to match `engines.vscode ^1.90.0` (vsce refuses to package otherwise) and added a Dependabot ignore rule for it - bump both together deliberately from now on
- Packaging: `.vscodeignore` extended (`scripts/**`, `schema/**`, `.scg-history/**`, `.github/**`, `CLAUDE.md`): the AAHP/CI repo tooling had crept into the .vsix; the artifact now ships only extension content
- CI / Infra: supply-chain-guard tracks the moving `@v5` release branch instead of stale SHA pins
- CI / Infra: `actions/checkout` 7, `actions/setup-node` 7, `actions/setup-python` 6, `github/codeql-action` 4, `actions/upload-artifact` 7
- CI / Infra: Dependabot exempted from the aahp-verify handoff gate
- CI / Infra: AAHP verify gate tooling synced to v3.5.0 (Layer 3 squash tolerance, hook tooling)
- Docs: Handoff docs reconciled with reality: multi-turn agent loop (T-016) confirmed shipped in v0.5.0-v0.7.0, issue #52 closed as done; VS Code Marketplace listing (T-006) dropped by decision 2026-07-17, issue #53 closed

## [0.7.4] - 2026-05-17

### Changed
- Dev dep `typescript` bumped from 5.x to ^6.0.3
- Dev dep `@types/node` to ^25.7.0
- Dev dep `@types/vscode` to ^1.118.0
- Dev dep `@vitest/coverage-v8` and `vitest` to ^4.1.6
- No runtime changes; addresses Dependabot PRs #40, #41, #42, #43

## [0.7.3] - 2026-05-05

### Changed
- Dev dep `@types/node` major bump 22.x to ^25.5.0
- Dev dep `eslint` major bump 8.x to ^10.1.0
- No runtime changes; addresses Dependabot PRs #30 and #34

## [0.7.2] - 2026-05-05

### Security
- Bump `vite` to 8.0.5 (transitive via vitest) - GHSA-4w7w-66w2-5vf9, GHSA path traversal in `.map` handling
- Bump `esbuild` to ^0.27.7 - GHSA-67mh-4wv8-2f99 (dev server request bypass)
- Bump `brace-expansion` (transitive) to fix GHSA-f886-m6hf-6m8v

### Changed
- Bump `@typescript-eslint/parser` 7.x to ^8.59.2 to align with `@typescript-eslint/eslint-plugin@^8.57.2` and unblock CI peer-dep resolution
- Bump `vitest` and `@vitest/coverage-v8` to ^4.1.5

## [0.7.0] - 2026-03-18

### Added

- **CI workflow:** Build + test on push/PR to `main` with coverage artifact upload (`.github/workflows/ci.yml`) (#11)
- **LLM tool-call validation CI:** Weekly multi-model smoke test against Claude Sonnet, Gemini Flash, and GPT-5.3 Codex (`.github/workflows/llm-validation.yml`), also triggerable via `workflow_dispatch` (#11)
- **CI badges** in README header (#11)
- **Shared agent backend abstraction** (`src/agent-backends.ts`): Extracted shared logic from `cli-runner.ts` including CLI detection, prompt formatting, environment setup, subprocess spawning, and backend configuration. Reduces duplication and enables easier addition of new backends (#10)
- **Session persistence and resume:** Agent session metadata saved to `globalState` on every status change. Sessions restored on VS Code restart. Log files persisted to `.conduit/sessions/<id>.log`. New `interrupted` status for sessions that were running when VS Code quit (#12)
- **Resume command:** `Conduit: Resume Interrupted Session` re-spawns an interrupted agent with the same model and title (#12)
- **Remove/Clear commands:** `Conduit: Remove Finished Session` and `Conduit: Clear All Finished Sessions` for session cleanup (#12)
- **Cost tracking per agent session:** Token usage parsing from CLI output (supports 6 formats: Claude, Gemini, Codex JSON, arrow, compact, total-only). Model pricing table with per-session cost estimates in tree item tooltips and output channel footer (#13)
- **Cost summary command:** `Conduit: Session Cost Summary` with per-model and per-session cost breakdown (#13)
- **Budget limit setting:** `conduit.maxSessionCost` to cap agent session spending (#13)

### Changed

- `cli-runner.ts` refactored to import shared logic from `agent-backends.ts` instead of duplicating it (#10)
- README roadmap updated: Issues #10, #11, #12, #13 marked as Done
- Tests: 22 new tests for agent backends (#10)
- Tests: 6 new tests for session persistence (#12)
- Tests: 27 new tests for cost tracking (#13)
- Tests: Total: 295+ tests across 19 test files
- Infrastructure: Branch protection enabled on `main`: require PR reviews, CI status checks, prevent force pushes and deletions, enforce for admins, linear history required

### Fixed

- Removed stale merge conflict marker from `src/commands.ts`

## [0.6.0] - 2026-03-18

### Added
- Agent backends: Claude CLI, Gemini CLI, OpenAI Codex, OpenCode, Pi
- Background agent sessions with spawn/monitor/kill
- Git worktree isolation for parallel agent work
- Worktree lock serialization (prevents .git/config.lock contention)
- Merge-status aware worktree cleanup
- Fix Issue command (auto-worktree + agent spawn)
- Model fallback chain definitions
- Live agent output streaming to session panel (#9)
- 277 tests across 17 test files

## [0.5.0] - 2026-03-17

### Added
- Reliable agent loop with tool execution

[Unreleased]: https://github.com/elvatis/conduit-vscode/compare/v0.10.1...HEAD
[0.10.1]: https://github.com/elvatis/conduit-vscode/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/elvatis/conduit-vscode/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/elvatis/conduit-vscode/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/elvatis/conduit-vscode/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/elvatis/conduit-vscode/compare/v0.7.6...v0.8.0
[0.7.6]: https://github.com/elvatis/conduit-vscode/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/elvatis/conduit-vscode/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/elvatis/conduit-vscode/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/elvatis/conduit-vscode/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/elvatis/conduit-vscode/compare/v0.7.0...v0.7.2
[0.7.0]: https://github.com/elvatis/conduit-vscode/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/elvatis/conduit-vscode/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/elvatis/conduit-vscode/releases/tag/v0.5.0
