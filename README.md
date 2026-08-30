# kiro-fabric

**A checked TypeScript execution and orchestration layer for Kiro CLI.**

[![npm](https://img.shields.io/npm/v/kiro-fabric?logo=npm&label=npm)](https://www.npmjs.com/package/kiro-fabric)
[![checks](https://img.shields.io/github/actions/workflow/status/asx8678/kiro-fabric/test.yml?branch=main&label=checks)](https://github.com/asx8678/kiro-fabric/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Fabric replaces a long list of model-facing tools with one programmable tool: `fabric_exec`. The model writes a small TypeScript program, Fabric checks it, executes it in QuickJS by default, and routes every effect through a host capability boundary.

That one program can read and change a confined repository, call configured MCP servers, use project-scoped memory, optionally fan bounded work out to Kiro ACP children, and return only the result that matters.

```text
model
  │
  ▼
fabric_exec({ code })
  │
  ├─ TypeScript validation
  ├─ QuickJS isolation by default
  └─ approval-gated host bridge
       ├─ repository tools
       ├─ configured MCP servers
       ├─ optional Kiro ACP children
       └─ project-scoped memory
```

## Why Fabric

- **Programmable composition.** Use variables, conditions, loops, functions, and `Promise.all` in one checked program.
- **Less model context.** Core-tool and MCP schemas stay behind one stable entry point.
- **One control plane.** Approvals, deadlines, output limits, and audit data apply at the host boundary. Cancellation applies where the host protocol supports it.
- **More than one-shot agents.** Fabric can orchestrate workflows and bounded agent execution through the Kiro integration.
- **Visible execution.** Fabric provides visible execution through its supported Kiro-facing runtime and diagnostics.
- **A conservative Kiro bridge.** Kiro gets the same checked-program model with a deliberately smaller API and fail-closed capability gaps.

## Requirements

- Node.js 24 or newer
- Kiro CLI exactly 2.20.1 with agent engine v3 for the managed Kiro integration

## Kiro CLI quickstart

Use this path to install Fabric as a managed Kiro v3 agent. The commands create a profile named `kiro-fabric`; they do not change Kiro's default agent.

### Run the guided installer

Install the published package and run its guided setup bin:

```bash
npm install --global kiro-fabric
kiro-fabric-setup
```

For development from a source checkout on Linux or macOS, run `sh scripts/install-kiro-fabric.sh`. The source bootstrap checks Node.js, asks before installing dependencies or building a missing compiled entry, and consistently targets user scope for install, update, repair, uninstall, and doctor. The profile keeps Kiro approval prompts enabled unless you explicitly add a grant.

A bare run binds the shared user profile to the canonical source checkout. Set `KIRO_FABRIC_PROJECT_ROOT` or pass `--project-root` to target another workspace. Preview an explicit target before applying it:

```bash
sh scripts/install-kiro-fabric.sh install \
  --project-root /absolute/path/to/project --dry-run
sh scripts/install-kiro-fabric.sh install \
  --project-root /absolute/path/to/project
```

The source installer adds `--user` automatically to `install`, `update`, `repair`, `uninstall`, and `doctor`. It defaults `--project-root` to the canonical checkout (or `KIRO_FABRIC_PROJECT_ROOT`) while preserving an explicit override. New installs start with grants off; update and repair preserve all existing advanced grants unless an explicit `--revoke-*` or `--reset-grants` option changes them.

For scripts or CI, `kiro-fabric-setup` accepts `status`, `doctor`, `install`, `update`, `repair`, `uninstall`, and `launch` subcommands.

Important:

- Node.js 24+ and an installed, authenticated Kiro CLI 2.20.1 are required.
- Source preparation is confirmation-gated. On a terminal the bootstrap asks first; non-interactive preparation requires `--yes`, `KIRO_FABRIC_AUTO_BUILD=1`, or a prebuilt checkout. Set `KIRO_FABRIC_AUTO_BUILD=0` to forbid preparation, `KIRO_FABRIC_REBUILD=1` to explicitly force it, or `NO_COLOR=1` to disable styling.
- The source installer always writes under `$KIRO_HOME` or `~/.kiro`; it does not support project-local installation.
- Explicit `--allow-tools` auto-approval applies only to `fabric/fabric_exec`, not every MCP or shell tool. Because Fabric can edit files through this tool, the grant is bound to the canonical project directory used during installation and will refuse launches from another project.
- Run `--dry-run` before the real install. Non-interactive mutation requires `--yes`; it confirms the operation but never implies `--force`.
- Avoid transient runners such as `npx`: the profile records an absolute path to the installed MCP runtime.
- Run `kiro-fabric-setup --help` for every command and option. See the [installer guide](docs/kiro/installer.md) for update, uninstall, backups, and troubleshooting.

### 1. Install Fabric

Use the package setup bin shown above, or the source bootstrap when developing this repository:

```bash
node --version
kiro-cli --version
sh scripts/install-kiro-fabric.sh
```

Node must report version 24 or newer. Kiro must report version 2.20.1. Install and authenticate Kiro CLI through its official setup before continuing. The installed format-3 profile records only the vendored Node and release paths under the selected `.kiro` tree; the npm package or source checkout may be retired after installation.

### 2. Run the compatibility preflight

```bash
kiro-fabric doctor kiro
```

Doctor checks the supported Node and Kiro versions, validates an isolated temporary profile, starts the packaged MCP adapter, and probes ACP startup. It is read-only and non-billable: it sends zero model prompts and does not inspect or modify an installed profile.

For machine-readable diagnostics:

```bash
kiro-fabric doctor kiro --json
```

Continue only after doctor reports `PASS`.

### 3. Install the managed profile

Change to the project where you want to use Kiro. `pwd -P` records its canonical, symlink-free path.

```bash
cd /absolute/path/to/project

kiro-fabric install kiro --user \
  --project-root "$(pwd -P)" \
  --dry-run --json

kiro-fabric install kiro --user \
  --project-root "$(pwd -P)"
```

`--user` writes one shared profile to `$KIRO_HOME/agents/kiro-fabric.json` when `KIRO_HOME` is set, or `~/.kiro/agents/kiro-fabric.json` otherwise. The dry run validates the plan without changing either location. User scope and project-local scope are alternatives; install only the scope you intend to use. A default user profile works across repositories and roots tools at the directory where each Kiro chat starts.

The default profile starts with the fewest Kiro-specific grants:

- Kiro sees one tool, `@fabric/fabric_exec`.
- Repository operations use `k.read`, `k.grep`, `k.find`, `k.ls`, `k.write`, and `k.edit` inside checked Fabric programs.
- Shell execution and ACP subagents are unavailable.
- Kiro asks for approval before invoking the outer `fabric_exec` tool because the profile carries one exact `ask` rule for `fabric/fabric_exec`; broader ambient allows cannot bypass it.
- Repository access is confined to the canonical directory where `kiro-cli chat` starts.

The default profile is capable of edits. After Kiro approves the outer tool, nested reads, writes, and MCP calls follow the global Fabric risk policy. Shipped defaults allow write and network actions. Managed Kiro cannot open a nested approval prompt, so `ask` and `auto` fail closed while `allow` proceeds.

Managed Kiro reads the global Fabric configuration used by the Kiro integration. Keep `executor.runtime` set to `quickjs` for isolated guest execution. A global `node-process` selection also applies to Kiro and runs generated guest code as trusted native V8 code. Use global `deny` policies when you want a read-only or offline Kiro profile:

```json
{
  "configVersion": 4,
  "executor": {
    "runtime": "quickjs"
  },
  "approvals": {
    "write": "deny",
    "network": "deny"
  }
}
```

### 4. Start Kiro

Launch Kiro from the project directory you want Fabric to access:

```bash
cd /absolute/path/to/project
kiro-cli --v3 --agent kiro-fabric
```

Ask Kiro to inspect or edit the repository normally. The managed profile instructs it to perform repository work through `fabric_exec` and the Kiro-only `k.*` namespace.

For efficient v3 use, keep ordinary implementation and review work in the default chat mode and let Kiro's `auto` model route choose model and effort unless you have measured a reason to pin them. Use spec mode for requirements/design/task decomposition (`kiro-cli chat --v3 --agent kiro-fabric --mode spec`), and use tangent mode for a side investigation that should not pollute the main trajectory. Inside Fabric, combine related operations in one checked `fabric_exec` program, use `Promise.all` only for independent calls, read narrow ranges, and return compact results. Enable Fabric subagents only for independent work that benefits from parallel verification.

Kiro v3 session storage is incompatible with v2. Fabric records v3 engine provenance and keeps an engine-specific `kiro-runtime-v3` profile marker, refusing to feed an unproven legacy session to v3. Kiro 2.20.1's KAS persists the actual transcript in the authenticated OS home's `.kiro` store, so removing it makes a durable resume fail closed. Recreate any durable Kiro actor whose only saved session came from the previous v2 integration.

### Trusted local mode

Enable extra capabilities only for a machine and project you trust:

```bash
cd /absolute/path/to/project

kiro-fabric install kiro --user \
  --project-root "$(pwd -P)" \
  --allow-shell \
  --subagents \
  --allow-tools
```

| Flag | Grant |
| --- | --- |
| `--allow-shell` | Enables `k.bash`. Commands run with your local OS permissions. |
| `--subagents` | Enables at most four non-recursive Kiro ACP children. Requires `--allow-shell`. |
| `--allow-tools` | Explicitly adds one exact v3 MCP allow rule for `fabric/fabric_exec`. |

The example enables all three grants. Any selected grant binds the profile to the recorded canonical project path and its filesystem identity. Launching it from another project fails before the MCP runtime starts. Replacing, moving, or symlink-retargeting the project directory also requires a fresh install. Setup `update` and `repair` preserve these grants by default and report a before/after diff. Use `--revoke-shell`, `--revoke-subagents`, `--revoke-tools`, or `--reset-grants` to remove them explicitly. A user Kiro home contains one managed `kiro-fabric` profile, so installing a trusted profile for another project updates that shared profile.

Project identity is a launch-time grant check and a boundary for repository file tools. It is not a shell sandbox. `k.bash` runs with the MCP process's ambient OS permissions and can access paths, credentials, processes, and network resources outside the project. Combining `--allow-shell` with `--allow-tools` removes Kiro's outer tool prompt as well.

The adapter forwards any MCP cancellation signal into the active Fabric execution and retains the 15.5-minute MCP deadline as a hard fallback. Cancellation cannot undo effects that already completed; inspect the repository or external system before retrying an interrupted mutation.

### Project-local profile

Omit `--user` to keep the managed profile inside the repository:

```bash
cd /absolute/path/to/project
kiro-fabric install kiro --project-root "$(pwd -P)"
```

This writes `.kiro/agents/kiro-fabric.json` plus Fabric's ownership manifest and backups below `.kiro/.kiro-fabric/`. The installer never walks upward to select a Git root.

### Install from this repository

Use a local checkout when developing Fabric or while the npm package is unavailable:

```bash
git clone https://github.com/asx8678/kiro-fabric.git
cd kiro-fabric
sh scripts/install-kiro-fabric.sh
```

When compiled output is missing, the installer asks before preparing dependencies and the build. For an explicit, non-interactive user installation, use `--yes` on the applying command (or prebuild the checkout first):

```bash
sh scripts/install-kiro-fabric.sh doctor \
  --project-root /absolute/path/to/project
sh scripts/install-kiro-fabric.sh install --user \
  --project-root /absolute/path/to/project --dry-run
sh scripts/install-kiro-fabric.sh install --user \
  --project-root /absolute/path/to/project --yes
```

The source checkout is only the trusted bootstrap artifact. Format-3 installation copies the complete runtime, manager, skills, and Node executable into the selected `.kiro` tree.

### Update or uninstall

Update the package, then use setup `update`; existing advanced grants are preserved and shown in the JSON/human diff:

```bash
npm install --global kiro-fabric@latest
kiro-fabric-setup update --user --project-root /absolute/path/to/project --yes
kiro-fabric-setup doctor --user --project-root /absolute/path/to/project
```

Use `kiro-fabric-setup repair ... --yes` from a trusted current package/source artifact to restore tampered runtime bytes, the vendored Node, executable mode, manager, skills, and release identity in the manifest. `status` hashes the profile and the rest of the full owned install. A healthy installed manager remains usable after the package origin is removed; if installed runtime bytes are damaged, run repair from the trusted package bootstrap; a damaged manager is untrusted code.

Uninstall the profile before removing its npm package. For user scope:

```bash
kiro-fabric uninstall kiro --user --dry-run --json
kiro-fabric uninstall kiro --user
npm uninstall --global kiro-fabric
```

If installation used a custom Kiro home, add the same `--kiro-home /absolute/path/to/home` to both uninstall commands. For project-local scope, run `kiro-fabric uninstall kiro --project-root "$(pwd -P)"`. Uninstall removes only hash-owned managed content and restores a verified backup when the installer displaced an existing profile.

### Troubleshooting

- Run `kiro-fabric-setup status --user --json` and `kiro-fabric-setup doctor --user --json` first. Status verifies the profile, skills, closure file set and hashes, installed Node executable hash and mode, installed Kiro artifact, activation marker, manager binding, grants, and manifest/release identity. Exit code `0` means every required doctor check passed; `1` means diagnosis or installation failed; `2` means the arguments were invalid. Setup usage and lifecycle failures emit exactly one `{ ok: false, error }` object on stdout with `--json`; doctor always emits its `kiro-fabric.kiro-doctor` report envelope, with `ok: false` and failed checks when diagnosis fails.
- Confirm `node --version` reports Node 24 or newer and `kiro-cli --version` reports 2.20.1.
- Pass `--kiro-binary /absolute/path/to/kiro-cli` to doctor and install when Kiro is outside `PATH`.
- If Kiro cannot find the agent, confirm the profile exists at `~/.kiro/agents/kiro-fabric.json` or below the configured `$KIRO_HOME`.
- If a trusted profile rejects a moved or recreated project, rerun `install kiro` from the new canonical path.
- If an unknown or user-modified profile blocks installation, inspect the dry-run output before using `--force`. Forced installation creates a content-addressed backup first.

The [Kiro installer guide](docs/kiro/installer.md) documents file ownership, backups, custom Kiro homes, timeouts, and exit codes. The [current v3 capability record](docs/kiro/capabilities-2.20.1-v3.md) covers Kiro features, Fabric-efficient use, migration choices, and remaining real gates. The older [Kiro parity matrix](docs/kiro/parity-qualification.md) is retained as v2 certification history.

## Runtime surfaces

Managed Kiro exposes the Fabric capabilities that can preserve their safety and lifecycle contracts through the Kiro integration.

- Repository tools: `k.*`
- Checked execution: uses the global Fabric executor setting
- MCP: configured `mcp.servers()` and `mcp.call()` only
- Agents: optional bounded Kiro ACP children
- Local parallel, pipeline, and progress helpers
- Persistent memory: launch-directory-isolated and bounded

Availability also depends on profile flags, configuration, the configured
`kiro-cli` binary, and the approval policy for the requested effect. Optional
children always use that Kiro CLI runner; Pi, Claude, and Veda are not runtime
alternatives in the managed profile.

## Security model

- QuickJS is the default guest boundary. Guest code has no `process`, `require`, filesystem, network, or subprocess globals; effects must cross the host bridge.
- Type checking improves correctness but is not a security boundary.
- The optional `node-process` executor runs trusted native V8 code in managed Kiro. It is not a sandbox.
- MCP servers execute with their own host privileges. Review their configuration before enabling them.
- Fabric classifies effects as read, write, execute, network, or agent actions. Use `ask` or `deny` where the project is not fully trusted.
- Agent transcripts, run logs, and Kiro persistent memory can contain sensitive project data. Kiro memory is permission-restricted to the local owner and is not encrypted.
- Managed Fabric does not delegate nested approval decisions through MCP. Operations requiring that unavailable approval bridge fail closed unless the matching trusted grant was installed explicitly.

## Documentation

- [Skills](docs/skills.md). Kiro Fabric keeps a small verification-first skill surface; core guidance is installed by default and specialized profiles remain user-opt-in.
- [Kiro installer](docs/kiro/installer.md)
- [Kiro capability qualification](docs/kiro/parity-qualification.md)
- [Matched tool-result security replay](docs/security-replay.md)

## Development

```bash
pnpm install
pnpm run check
```

`pnpm run check` runs type checking, a production build, lazy-startup validation, the full test suite, and dead-code analysis. Run a fresh build after every source change:

```bash
pnpm run build
```

The package exports `.`, `kiro-fabric/protocol`, `kiro-fabric/kernel`, `kiro-fabric/kiro`, and `kiro-fabric/verification` entry points.

## License

[MIT](LICENSE)
