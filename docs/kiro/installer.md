# Kiro installer, doctor, and uninstall

Experimental managed integration for **Kiro CLI 2.20.1** / agent engine **v3**.
Project-scoped install does not walk up to a Git root. Pass `--user` to write
the agent profile into the user Kiro home (`$KIRO_HOME` or `~/.kiro`, which is
`$HOME/.kiro` by default) so interactive `kiro-cli` can see it.

## Install the managed profile

```bash
npm install --global kiro-fabric
node --version
kiro-cli --version
kiro-fabric doctor kiro

# Choose project scope:
kiro-fabric install kiro --project-root /canonical/project

# Or choose user scope:
kiro-fabric install kiro --user --project-root /canonical/project

cd /path/to/the/project-you-want-to-work-on
kiro-cli --v3 --agent kiro-fabric
```

Node must be version 24 or newer, and Kiro CLI must be exactly 2.20.1. Project
and user scope are alternatives. A local npm dependency requires
`npm exec -- kiro-fabric ...`; a source checkout requires `pnpm run build` and
`node dist/kiro/cli-entry.js ...`. Avoid transient package-runner installs,
because the generated profile stores an absolute path to the MCP entry.

Dry-run validates the generated profile without writing `.kiro`:

```bash
kiro-fabric install kiro --project-root /canonical/project --dry-run --json
```

A project install writes only:

- `<project>/.kiro/agents/kiro-fabric.json`
- `<project>/.kiro/.kiro-fabric/install.json`
- the packaged `fabric-exec`, `fabric-guide`, `fabric-review`, and
  `fabric-workflow` skills under `<project>/.kiro/skills/`
- an immutable, digest-addressed runtime under
  `<project>/.kiro/.kiro-fabric/runtime/<digest>/`
- content-addressed backups under `<project>/.kiro/.kiro-fabric/backups/`
- a short-lived `<project>/.kiro/.kiro-fabric/operation.lock` during mutation

`--user` instead writes the same managed files under the Kiro home
(`$KIRO_HOME` or `~/.kiro`):

- `<kiro-home>/agents/kiro-fabric.json`
- `<kiro-home>/.kiro-fabric/install.json`
- the same four managed skills under `<kiro-home>/skills/`
- the attested runtime, backups, and operation lock under
  `<kiro-home>/.kiro-fabric/`

For managed interactive sessions, Fabric confines filesystem tools to the
canonical directory where `kiro-cli chat` was launched. This lets one global
profile under `~/.kiro` work across projects without granting access outside the
active launch directory. `--project-root` remains the installation identity and
fallback when the launch directory no longer exists; Kiro home is never treated
as the project.

Managed Main leaves `agents.*` disabled by default. A trusted local install can
enable bounded fan-out only together with shell verification:

```bash
kiro-fabric install kiro --user --project-root /canonical/project \
  --allow-shell --subagents --allow-tools
```

This mounts session-local Kiro ACP children, caps concurrency and per-execution
fan-out at four, disables recursive children, and propagates `k.bash` into each
scoped child profile. The profile tells Main to delegate narrow, non-overlapping
tasks in one `fabric_exec`, require focused test/build evidence, and deduplicate
the results. Omitted child models prefer `claude-haiku-4.5` for small work,
`qwen3-coder-next` for coding/testing, and `claude-opus-4.8` with medium
reasoning effort for complex or ambiguous work when those IDs are advertised.
If the installed inventory exposes only `auto`, Fabric omits both model and
effort so Kiro selects a supported route instead of launching an invalid ID.

Delegation specifics: cheap available `model` routes use `claude-haiku-4.5` at
low effort, coding/testing to `qwen3-coder-next` at low effort, and complex or
ambiguous work to `claude-opus-4.8` at medium effort (cheap routes no longer
inherit the Fabric-wide medium default). Passing `model: "auto"` lets Kiro
choose both model and effort without Fabric forcing a default. The managed
provider returns non-billable model discovery through
`agents.models({ runner: "kiro" })`, which calls `kiro-cli chat --v3
--list-models --format json` once per binary and caches it. The legacy text
parser remains only as a defensive fallback.
One-shot `agents.run` children do not take a resident steer channel, so a
completed delegation settles immediately instead of waiting out the 5s idle
tail; detached `agents.spawn` children keep steering and follow-up.

One Kiro behavior worth noting:

- **Opaque output artifacts.** When a `fabric_exec` result exceeds the
  model-facing cap, the full output stays in a bounded, process-local memory
  store and the result returns an opaque `ka_…` identifier. Read bounded chunks
  with `k.readArtifact({ id, offset, limit })`. No artifact path is created in
  the repository or OS temp directory, and process termination releases every
  payload automatically.

The managed MCP adapter does not persist prewalk evidence into the target
project. The unused persistence helper was removed; without a continuation
consumer and integrated shell-drift capture, trajectory prewalk remains
unavailable.

It never passes `--trust-all-tools`. The profile advertises exactly
`@fabric/fabric_exec`, sets both `includeMcpJson: false` and
`includePowers: false`, and always emits one exact v3 `permissions` rule for
`fabric/fabric_exec`. Its effect is `ask` by default, so broader ambient allows
cannot bypass Fabric's approval gate. The trusted-local `--allow-tools` opt-in
changes only that exact rule's effect to `allow`.
Any managed-main profile carrying `--allow-shell`, `--subagents`, or
`--allow-tools` is confined to its recorded canonical project root: selecting a
user-level profile from another repository fails before the Fabric MCP runtime
starts. The grant is also bound to the root directory's filesystem identity,
so replacing or symlink-retargeting that path requires reinstalling the
profile. Launching from a subdirectory of the unchanged project remains
supported.

Unknown or user-modified profile or same-name managed-skill content is refused
unless you pass `--force`, which backs up each existing regular file first.
Unrelated sibling skills are never claimed. The format-2 manifest records every
managed skill hash and the exact final runtime file set. Digest directories are
immutable: a hash mismatch or extra file is refused instead of recursively
replaced. Symlinks in managed paths, leaves, or the runtime activation marker are
always refused.

## Kiro-only core tool namespace

Programs executed by the managed Kiro profile use `k.read`, `k.grep`, `k.find`,
`k.ls`, `k.write`, `k.edit`, and (when enabled) `k.bash`. The shorter `k.*`
namespace exists only in Kiro Fabric. The original Pi extension continues to use
`pi.*` unchanged; `pi.*` is intentionally not declared inside the Kiro guest.

## Trusted-local shell opt-in

Managed Fabric does not delegate nested approval decisions through MCP, so
execute-risk actions such as `k.bash` remain fail-closed when the Fabric
execute policy is `ask` or `auto`. On a machine and project you fully trust,
install the managed profile
with the explicit shell opt-in:

```bash
kiro-fabric install kiro --user --project-root /canonical/project --allow-shell
```

This writes `KIRO_FABRIC_ALLOW_SHELL=1` only into the managed Fabric MCP
server environment, changes the Kiro runtime's `execute` risk to `allow`, and
extends the trusted-shell execution window to 15 minutes so full tests are not
cut off by the former two-minute boundary. The generated profile also records
the canonical project root and refuses to start this trusted grant from a cwd
outside that project. It does **not** add another
model-visible tool, pass `--trust-all-tools`, or sandbox shell commands:
approved commands run with the local user's ambient OS permissions. Omit
`--allow-shell` (and reinstall without it) to restore the configured Fabric
execute policy; `ask` and `auto` still fail closed because the managed adapter
has no nested approval bridge. Subagents still require the installed
`--subagents` flag.

## Efficient v3 workflow

- Use default mode for direct review and implementation. Use `--mode spec` when
  requirements, design, and tasks should be developed as a Kiro spec.
- Prefer Kiro `auto` for most work; it selects model and effort together. Pin a
  model or `low`/`medium`/`high`/`xhigh`/`max` effort only when the task warrants
  the cost and the model is present in the discovered v3 inventory.
- Keep related repository operations in one checked `fabric_exec` call. Read
  narrow ranges, use `Promise.all` only for independent operations, and return
  a compact result rather than raw intermediate output.
- Use tangent mode for side investigations. Enable Fabric `--subagents` only
  for narrow independent tasks; Fabric keeps children non-recursive and capped
  at four.
- The managed profile intentionally disables native Powers, builtin file/shell
  tools, and native subagent tags. Fabric remains the one audited capability
  boundary; Kiro v3 supplies the harness, modes, compaction, and model routing.

Kiro v3 sessions are not compatible with v2 sessions. Durable Fabric children
record v3 engine provenance and retain an engine-specific `kiro-runtime-v3`
profile marker; a saved session without both is rejected rather than loaded
under the wrong engine. Kiro 2.20.1/KAS 0.54.3 was observed storing the actual
transcript under the authenticated OS home's `.kiro` session store even with a
`KIRO_HOME` override, so deleting that transcript makes resume fail closed.
Recreate a durable Kiro actor that only has v2 session state.

## Uninstall

```bash
kiro-fabric uninstall kiro --project-root /canonical/project
kiro-fabric uninstall kiro --project-root /canonical/project --dry-run --json

# User scope:
kiro-fabric uninstall kiro --user --dry-run --json
kiro-fabric uninstall kiro --user
```

If installation used `--kiro-home`, pass the same `--user --kiro-home` values
to uninstall. Uninstall the managed profile before removing or relocating the
npm package, Node executable, or source checkout referenced by the profile.

Uninstall is hash-owned:

- No manifest → no-op. An independently created `kiro-fabric.json` is left alone.
- Managed profile matching the recorded hash and no user backup → remove the profile.
- Managed profile or skill with a verified displaced-user backup → restore those exact bytes.
- Newly created managed skills → remove only their recorded, hash-matching leaves.
- Runtime closure → remove only the exact attested file set; preserve unrelated siblings.
- User-modified managed content → refuse before mutation. There is no uninstall `--force`.

Uninstall never runs `kiro-cli` and never requests a model turn. A second
uninstall is an idempotent no-op. Unrelated sibling profiles and orphaned
backups are left in place. Only empty Fabric-owned directories are removed.

## Doctor

Read-only, non-billable health checks. Doctor uses an isolated temporary
workspace and never writes `.kiro` into the current project. It sends ACP
`initialize`, `session/new`, `session/set_mode`, and the supervised session
configuration, then starts a second ACP process, reloads the same empty session,
and deletes that probe session — never `session/prompt`.

```bash
kiro-fabric doctor kiro --project-root /canonical/project
kiro-fabric doctor kiro --user --project-root /canonical/project --json
```

When invoked through the CLI, doctor first verifies the installed manifest,
profile hash, every managed skill hash and aggregate digest, the exact runtime
file set, and the no-follow activation marker. Format-1 manifests are reported
as legacy and do not claim skill or closure attestation. Checks also cover the
Node/Kiro tuple, generated profile shape, `kiro-cli agent
validate` plus a negative control (exit 0 is not trusted), the built MCP
adapter's `initialize`/`tools/list`, and ACP startup with process-group
shutdown plus cross-process v3 `session/load`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | create / update / adopt / repair / remove / restore / noop / successful dry-run |
| 1 | validation, ownership, backup, symlink, concurrency, or filesystem failure |
| 2 | usage error |

## Constraints

- Supported tuple is pinned: Node `>=24`, `kiro-cli 2.20.1`, `--agent-engine v3`,
  ACP `--auth-method cli`.
- Approval-requiring Fabric actions fail closed when they need the unavailable
  nested MCP approval bridge.
- MCP cancellation is forwarded into Fabric execution; the 15.5-minute MCP
  deadline remains a hard fallback. Doctor-owned children are reaped as a
  process group.
- Same-format package upgrades and downgrades are allowed. An unknown newer
  manifest format is refused without mutation.

See the [current v3 capability record](capabilities-2.20.1-v3.md) for the
supported contract and remaining authenticated gates. The Release-A document
preserves the prior v2 certification history.

## Setup installer (Linux and macOS)

Install the published package globally and run the setup console directly:

```bash
npm install --global kiro-fabric
kiro-fabric-setup
```

From a repository checkout, build the compiled entry before starting the same
console through the Linux/macOS POSIX bootstrap:

```bash
pnpm install
pnpm run build
sh scripts/install-kiro-fabric.sh

# Explicit commands for non-interactive use:
sh scripts/install-kiro-fabric.sh status
sh scripts/install-kiro-fabric.sh doctor
sh scripts/install-kiro-fabric.sh install --user \
  --project-root /absolute/path/to/project --dry-run
sh scripts/install-kiro-fabric.sh install --user \
  --project-root /absolute/path/to/project
```

The bootstrap locates `node`, requires major version 24 or newer, and prints
distribution-specific install guidance (nodejs.org, `apt`, `dnf`, `brew`, `nvm`)
when Node is missing or old; a missing or old Node exits 1. The bootstrap itself
performs no network fetch or `.kiro` mutation. It `exec`s
`node <repo>/dist/kiro/setup-entry.js` with all arguments; the selected setup
command may then update managed Kiro files.

The setup console supports the subcommands `status`, `install`, `update`,
`uninstall`, `doctor`, and `launch`, with the flags `--user`,
`--project-root <dir>`, `--kiro-home <dir>`, `--kiro-binary <path>`,
`--dry-run`, `--yes`, `--force`, `--json`, and `-h/--help`. A bare invocation
shows a numbered menu only when stdin and stdout are terminals; a non-interactive
run prints usage. Omitting `--user` selects project-local scope rooted at the
current directory; `--user` selects `$KIRO_HOME` or `~/.kiro`. `update` requires
an existing manifest, and the advanced grants `--allow-shell`, `--subagents`, and
`--allow-tools` default to off. `launch` starts `kiro-cli --v3 --agent
kiro-fabric` through a direct argv exec in the selected project root. Every
mutation delegates to the verified install, uninstall, and doctor APIs; the
console adds no ownership, backup, or symlink logic of its own. Exit codes:
`0` success, no-op, or dry-run; `1` failure; `2` usage; `130` interactive
cancel. `--json` prints one JSON object on stdout, and human-readable errors
go to stderr.
