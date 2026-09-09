# Installer and installed management

## Current status

The complete-generation installer is implemented for local source development. Published bootstrap generation, signed-release verification and bounded archive parsing have fixture coverage, but **public distribution is blocked**: the production Ed25519 trust root is intentionally absent. Never substitute unsigned downloads or main. Native macOS/ARM and authenticated Kiro qualification remain pending. Linux x64 private-tool/backend smoke has been executed; this is not release certification.

## Installation

### Native crash-recovery limitation

Successful stale-lock reclamation requires inode-anchored directory-FD traversal (Linux `/proc/self/fd`). macOS `/dev/fd` does not currently provide that capability here: after installer SIGKILL, recovery returns `INSTALL_LOCK_UNSUPPORTED` and preserves the lock/journal rather than using an unsafe pathname fallback. Normal installation and in-process cleanup remain supported. Do not delete recovery evidence blindly. Native success tests run only when a disposable capability probe succeeds; unsupported hosts instead verify preservation, not successful recovery. A green macOS check does not certify crash recovery.

### Linux and macOS source prerequisites

See [Linux validation](linux-validation.md) for kernel suffix support, bounded cleanup/search/startup contracts and reproducible native checks. Contract coverage is not release qualification.

| System | Architectures | Minimum system |
| --- | --- | --- |
| Linux | x64, ARM64 | glibc 2.28, kernel 4.18; musl/Alpine is not supported |
| macOS | Intel x64, Apple Silicon ARM64 | macOS 13.5 |

Use Bash (the macOS system Bash is sufficient), Git, Node >=24, pnpm **11.20.0**, tar/gzip, and a trusted Kiro CLI >=2.21.1 with v3 support on PATH. Development also requires ripgrep. Authenticate Kiro separately if needed with `kiro-cli login`; do not run the installer with sudo. The source installer and generated release bootstrap select native ARM64 on Apple Silicon even when launched under Rosetta. Native macOS/ARM execution qualification is still pending.

The trusted checkout may be **exactly the selected Kiro home** or outside it. Nested overlaps such as `~/.kiro/kiro-fabric` remain rejected. Release packages and coding workspaces do not gain an overlap exception.

### Pull-to-update checkout at `~/.kiro`

For a new, absent home only (do not clone over existing Kiro data):

```sh
git clone https://github.com/asx8678/kiro-fabric.git "$HOME/.kiro"
cd "$HOME/.kiro"
bash ./install.sh --source --kiro-home "$HOME/.kiro" --enable-pull-hook
# Subsequent source updates:
git pull --ff-only origin main
```

`--enable-pull-hook` explicitly opts into executing the trusted checkout's installer after a Git merge/fast-forward. It installs an owned `.git/hooks/post-merge` only after successful activation. Existing hooks, custom `core.hooksPath`, symlinks and linked worktrees are refused rather than overwritten. This authorizes dependency installation/build and runtime activation on subsequent pulls. Git does not run this hook for an already-up-to-date pull, checkout, or rebase. On hook failure Git may still report a successful pull: look for `UPDATE NOT ACTIVATED`, then run `bash ./install.sh --source --kiro-home "$HOME/.kiro"` manually. Existing sessions retain their generation; restart for new code. To disable automation, remove only the verified Fabric `post-merge` hook; no global Git configuration is changed.

If `.kiro` already contains data, stop Kiro and back it up before arranging the checkout. The installer does not migrate or overwrite that directory with a clone. Preserve settings, authentication, sessions and foreign profiles; reconcile source filename collisions manually. Never use `git clean -fdx` in a live Kiro home. `.gitignore` excludes known private/runtime paths but cannot anticipate every third-party credential filename; inspect staged files and never `git add -f` private data. Git-tracked source resources such as `skills/fabric-exec` remain source-owned.

Without hook opt-in, updates require `git pull --ff-only` followed by the explicit source install command. Source acquisition inside the home stages its incoming bundle in a private temporary directory outside the home before managed activation, preserving the incoming-bundle isolation rule.

From an external checkout containing `install.sh`, the same command works on Linux and macOS:

```sh
cd /path/to/kiro-fabric
bash ./install.sh --source --kiro-home "$HOME/.kiro"
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" doctor
cd /path/to/your/project
kiro-cli --v3 --agent kiro-fabric
```

The source command already performs frozen dependency installation and a build. A fresh clone only contains committed/published files: `No such file or directory` for `install.sh` means the checkout is missing the installer, not that macOS needs a different command. Obtain a revision containing the installer and its companion scripts; copying only `install.sh` is insufficient. These local changes do not reach another computer until explicitly transferred or committed and pushed.

From the existing trusted checkout:

```sh
bash ./install.sh --source
# automation, using a disposable or explicitly intended home:
bash ./install.sh --source --kiro-home /absolute/kiro-home --yes --non-interactive --json
```

Source mode requires developer Node >=24 and pnpm 11.20.0, installs frozen dependencies and builds the current checkout including local changes. It never clones/resets. Local-source provenance records Git HEAD, dirty state and a source-input digest. Default `bash ./install.sh` fails clearly until a genuine release-pinned bootstrap is generated.

The selected global home is explicit --kiro-home, supplied KIRO_HOME, then the current user's home/.kiro. Empty/relative/control-bearing and unsafe destinations fail. Invocation cwd is not coding-workspace authority. No shell/default-agent/settings/authentication changes occur.

### Optional: use `kiro-cli --v3` directly from zsh

The installed `kiro-fabric start` command already supplies the workspace handoff.
If you prefer typing `kiro-cli --v3`, add this function once to `~/.zshrc`
(preserve existing content and reconcile any existing function with this name):

```zsh
kiro-cli() {
  local arg
  for arg in "$@"; do
    if [[ "$arg" == "--v3" ]]; then
      KIRO_FABRIC_LAUNCH_WORKSPACE="$(pwd -P)" command kiro-cli "$@"
      return $?
    fi
  done
  command kiro-cli "$@"
}
```

Run `source ~/.zshrc`, change to your project, and start a **new** session with
`kiro-cli --v3 --agent kiro-fabric`. If Fabric is already your default agent,
`kiro-cli --v3` is sufficient. This does not alter your default agent or the
Kiro executable. Each invocation supplies its own canonical folder; no global
project path is stored. The source installer does not edit shell startup files.

When upgrading an older installation, rerun the source installer rather than
editing `~/.kiro/agents/kiro-fabric.json` manually: profile bytes are managed and
integrity-checked. Restart existing Kiro processes to use the new profile.

## Installed commands

```sh
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" doctor
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" update
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" rollback
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" start
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" uninstall
```

For a custom location use `"$KIRO_HOME/kiro-fabric/bin/kiro-fabric"`. The launcher resolves its own installation, not a changed caller KIRO_HOME. `start` invokes official Kiro with --v3 --agent kiro-fabric, preserving project cwd and explicitly passing its canonical project directory through KIRO_FABRIC_LAUNCH_WORKSPACE. Use this launcher from your project for automatic workspace binding when Kiro supplies no initial roots; no manual attachment is needed. Client roots retain precedence, and reserved home/runtime/data roots are rejected. Bare kiro-cli does not provide this handoff. The generated profile explicitly expands `${KIRO_FABRIC_LAUNCH_WORKSPACE}` into the MCP server environment, because Kiro filters inherited variables. To use the bare CLI with the same explicit authority, run `KIRO_FABRIC_LAUNCH_WORKSPACE="$(pwd -P)" kiro-cli --v3 --agent kiro-fabric` or wrap that invocation in your shell. Do not hard-code a project path into the global profile: concurrent sessions need independent handoffs. Local authenticated Kiro CLI 2.21.1 v3 smoke verified binding on macOS ARM64; full release qualification remains separate. Kiro itself and project-specific Git/Python/Java/Docker/etc. remain external prerequisites. Kiro executables (including a sibling `kiro-cli-chat`) and their directory ancestry must not be group/other-writable; unsafe prerequisites are rejected before execution. The narrow macOS exception is exactly `/Applications`, owned by root:admin (UID 0/GID 80), mode 0775; application descendants and executables remain strict. This explicitly trusts macOS administrators, who can already replace installed applications. The installer does not change their permissions.

Installed management uses its private Node, not system Node/pnpm or the checkout. It always rejects --source; rebuild through the explicit checkout command. install/update accept --version or --from-archive, never both. Offline archives require exact `<archive>.release.json` and `<archive>.release.sig` signed sidecars; first-install bootstrap also requires matching embedded archive/member pins. No local archive bypasses production verification. Public update/discovery currently fails before networking because the production key is missing.

Use --yes --non-interactive for explicit automation and --json for one structured result on stdout. Doctor rejects mutation options and never repairs, locks, logs, initializes durable data, authenticates or contacts downstream MCP. Its Kiro help/version probes have disposable homes. Live model inventory, resources, elicitation, compaction/resume and MCP connectivity are NOT TESTED offline. Terminal output is plain ASCII and does not require color/TUI dependencies.

Exit codes: 0 successful outcome, 2 usage, 3 cancellation, 4 prerequisites, 5 integrity/conflict, 6 busy, 7 recovery required (including committed-cleanup-required), 8 unavailable release discovery. Committed errors explicitly retain committed=true; never blindly retry an uncertain effect.

## Layout and preservation

A generation at `kiro-fabric/runtime/<bundle-digest>/` contains app/, tools/node, tools/rg, manager/install-manager.mjs, resources/steering/fabric.md, resources/skills/fabric-exec/, notices/ and bundle-manifest.json. Every generated profile binds exact matching generation paths. Durable configuration/projects/memory/state/artifacts stay in the existing `kiro-fabric/data/fabric/` structure; namespaces/salts are unchanged. Private directories and executables are 0700; ordinary managed files are 0600.

New sessions adopt the updated profile. Existing sessions keep their exact retained code/tools/resources. There is no automatic generation GC; bounded capacity refuses further updates rather than deleting potentially active files. Rollback validates a retained complete generation and does not rewind user data or release anti-downgrade state.

Uninstall deregisters the verified agent and publishes retired ownership, retaining data, immutable generations and the verified management launcher for doctor, repeat uninstall or explicit reinstall. It does not claim complete disk erasure. Foreign/modified files are preserved and reported as conflicts. `--purge-data` is explicit but currently **refused**: complete process-inactivity visibility is not qualified. No negative process snapshot is treated as proof that deleting live data is safe.

Schema-2 legacy trees are verified; schema-1 limited evidence remains explicitly unverified where appropriate. Migration preserves old runtimes and shared skills at their original paths. Legacy code cannot participate in the new startup fence, so automatic legacy/data deletion is prohibited.

## Trust and recovery

Bundle identity hashes a canonical payload inventory and metadata, excluding self-hash circularity. External signed release metadata binds final archive bytes, platform/compatibility/source identity and bundle digest. Local ownership schema 3 records activation and retained identities; it is not a publisher signature. release-state.json preserves stable-release high-water identities across rollback/source changes/retirement.

The portable generated bootstrap verifies the entire pinned archive and fixed private Node/manager members before executing downloaded code. A shared bounded restricted-USTAR consumer rejects links/special entries/traversal/collisions/unknown modes and oversized or malformed streams before extraction. Private Node 24.20.0 and ripgrep 14.1.1 archives/member hashes and exact license notices are recorded in build-toolchain.json. Linux requires glibc >=2.28/kernel >=4.18; musl is rejected. The declared macOS minimum is 13.5; its execution/quarantine/resource behavior is not yet natively qualified.

Installer transactions use the existing destination/ownership policy, a shared incarnation/inode-bound lock and versioned journals. New-format backend admission takes the same short lock through data initialization. Individual file replacements are atomic, not the entire transaction. Actual owner bytes establish commit; precommit recovery restores only verified controls, while postcommit cleanup never rolls activation backward. Unknown/partial locks, foreign journal identities and unsupported versions preserve evidence and report recovery-required. A subsequent mutation recovers only provably owned interrupted transactions. Do not manually remove an uncertain lock or backup based only on age/PID.

These checks are defense in depth for cooperating processes, not an OS sandbox against hostile same-user access. Approved shell commands retain host authority. Native runner, production signing and exact-artifact authenticated Kiro gates remain separate release requirements.
