# Kiro setup

## One-command setup

```bash
./scripts/setup-kiro.sh
# or: pnpm setup:kiro
```

This installs locked dependencies, builds Fabric Lite, installs and validates both Kiro agents, creates project configuration, and runs `doctor`. Preview with `./scripts/setup-kiro.sh --dry-run`; use `--force` only when replacing existing generated files (backups are created first).

## Manual setup

Build and inspect the installation before applying it:

```bash
pnpm build
node dist/cli/main.js install-kiro --dry-run --format json
node dist/cli/main.js install-kiro --format json
node dist/cli/main.js doctor --format json
```

The installer stages and validates v2 JSON profiles, installs global profiles in `~/.kiro/agents/` plus repository copies in `.kiro/agents/`, and creates `.fabric-lite/config.json`. Existing files are refused. `--force` first renames every conflict to a timestamped backup. The parent profile uses the absolute built CLI path and shell remains interactive (`allowedTools: []`); it never enables `--trust-all-tools`. The worker has no tools, resources, delegation, or MCP inheritance.

Launch with the exact command printed by the installer, normally `kiro-cli --agent fabric-lite`. The selected agent is always-on: every request goes through one checked, ephemeral Fabric Lite program. The program appears in Kiro shell activity as a heredoc but is not saved to the repository. Restart Kiro after reinstalling so a running session does not retain the previous agent prompt. Paid semantic diagnosis is opt-in: `fabric-lite doctor --smoke`.