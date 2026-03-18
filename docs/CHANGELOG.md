# Changelog

All notable changes to conduit-vscode are documented here.

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
