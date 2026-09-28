# Installation

## Requirements

- macOS or glibc Linux, x64 or arm64
- Node >=24 and pnpm 11.20.0
- ripgrep (`rg`) on `PATH`
- Kiro CLI >=2.21.1 with v3 support

Navigator's parser (`ast-grep` 0.45.3) comes from a pinned npm platform package installed by `pnpm install`; nothing else is downloaded.

## Install or update

From the checkout, as your normal user (never `sudo`):

```sh
bash ./install.sh
```

The script runs `pnpm install --frozen-lockfile` and `pnpm run build`, then `scripts/install.mjs`, which writes:

| Path (under `$KIRO_HOME`, default `~/.kiro`) | Contents |
| --- | --- |
| `kiro-fabric/app/` | The built agent (`dist/kiro-agent-closure`) |
| `kiro-fabric/tools/ast-grep` | Navigator parser |
| `kiro-fabric/resources/` | The `fabric-exec` skill and steering file |
| `kiro-fabric/bin/kiro-fabric` | Launcher |
| `kiro-fabric/data/` | State, configuration and traces (preserved across installs) |
| `agents/kiro-fabric.json` | Agent profile; a differing previous profile is copied to `kiro-fabric/backups/` |

The profile runs the `node` found on your `PATH` at install time and gives the MCP server a `PATH` containing only the directory of the `rg` it found plus `/usr/bin:/bin`. Re-run the installer after moving or upgrading Node or ripgrep.

Options:

| Option | Effect |
| --- | --- |
| `--kiro-home PATH` | Install into another Kiro home (default `$KIRO_HOME` or `~/.kiro`) |
| `--guidance standard\|review\|minimal` | Prompt variant for the agent profile (default `standard`) |
| `--uninstall` | Remove `app/`, `tools/`, `resources/`, `bin/` and the profile if it points at this installation; `data/` is kept |

Updating replaces `app/`, `tools/` and `resources/` in place. Restart running Kiro Fabric sessions afterwards; a session started on the previous version may fail to load code that was replaced.

## Start

From the project Kiro should work on:

```sh
~/.kiro/kiro-fabric/bin/kiro-fabric
```

The launcher sets `KIRO_HOME` and `KIRO_FABRIC_LAUNCH_WORKSPACE` to the current directory and runs `kiro-cli --v3 --agent kiro-fabric`; extra arguments are passed to Kiro. Running `kiro-cli --v3 --agent kiro-fabric` directly also works, because the profile authorizes Kiro's per-session launch directory.

## Troubleshooting

- **`ripgrep (rg) is required`**: install ripgrep and re-run the installer.
- **`KIRO_FABRIC_RUNTIME_ROOT must be an existing directory ... group/other writable`**: the installed directories must be private to your user; re-run the installer, which creates them with mode `0700`.
- **Navigator reports no parser**: re-run the installer so `tools/ast-grep` and `KIRO_FABRIC_AST_GREP` in the profile are present.

## Upgrading from the previous installer

Earlier versions used digest-named `runtime/` generations, a `manager/`, `install-owner.json` and transaction journals. The new installer ignores them and reuses `data/`. After confirming the new version works and no old session is running, you may remove `kiro-fabric/runtime`, `kiro-fabric/manager`, `kiro-fabric/install-owner.json`, `kiro-fabric/.transactions` and any old shell integration the previous installer added.

The separate `memory` store was merged into `state`, which gained `state.search`. Entries previously written with `memory.set` are not migrated; they remain on disk under `data/fabric/projects/*/memory/` and can be copied into state manually if needed. Existing `memory` and `continuity` configuration sections are ignored.
