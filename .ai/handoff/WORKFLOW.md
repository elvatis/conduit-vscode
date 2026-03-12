# WORKFLOW.md — conduit-vscode

> Based on the [AAHP Protocol](https://github.com/homeofe/AAHP).

## Agent Roles

| Agent | Model | Role |
|---|---|---|
| 🔭 Researcher | perplexity/sonar-pro | VS Code API research, extension best practices, UX patterns |
| 🏛️ Architect | claude-opus | Feature design, webview architecture, command surface |
| ⚙️ Implementer | claude-sonnet | Code, build, commits |
| 💬 Reviewer | gpt-5 / second model | UX review, accessibility, security |

## Pipeline

### Phase 1: Research
```
Reads:   NEXT_ACTIONS.md, STATUS.md
Does:    Research VS Code API, check existing extension patterns
Writes:  LOG.md — findings
```

### Phase 2: Architecture
```
Reads:   LOG.md research, CONVENTIONS.md, relevant src/ files
Does:    Design feature, define interfaces, plan implementation
Writes:  LOG.md — ADR
```

### Phase 3: Implementation
```
Reads:   LOG.md ADR, CONVENTIONS.md
Does:    Code changes, npm run build (must pass)
Writes:  src/ changes
```

### Phase 4: Handoff
```
Updates: STATUS.md, NEXT_ACTIONS.md, DASHBOARD.md, MANIFEST.json, LOG.md
Commits: git add -u && git commit && git tag (if release) && git push
Release: gh release create (if version bump)
```

## Key Rules
- `npm run build` must pass before any commit
- All webview HTML must be inline (no external resources)
- Always check `editor.selection.isEmpty` before selection-dependent commands
- `vscode` is always external — never import it from test code without mocking
- `gh release create` mandatory for releases — git tags alone don't suffice
