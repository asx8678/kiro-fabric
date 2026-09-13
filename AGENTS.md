# AGENTS.md

## Golden rule: build when done

Always finish a change with a fresh build before handing it back:

```sh
pnpm run build
```

Kiro CLI v3 (`kiro-cli --v3`) and the published Agent loads `dist/`, not `src/`. Tests run against `src/`, so green tests alone are not enough. Rebuild so the user can verify immediately.

## Before committing

```sh
pnpm run check
```

This runs typecheck, build, the full test suite, dead-code lint, staging, certification, and SBOM generation.

## Local verification

The installer validates the *running* Node executable with `assertTrustedExecutable`, which correctly refuses group-writable ancestry. Homebrew's `/opt/homebrew/Cellar` is `drwxrwxr-x`, so `node` from Homebrew cannot install the Agent and the installer acceptance suites fail (`unsafe Node executable directory ancestry`, or `Candidate private node version/compatibility check failed` for a launcher stub). Run the check with a trusted standalone Node (≥64 MiB) instead, such as the private runtime Node Fabric already installed:

```sh
ls -d "$HOME/.kiro/kiro-fabric/runtime"/*/tools/node   # pick a generation
ln -sfn "$HOME/.kiro/kiro-fabric/runtime/<generation>/tools/node" .tmp/trusted-node/node
PATH="$PWD/.tmp/trusted-node:$PATH" pnpm run check
```

`.tmp/` is git-ignored, and the symlink resolves to the real trusted binary. With portable Node 24.20.0 the suite is green: 145 files passed, 1 skipped, 2332 tests passed.

## Commits

Use conventional commits (commitlint): `feat(scope): ...`, `fix(scope): ...`, `chore(release): <version>` for version bumps.
