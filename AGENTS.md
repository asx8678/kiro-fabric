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

`.tmp/` is git-ignored, and the symlink resolves to the real trusted binary. Use current command output for test counts and results; focused fixture checks under different umasks do not certify the full suite.

## Environment preflight (umask 0002)

The installer refuses unsafe writable ancestors and control files. With `umask 0002`, newly created paths can be group-writable, so inspect the specific path named by a failure:

- `Unsafe Kiro CLI directory ancestry: <path>` — an unsafe directory in `kiro-cli`'s ancestry is a prerequisite failure (exit 4). If it is your intended directory, remove group/other write access, for example `chmod go-w ~/.local/bin`.
- `unsafe shell integration file permissions: <path>` — unsafe shell configuration fails preflight (exit 5). For your own file, use `chmod go-w ~/.bashrc`, or install with `--no-shell-integration`.

Preview without installation mutations: `bash ./install.sh --source --dry-run --json`. Execution still performs additional checks, and a later failure is not a guarantee that nothing changed. Preserve backups and recovery evidence.

Source diagnostics apply the same permissions rule. For your trusted checkout, inspect and remove group/other write access from the reported metadata:

```sh
chmod go-w package.json install.sh README.md pnpm-lock.yaml tsconfig.json
```

`umask 022` helps prevent unsafe modes on newly created files; it does **not** repair existing files or directories. Do not weaken ownership checks or change unrelated paths.

## Launching the installed agent

From the project directory, use the installed launcher for explicit home and canonical workspace binding:

```sh
"${KIRO_HOME:-$HOME/.kiro}/kiro-fabric/bin/kiro-fabric" start
```

The current profile also authorizes the MCP launch directory with `KIRO_FABRIC_WORKSPACE_SOURCE=launch-cwd`. An unset/unexpanded `KIRO_FABRIC_LAUNCH_WORKSPACE` alone does not disable that fallback. An explicit workspace handoff takes precedence over the launch directory; client roots still take precedence over both.

For headless verification, put chat options **after** the `chat` subcommand:

```sh
KIRO_HOME="${KIRO_HOME:-$HOME/.kiro}" KIRO_FABRIC_LAUNCH_WORKSPACE="$(pwd -P)" \
  kiro-cli chat --v3 --agent kiro-fabric --output-format stream-json --require-mcp-startup \
  'Use fabric_exec to return fabric.info(). Do not use native tools.'
```

On the tested Kiro CLI 2.21.1, `kiro-cli --v3 --agent kiro-fabric chat ...` selected the default `vibe` agent; placing the options after `chat` selected `kiro-fabric` and executed Fabric on the first turn. Earlier default-agent runs, including READY/resume probes, do not establish a Fabric startup race. Do not prescribe warm-up prompts as a fix.

Validate the selected mode and actual `@fabric/fabric_exec` call/result in stream events, not just the assistant's answer, initial MCP token count, `doctor`, or profile validation. Reject native fallback as Fabric evidence. Full model-visible tool filtering and successful interactive approval remain separate release gates; a passing read probe does not certify them.

## Commits

Use conventional commits (commitlint): `feat(scope): ...`, `fix(scope): ...`, `chore(release): <version>` for version bumps.
