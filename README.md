# Install Kiro Fabric

Requires Bash, Git, Node >=24, pnpm **11.20.0**, tar/gzip, and Kiro CLI >=2.21.1 with v3 support on PATH.

From your Kiro Fabric checkout, run:

```sh
bash ./install.sh --source --kiro-home "${KIRO_HOME:-$HOME/.kiro}" --migrate-pi-fabric
```

The installer builds and installs Fabric, backs up existing configuration, and makes the selected Kiro home and its `agents` directory private (0700). No `sudo` or manual `chmod` is needed. The migration flag replaces an old Pi Fabric profile only when its recorded ownership and checksum match; otherwise, unnecessary migration does nothing.

For unattended installation, add `--yes --non-interactive`. To leave shell configuration untouched, add `--no-shell-integration`.

After installation, start a new session from your project directory:

```sh
kiro-cli --v3 --agent kiro-fabric
```

Restart existing Kiro sessions after an update. Open a new terminal to load the installed shortcut that selects Fabric for `kiro-cli --v3`.

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

Do not delete configuration or rerun with `sudo`. A failed installation is not a guarantee that nothing changed; preserve any reported backups or recovery evidence.

See [installation details](docs/installer.md) for prerequisites and recovery.
