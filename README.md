```sh
bash ./install.sh --source --kiro-home "${KIRO_HOME:-$HOME/.kiro}" --migrate-pi-fabric
```

Run this from the checkout. The installer builds Fabric, makes the selected Kiro
home and its `agents` directory private to you (0700), and backs up existing
configuration. No `sudo` or manual `chmod` is needed. Valid Kiro CLI hard links
are supported. The migration option preserves and replaces an old Pi Fabric
profile only when its recorded ownership and checksum match; it does nothing
when migration is unnecessary.

After installation, start a new Kiro session from your project:

```sh
kiro-cli --v3
```

The installed Fabric profile binds Kiro's launch directory automatically, even
when Kiro supplies no MCP roots. No manual workspace binding or environment
export is needed. If Fabric isn't already selected, use
`kiro-cli --v3 --agent kiro-fabric` (works in existing terminals too).

The installer also configures a backed-up bash/zsh shortcut that selects Fabric
for `kiro-cli --v3`; open a new terminal to load that shortcut.
`--no-shell-integration` leaves shell files untouched without disabling workspace
binding. Existing Kiro sessions must restart after an update.

For unattended installation, add `--yes --non-interactive`. See
[installation details](docs/installer.md) for prerequisites and recovery.
