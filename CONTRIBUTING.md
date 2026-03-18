# Contributing to conduit-vscode

Thanks for your interest in contributing. Follow these steps to get your changes considered:

## Getting Started

1. Fork the repository and create a feature branch from `main`.
2. Install dependencies: `npm ci`
3. Run tests: `npm test` (all must pass)
4. Run build: `npm run build` (must succeed)

## Pull Request Process

1. Keep changes focused and small.
2. Update `docs/CHANGELOG.md` with a short entry for your change.
3. Open a Pull Request against `main` with a clear description.
4. Link any relevant issues.

## PR Checklist

- [ ] Tests added/updated and passing
- [ ] Documentation updated (README, CHANGELOG) if behavior changes
- [ ] Version bumped if releasing a new version
- [ ] No secrets in commits

## Code Style

- TypeScript strict mode
- Use existing patterns in the codebase
- No em dashes in comments or documentation

## Reporting Issues

Use the provided issue templates (Bug Report / Feature Request).

For major changes, open an issue first to discuss design and scope.
