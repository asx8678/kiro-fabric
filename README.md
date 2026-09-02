# Kiro Fabric

> Add checked TypeScript workflows to Kiro while keeping Kiro's native tools.

Kiro Fabric is a Kiro Power for jobs that need several coordinated steps. Kiro
writes a small TypeScript program, Fabric type-checks it, runs it, and returns a
bounded result. This gives Kiro a checked composition layer for loops, branches,
parallel configured-provider calls, project memory, workspace state, and MCP
federation.

[MCP](https://modelcontextprotocol.io/) is the Model Context Protocol used to
connect tools and services.

> **Current release status:** local source installation is supported for Kiro
> IDE and Kiro CLI v3 testing. CLI v3 auto-detects Powers installed through the
> IDE; Kiro does not currently provide a separate CLI-only custom-Power importer.
> Direct GitHub Power import uses the checked-in MCP-only closure
> and remains blocked until an immutable signed release has reproducible-build,
> SBOM, artifact-attestation, and clean-machine Kiro qualification evidence.
> Power ACP agents have a separate certification gate and remain unavailable.

## Start here

Choose one integration:

| You want | Install | Recommended for |
|---|---|---|
| Fabric beside Kiro's existing read, edit, shell, web, and subagent tools | [Kiro Power](#install-the-kiro-power-recommended) | Most Kiro IDE and CLI v3 users |
| One managed Kiro CLI profile with a narrow audited tool boundary | [Strict mode](#install-strict-mode-advanced) | Advanced and controlled environments |

Start with the **Kiro Power** if you are unsure.

- [Install the Kiro Power](#install-the-kiro-power-recommended)
- [Verify the installation](#verify-the-power-installation)
- [Use Kiro Fabric](#use-kiro-fabric)
- [Copy-paste examples](#copy-paste-examples)
- [Update or remove the Power](#update-or-remove-the-power)
- [Install Strict mode](#install-strict-mode-advanced)
- [Troubleshooting](#troubleshooting)

## What Kiro Fabric adds

Use Kiro's native tools for a single read, edit, shell command, web lookup, code
search, or native subagent. Use Fabric when the result depends on a coordinated
workflow.

| Task | Best choice |
|---|---|
| Read or edit one file | Native Kiro |
| Run one command or test | Native Kiro |
| Search code or the web once | Native Kiro |
| Apply a loop or branch to structured inputs | Fabric |
| Query independent configured services in parallel | Fabric |
| Save and retrieve a project decision | Fabric memory |
| Record a verified workspace transition | Fabric state |
| Combine several configured MCP tools into one result | Fabric |

The Power exposes three Kiro-facing MCP tools:

| Tool | What it does |
|---|---|
| `fabric_info` | Reports the runtime, workspace binding, capabilities, ACP status, and durability status. |
| `fabric_workspace` | Lists, selects, or manually attaches a validated workspace root. |
| `fabric_exec` | Type-checks and runs one TypeScript workflow. |

Inside `fabric_exec`, the program can use mounted Fabric providers such as
`memory`, `state`, `mcp`, and `artifacts`. Availability depends on the current
workspace and configuration. The program cannot call back into Kiro's outer
native tools. Keep ordinary file, shell, web, and native-subagent work in Kiro.

## Install the Kiro Power (recommended)

Use this path for the normal Kiro IDE Power and Kiro CLI v3. If you want the
separate managed CLI profile instead, skip to [Strict mode](#install-strict-mode-advanced).

| Your situation | Follow these instructions |
|---|---|
| Kiro Fabric has never been installed | [Fresh installation](#fresh-installation) |
| You already cloned and imported it | [Update an existing Power](#update-an-existing-power) |
| Dependencies or generated files appear stale | [Clean rebuild](#clean-rebuild-an-existing-checkout) |

### Requirements

Install these first:

- [Kiro IDE](https://kiro.dev/) (required for the one-time local custom-Power import)
- `kiro-cli 2.20.1` when using the installed Power from Kiro CLI v3
- [Node.js](https://nodejs.org/) 24 or newer
- Git
- pnpm 11.20.0

Go is not a Kiro Fabric runtime dependency. Contributors running the native,
non-billable Kiro installer/security fixtures also need Go 1.22 or newer; CI
pins Go 1.25.1 exactly. A missing Go toolchain fails those required tests,
names their owners, and never silently skips them.

Check all locally installed command-line requirements:

```bash
node --version
git --version
pnpm --version
kiro-cli --version  # needed only for Kiro CLI v3
```

If `pnpm` is missing, install the exact version used by this repository:

```bash
npm install --global pnpm@11.20.0
```

### Fresh installation

Choose a parent directory, clone the trusted GitHub repository, install exactly
the locked dependencies, and build the local Power:

```bash
git clone https://github.com/asx8678/kiro-fabric.git
cd kiro-fabric
pnpm install --frozen-lockfile
pnpm run power:dev
```

`--frozen-lockfile` prevents installation from silently changing the reviewed
dependency lockfile. `power:dev` builds the compiled runtime, stages a checkout
copy, and installs a user-global Power:

```text
<repository>/.tmp/kiro-fabric-power/
$KIRO_HOME/powers/kiro-fabric
```

`$KIRO_HOME` defaults to `~/.kiro`. The command prints both absolute paths.
Import the user-global folder into Kiro IDE; do **not** import the repository
root, `src/`, or `dist/`. Later `power:dev` runs replace that user-global copy
in place.

### Import the generated folder in Kiro IDE

1. Open Kiro IDE.
2. Open the **Powers** panel with the Ghosty lightning icon.
3. Select **Add Custom Power**.
4. Select **Import power from a folder**.
5. Choose the `$KIRO_HOME/powers/kiro-fabric` path printed by
   `pnpm run power:dev` (default `~/.kiro/powers/kiro-fabric`).
6. Select **Install** and enable Kiro Fabric for the intended workspace.
7. Restart or reload the workspace if the Fabric tools do not appear immediately.

No global `kiro-fabric` npm installation is required. The project is currently
installed from local source; do not use an unpublished global npm package as a
substitute.

### Use the installed Power from Kiro CLI v3

Kiro CLI v3 automatically discovers Powers installed through Kiro IDE. From the
project you want Fabric to work on, run:

```bash
node dist/kiro/setup-entry.js launch-power --project-root /absolute/path/to/project
```

That command is guaranteed in the source checkout after `pnpm run power:dev`.
Use the shorter `kiro-fabric-setup ...` form only after installing a published
package that provides the binary.

You may also run `kiro-cli --v3` directly after the IDE installation. Do not add
`--agent kiro-fabric` when you want the Power: that selects the separate Strict
mode profile, whose narrow tool boundary intentionally disables ambient Powers.

Kiro currently has no separate CLI-only importer for a local custom Power, so
the one-time Kiro IDE import is required before CLI v3 can discover it.

## Verify the Power installation

Open a project in Kiro IDE or launch a Kiro CLI v3 session and paste this prompt into chat:

```text
Use the Kiro Fabric Power. Run fabric_info and explain the integration,
workspace status, mounted capabilities, durability, and ACP status.
```

A healthy response should show:

- `integration: "power"`
- the checked QuickJS runtime as available
- a bound workspace, or a clear unbound/multiple-root status
- `kiroAcp.status: "unavailable"` for this release

The unavailable ACP status is expected. Use Kiro's native subagents outside
Fabric.

If the workspace is unbound, paste:

```text
Use Kiro Fabric. Run fabric_workspace to list the available roots. If exactly
one safe root exists, select it. If several roots exist, show them and wait for
me to choose one.
```

A manual path attachment asks for one-time approval. Missing, unsafe, changed,
declined, or ambiguous roots fail closed.

Run the local non-billable diagnostic from the repository when setup fails:

```bash
node dist/kiro/cli-entry.js doctor power --json
```

## Use Kiro Fabric

You normally describe the outcome in chat. Kiro writes the TypeScript body and
calls `fabric_exec` for you.

A useful prompt has three parts:

1. Say **Use Kiro Fabric**.
2. Describe the inputs and desired result.
3. State limits such as parallelism, failure handling, or output shape.

Example pattern:

```text
Use Kiro Fabric for one checked workflow. Process INPUTS with RULES. Keep each
failure as data, cap parallel work at LIMIT, and return RESULT_SHAPE.
```

Fabric type-checks the program before execution. A type error means the program
did not run. Read, write, network, and execute effects follow the configured
approval policy. Large results include an opaque artifact ID that Kiro can read
in bounded chunks.

## Copy-paste examples

### 1. Discover the available capabilities

```text
Use Kiro Fabric. Run fabric_info, then use fabric_exec to call
tools.providers(). Return a short table with each available provider, its
purpose, and whether it needs a bound workspace. Do not guess unavailable
capabilities.
```

Use this first when you do not know which providers are mounted.

### 2. Run a deterministic scoring workflow

```text
Use Kiro Fabric for one checked TypeScript workflow. Score these release
candidates with score = passedTests * 2 - failedTests * 5 - openBlockers * 10:

- alpha: passedTests 94, failedTests 3, openBlockers 1
- beta: passedTests 91, failedTests 0, openBlockers 2
- gamma: passedTests 88, failedTests 1, openBlockers 0

Use a loop, sort highest score first, and return JSON containing the score,
rank, and winning candidate. Use no external tools.
```

This example exercises checked computation, loops, and deterministic result
assembly without any side effects.

### 3. Save a project decision in memory

Run this after the workspace is bound:

```text
Use Kiro Fabric. In one fabric_exec call, save this project memory with
memory.set under key "architecture/package-manager":
{"choice":"pnpm","version":"11.20.0","reason":"repository packageManager pin"}.
Then read the same key with memory.get and return the confirmed stored value.
```

A write approval may appear. Memory is isolated by project.

### 4. Record and inspect workspace state

```text
Use Kiro Fabric. Record a state.transition with label "release checks passed",
to "ready-for-review", and summary "typecheck, tests, and build passed". Then
call state.get and return the new head plus recent labels. Ask for approval for
the state write.
```

`state` is mounted only after Fabric has a validated workspace binding.

### 5. Fan out across configured MCP services

This example requires external MCP servers in the Fabric configuration:

```text
Use Kiro Fabric. Discover configured MCP servers and their tool contracts first.
If at least two read-only lookup tools are available, call independent lookups
in parallel with Promise.all. Preserve each success or failure as data and
return one compact comparison table. Do not invent server names, tool names, or
argument shapes. Ask for approval before network calls.
```

Fabric can compose configured MCP services. It does not provide external
services by itself.

### 6. Continue an oversized result

```text
The previous Fabric result returned an artifacts.read ID. Use Kiro Fabric to
read that artifact in bounded chunks until done, then summarize the complete
result. Keep the artifact ID private to this session.
```

Overflow artifacts are process-local and expire with the Power process.

## Workspace access and approvals

- The Power validates workspace roots supplied by the MCP client.
- One safe root can bind automatically. Several roots require an explicit
  selection.
- Manual attachment is canonicalized and requires one-time approval.
- Fabric memory and state are unavailable until binding and then use storage
  keyed by the canonical path plus filesystem identity.
- Approval messages redact common credential and token fields.
- Power `fabric_exec` programs do not receive Kiro's native `k.*` filesystem or
  shell tools.
- The current Power release does not mount `agents.*`. Use Kiro native
  subagents.
- Power v1 supports synchronous session-bounded work. Detached work and
  cross-deactivation completion guarantees are unavailable.

Read [Power security and lifecycle details](docs/kiro/power.md#data-and-security)
before enabling trusted external MCP services.

## Update or remove the Power

### Update an existing Power

An update has two parts: update and rebuild the source checkout, then replace the
Power imported into Kiro. From the existing `kiro-fabric` repository:

```bash
# Confirm that you are in the expected checkout and review local changes first.
git status --short
git remote -v

# Commit or stash any intentional local changes before pulling.
git switch main
git pull --ff-only origin main

# Reproduce the dependency tree and regenerate the local Power.
pnpm install --frozen-lockfile
pnpm run power:dev
```

Then replace the installed Power:

1. Open Kiro IDE's **Powers** panel.
2. Disable or remove the previous Kiro Fabric custom Power.
3. Select **Add Custom Power** → **Import power from a folder**.
4. Select `$KIRO_HOME/powers/kiro-fabric` (default `~/.kiro/powers/kiro-fabric`).
5. Install and enable it for the workspace, then reload the workspace.
6. Run the verification prompt in [Verify the Power installation](#verify-the-power-installation).

Do not select the repository root. `pnpm run power:dev` already refreshed the
user-global folder; import that path, not an older copy from `.tmp/` or another
checkout.

### Clean rebuild an existing checkout

Use this when normal updating succeeds but Kiro still loads stale output, or
when dependencies/generated files may be damaged. First update the checkout as
shown above. Then remove only reproducible local artifacts and rebuild them:

```bash
node -e "for (const p of ['node_modules','dist','.tmp/kiro-fabric-power']) require('node:fs').rmSync(p,{recursive:true,force:true})"
pnpm install --frozen-lockfile
pnpm run power:dev
```

This intentionally preserves source files and unrelated untracked work. Avoid
`git clean -xdf` unless you understand that it permanently deletes **all**
untracked and ignored files. After the clean rebuild, remove/re-import the Power
in Kiro using the update steps above.

### Check the source before importing

For the strongest local verification, run the complete repository gate:

```bash
pnpm run check
```

It runs typechecking, a fresh build, all tests, dead-code lint, Power validation,
and Power certification. For a quicker Power-specific diagnostic after a build:

```bash
node dist/kiro/cli-entry.js doctor power --json
```

### Remove the Power

1. Open Kiro's **Powers** panel.
2. Disable and remove Kiro Fabric.
3. Restart or reload the workspace if Kiro still shows the old MCP server.
4. Optionally delete the local source checkout after preserving any changes you
   want to keep.

Mutable Power data remains under Kiro-owned `PLUGIN_DATA` according to Kiro's
uninstall behavior. Removing a local checkout does not guarantee deletion of
that Kiro-managed data.

## Install Strict mode (advanced)

Strict mode installs a managed Kiro CLI v3 profile. The profile replaces the
outer tool set with exactly `@fabric/fabric_exec`. Its installed binaries run
from `.fabric/runtime/<digest>/`, while repository access follows the canonical
folder where `kiro-cli` starts.

Use this mode only when you want a narrow managed boundary. The source installer
supports Linux and macOS and requires Node.js 24+ plus Kiro CLI 2.20.1/v3.

### Source installation

```bash
git clone https://github.com/asx8678/kiro-fabric.git
cd kiro-fabric

FABRIC_REPO="$(pwd -P)"
PROJECT="/absolute/path/to/your/project"

# Inspect the proposed user-scoped installation without writing managed files.
sh "$FABRIC_REPO/scripts/install-kiro-fabric.sh" install \
  --project-root "$PROJECT" --dry-run --yes

# Install the profile under $KIRO_HOME or ~/.kiro.
sh "$FABRIC_REPO/scripts/install-kiro-fabric.sh" install \
  --project-root "$PROJECT" --yes

# Verify the installed profile.
sh "$FABRIC_REPO/scripts/install-kiro-fabric.sh" doctor \
  --project-root "$PROJECT"

# Start Kiro in the project with the managed profile.
cd "$PROJECT"
kiro-cli --v3 --agent kiro-fabric
```

The source script adds user scope automatically. New installs leave shell,
subagents, and automatic tool approval disabled. Add trusted grants only after
reading the [Strict installer guide](docs/kiro/installer.md).

Common lifecycle commands from the source checkout:

```bash
# Rebuild from pulled source and update while preserving existing grants.
KIRO_FABRIC_REBUILD=1 sh "$FABRIC_REPO/scripts/install-kiro-fabric.sh" update \
  --project-root "$PROJECT" --yes

# Repair managed files from the current trusted source artifact.
sh "$FABRIC_REPO/scripts/install-kiro-fabric.sh" repair \
  --project-root "$PROJECT" --yes

# Remove the user-scoped managed profile.
sh "$FABRIC_REPO/scripts/install-kiro-fabric.sh" uninstall \
  --project-root "$PROJECT" --yes
```

After exact `kiro-fabric@0.63.0` is published and certified, the npm route will
be:

```bash
npm install --global kiro-fabric@0.63.0
kiro-fabric doctor kiro
kiro-fabric install kiro --user --project-root "$(pwd -P)"
kiro-cli --v3 --agent kiro-fabric
```

Do not use the npm route until that exact package exists in the registry. See
[the full Strict installer guide](docs/kiro/installer.md) for project scope,
custom Kiro homes, trusted grants, backup behavior, and recovery commands.

## Troubleshooting

| Problem | What to do |
|---|---|
| `node --version` is below 24 | Install Node.js 24+ and reopen the terminal. |
| `pnpm` is missing | Run `npm install --global pnpm@11.20.0`. |
| Kiro rejects the imported folder | Run `pnpm run power:dev` again and select `~/.kiro/powers/kiro-fabric` (or `$KIRO_HOME/powers/kiro-fabric`), not the repository root. |
| The Power does not appear | Confirm it is installed and enabled in the current Kiro workspace, then restart the workspace. |
| `fabric_info` reports an unbound workspace | Ask `fabric_workspace` to list roots and select the intended canonical root. |
| Several roots are listed | Choose one root explicitly. Fabric fails closed on ambiguity. |
| A manual attach is denied | Confirm the client supports form elicitation and approve the canonical path. |
| `agents.*` is unavailable | Use Kiro's native subagents outside Fabric. |
| An output is truncated | Ask Kiro to follow the returned `artifacts.read` ID in chunks. |
| A local health check fails | Run `node dist/kiro/cli-entry.js doctor power --json`. |

## Security summary

- Package assets are immutable during execution.
- Mutable Power data lives under Kiro-owned `PLUGIN_DATA`.
- External MCP, Node process, and Strict shell actions use host privileges. They
  are trusted execution paths, not sandboxes.
- Completed effects are not rolled back when a later workflow step fails.
- Stored memory can survive a session, with no Power v1 durability guarantee
  across deactivation, restart, update, uninstall, or crash.
- `fabric_info` omits raw plugin-data paths, credentials, ACP payloads, and
  private session IDs.

See [Power security details](docs/kiro/power.md#data-and-security) and the
[security replay model](docs/security-replay.md).

## Development

```bash
pnpm run power:validate   # validate manifests, versions, skills, and package boundary
pnpm run certify:power    # build the local package and run the Power MCP certification
pnpm run check            # typecheck, build, all tests, dead-code lint, and Power validation
```

Important paths:

- `src/kiro/mcp-server.ts`: Kiro MCP surface
- `src/kiro/runtime.ts`: provider assembly
- `skills/`: additive Power skills and progressive references
- `strict/skills/fabric-exec/`: the managed-profile skill and progressive references
- `.kiro/steering/`: contributor architecture and authoring constraints
- `docs/kiro/power.md`: complete Power behavior and limits
- `docs/kiro/installer.md`: complete Strict installation and lifecycle guide

Documentation: [Power guide](docs/kiro/power.md) · [Release governance](docs/kiro/release-governance.md) · [Strict installer](docs/kiro/installer.md) · [Kiro records](docs/kiro/README.md) · [Security](docs/security-replay.md)

MIT licensed. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
