```sh
bash ./install.sh --source --kiro-home "${KIRO_HOME:-$HOME/.kiro}" --migrate-pi-fabric
```

Run this from the checkout. The installer builds Fabric, makes the selected Kiro
home and its `agents` directory private to you (0700), and backs up existing
configuration. No `sudo` or manual `chmod` is needed. Valid Kiro CLI hard links
are supported. The migration option preserves and replaces an old Pi Fabric
profile only when its recorded ownership and checksum match; it does nothing
when migration is unnecessary.

After installation, **open a new terminal**, change to your project, and run:

```sh
kiro-cli --v3
```

The installer configures a backed-up bash/zsh shell handoff automatically; no
manual workspace binding or environment export is needed. Use
`--no-shell-integration` to opt out and use `kiro-fabric start` instead.

For unattended installation, add `--yes --non-interactive`. See
[installation details](docs/installer.md) for prerequisites and recovery.
