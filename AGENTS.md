# AGENTS.md

## Golden rule: build when done

Always finish a change with a fresh build before handing it back:

```sh
pnpm run build
```

Kiro CLI v3 (`kiro-cli --v3`) and the published Power load `dist/`, not `src/`. Tests run against `src/`, so green tests alone are not enough. Rebuild so the user can verify immediately.

## Before committing

```sh
pnpm run check
```

This runs typecheck, build, the full test suite, dead-code lint, staging, certification, and SBOM generation.

## Commits

Use conventional commits (commitlint): `feat(scope): ...`, `fix(scope): ...`, `chore(release): <version>` for version bumps.
