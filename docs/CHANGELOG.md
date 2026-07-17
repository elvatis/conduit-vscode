# Changelog

All notable changes to conduit-vscode are documented here.

## [0.7.5] - 2026-07-17

### Security
- Command-injection hardening (CWE-78) in the agent tool executors: validate branch names and command tokens coming from LLM tool args; switch `toolCreateWorktree`, `toolRunCommand`, `toolRemoveWorktree`, `getBranchStatus` and branch delete to `execFile`/`execFileSync` with no shell; validate the GitHub label in `batchFixIssues` before passing it to `execFileSync`. 32 regression tests added (shell metachars, leading hyphen, `..`, exec vs execFile assertions)
- Transitive `brace-expansion` bump - GHSA-jxxr-4gwj-5jf2 (ReDoS via large numeric range)

### Changed
- Dev deps: `eslint` ^10.6.0, `vitest` 4.1.10 (with `@vitest/coverage-v8` resolving 4.1.10 via the existing ^4.1.6 range), `@typescript-eslint/eslint-plugin` ^8.63.0, `@typescript-eslint/parser` ^8.64.0, `esbuild` ^0.28.1, `@types/node` ^26.1.0; transitive `vite` now resolves 8.1.3
- Re-pinned `@types/vscode` to `~1.90.0` to match `engines.vscode ^1.90.0` (vsce refuses to package otherwise) and added a Dependabot ignore rule for it - bump both together deliberately from now on

### Packaging
- `.vscodeignore` extended (`scripts/**`, `schema/**`, `.scg-history/**`, `.github/**`, `CLAUDE.md`): the AAHP/CI repo tooling had crept into the .vsix; the artifact now ships only extension content

### CI / Infra
- supply-chain-guard tracks the moving `@v5` release branch instead of stale SHA pins
- `actions/checkout` 7, `actions/setup-node` 7, `actions/setup-python` 6, `github/codeql-action` 4, `actions/upload-artifact` 7
- Dependabot exempted from the aahp-verify handoff gate
- AAHP verify gate tooling synced to v3.5.0 (Layer 3 squash tolerance, hook tooling)

### Docs
- Handoff docs reconciled with reality: multi-turn agent loop (T-016) confirmed shipped in v0.5.0-v0.7.0, issue #52 closed as done; VS Code Marketplace listing (T-006) dropped by decision 2026-07-17, issue #53 closed

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

### Fixed
- Removed stale merge conflict marker from `src/commands.ts`

### Tests
- 22 new tests for agent backends (#10)
- 6 new tests for session persistence (#12)
- 27 new tests for cost tracking (#13)
- Total: 295+ tests across 19 test files

### Infrastructure
- Branch protection enabled on `main`: require PR reviews, CI status checks, prevent force pushes and deletions, enforce for admins, linear history required

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
