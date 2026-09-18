# Install Kiro Fabric

Requires Bash, Git, Node >=24, pnpm **11.20.0**, tar/gzip, and Kiro CLI >=2.21.1 with v3 support on PATH.

From your Kiro Fabric checkout, run:

```sh
bash ./install.sh --source --kiro-home "${KIRO_HOME:-$HOME/.kiro}" --migrate-pi-fabric
```

The installer builds and installs Fabric, backs up existing configuration, and makes the selected Kiro home and its `agents` directory private (0700). Do not use `sudo`. Executable ancestry and shell configuration must already have safe ownership and permissions; see the preflight troubleshooting below. The migration flag replaces an old Pi Fabric profile only when its recorded ownership and checksum match; otherwise, unnecessary migration does nothing.

For unattended installation, add `--yes --non-interactive`. To leave shell configuration untouched, add `--no-shell-integration`.

After installation, start a new session from your project directory:

```sh
"${KIRO_HOME:-$HOME/.kiro}/kiro-fabric/bin/kiro-fabric" start
```

The launcher supplies the selected Kiro home and canonical workspace. The current profile also supports launch-directory binding without the shell shortcut; see [workspace troubleshooting](docs/installer.md#troubleshooting-verified-workspace-binding-is-required--explicitly-empty).

For a headless check, put options after `chat`:

```sh
KIRO_HOME="${KIRO_HOME:-$HOME/.kiro}" KIRO_FABRIC_LAUNCH_WORKSPACE="$(pwd -P)" \
  kiro-cli chat --v3 --agent kiro-fabric --output-format stream-json --require-mcp-startup \
  'Use fabric_exec to return fabric.info(). Do not use native tools.'
```

On Kiro CLI 2.21.1, putting `--agent kiro-fabric` before an explicit `chat` subcommand selected the default agent in our probes. Confirm the selected mode is `kiro-fabric` and the stream contains an actual `@fabric/fabric_exec` call and successful result; a native file read is not a Fabric check. Correctly selected Fabric worked on the first turn—warm-up prompts are not a verified remedy. Profile validation and doctor do not establish full tool filtering or interactive approval readiness.

Restart existing Kiro sessions after an update. Open a new terminal to load the installed shortcut that selects Fabric for `kiro-cli --v3`.

**Current client limitations:** native-TUI tests on Kiro CLI 2.21.1 and 2.22.0 returned `No handler registered for method: _kiro/mcp/elicitation`; edits requiring approval stayed blocked and files stayed unchanged. The client also invoked `disclose_context` outside the strict single-tool profile, although `/tools` showed only one Fabric tag. Do not treat that tag view or a model-authored tool list as complete filtering evidence, and do not work around missing approval by enabling blanket trust. See the [dated retest and remaining gates](docs/coding-readiness-2026-09-09.md#2026-09-16-linux-retest).

## If the CLI preflight fails

If you see:

```text
Kiro Fabric: Kiro CLI help/version preflight failed; authentication was not attempted
```

The installer could not complete a CLI check with a temporary home, a restricted environment, and a 5-second timeout. This is not an authentication failure.

Run these commands in the same terminal:

```sh
type -a kiro-cli
kiro-cli --version
kiro-cli agent validate --help
```

Confirm that Kiro CLI is available, its version is >=2.21.1, and the validation help includes `--path`. If a command fails, resolve that CLI error first. If both CLI commands succeed, retry the installer once: the isolated check may have timed out. If it still fails, report the outputs above and the installer error; normal CLI checks can pass while isolated checks fail.

If the installer instead reports `Unsafe Kiro CLI directory ancestry` or `unsafe shell integration file permissions`, inspect the named path's ownership and permissions. For your own trusted path, remove group/other write access (`chmod go-w <path>`); for shell configuration you can instead use `--no-shell-integration`. `umask 022` affects newly created paths only—it does not repair existing permissions. Preview the install with `bash ./install.sh --source --dry-run --json`.

For `doctor --source-root <checkout>` reporting `unsafe diagnostic metadata permissions`, check `package.json`, `install.sh`, `README.md`, `pnpm-lock.yaml` and `tsconfig.json` in that trusted checkout. Remove group/other write access from the reported metadata; do not bypass ownership checks.

Do not delete configuration or rerun with `sudo`. A failed installation is not a guarantee that nothing changed; preserve any reported backups or recovery evidence.

See [installation details](docs/installer.md) for prerequisites and recovery.

Optional [deterministic task recovery](docs/configuration.md#deterministic-task-recovery-opt-in) provides durable declared checkpoints, explicit host-operation capture, and reproducible summaries. Disabled by default; it does not replace Kiro's native compaction.
