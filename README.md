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

Shell execution is enabled by default (`approvals.execute: "allow"`). Commands
have host access, including writes and network access. Explicit `ask`/`deny`
overrides are preserved; direct write/network approvals remain `ask`. See
[approval configuration](docs/configuration.md#clients-without-roots-or-elicitation).

## Evidence-led reviews

Repository reviews now use a coverage ledger and an on-demand `fabric.help({topic:"review"})` workflow: follow scripts, environment overrides and configuration consumers; verify suspected defects and report uninspected scope. Routine answer brevity does not limit audits. This is agent guidance, not a guarantee that a model will find every defect.

In a new Fabric chat, a short first message such as `review this project` receives a substantial investigation block automatically. The block includes a tested discovery/read program and is appended once per session, including across resume. Later messages receive no fresh copy. Kiro may retain it in conversation history; it does not force Auto to select a particular model. See [first-message context](docs/configuration.md#first-message-investigation-context).

`local.find` and `local.grep` accept `hidden:true` for CI/dotfiles while retaining ignore rules, VCS exclusions and path safety. Search results report their `scope`; reads report `totalLines` alongside continuation flags. Recursive all-files manifests use one ripgrep pass rather than repeated shallow directory listings.

The [comparison lab](docs/agent-comparison.md) includes a seeded read-only review fixture with precision/recall and credits-per-grounded-finding reporting. Offline regression tests are not evidence that Fabric outperforms default Kiro; use matched live trials before making that claim.

For unattended installation, add `--yes --non-interactive`. See
[installation details](docs/installer.md) for prerequisites and recovery.
