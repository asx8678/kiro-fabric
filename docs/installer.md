# Installer and installed management

## Current status

The complete-generation installer is implemented for local source development. Published bootstrap generation, signed-release verification and bounded archive parsing have fixture coverage, but **public distribution is blocked**: the production Ed25519 trust root is intentionally absent. Never substitute unsigned downloads or main. Native macOS/ARM and authenticated Kiro qualification remain pending. Linux x64 private-tool/backend smoke has been executed; this is not release certification.

## Installation

### Native crash recovery

Successful stale-lock reclamation requires inode-pinned access. Linux uses `/proc/self/fd`; macOS uses a short-lived child of the same verified Node with a kernel-pinned working directory. The child validates directory/control identities and hashes, creates an exclusive empty claim, then a separate operation revalidates that claim inode before publication. It never changes the parent's cwd, loads adjacent scripts or follows a lock-record pathname. Its code is embedded in the bundled manager/backend; no additional system tool or addon is needed.

Native macOS ARM64 component tests now exercise real installer SIGKILL, concurrent reclamation, partial-claim preservation and transaction replay. This is not full release/platform certification. Unknown partial claims, changed boot evidence, unavailable helpers and indeterminate ownership still preserve the lock/journal and fail closed. Do not delete recovery evidence blindly.

### Browser integration removed

New generations no longer ship the browser runtime, skill pack or browser operator commands. No browser executable is required. Obsolete browser/web configuration fails with migration instructions; existing user profiles and data are not deleted automatically. See [configuration migration](configuration.md#privacy-compatibility-after-browser-removal).

### Linux and macOS source prerequisites

See [Linux validation](linux-validation.md) for kernel suffix support, bounded cleanup/search/startup contracts and reproducible native checks. Contract coverage is not release qualification.

| System | Architectures | Minimum system |
| --- | --- | --- |
| Linux | x64, ARM64 | glibc 2.34 on x64 (Navigator parser), 2.28 on ARM64; kernel 4.18; musl/Alpine is not supported |
| macOS | Intel x64, Apple Silicon ARM64 | macOS 13.5 |

Use Bash (the macOS system Bash is sufficient), Git, Node >=24, pnpm **11.20.0**, tar/gzip, and a trusted Kiro CLI >=2.21.1 with v3 support on PATH. Development also requires ripgrep. Authenticate Kiro separately if needed with `kiro-cli login`; do not run the installer with sudo. The source installer and generated release bootstrap select native ARM64 on Apple Silicon even when launched under Rosetta. Native macOS/ARM execution qualification is still pending.

The trusted checkout may be **exactly the selected Kiro home** or outside it. Nested overlaps such as `~/.kiro/kiro-fabric` remain rejected. Release packages and coding workspaces do not gain an overlap exception.

### Pull-to-update checkout at `~/.kiro`

For a new, absent home only (do not clone over existing Kiro data):

```sh
git clone https://github.com/asx8678/kiro-fabric.git "$HOME/.kiro"
cd "$HOME/.kiro"
bash ./install.sh --source --kiro-home "$HOME/.kiro" --migrate-pi-fabric --enable-pull-hook
# Subsequent source updates:
git pull --ff-only origin main
```

`--enable-pull-hook` explicitly opts into executing the trusted checkout's installer after a Git merge/fast-forward. It installs an owned `.git/hooks/post-merge` only after successful activation. Existing hooks, custom `core.hooksPath`, symlinks and linked worktrees are refused rather than overwritten. This authorizes dependency installation/build and runtime activation on subsequent pulls. Git does not run this hook for an already-up-to-date pull, checkout, or rebase. On hook failure Git may still report a successful pull: look for `UPDATE NOT ACTIVATED`, then run `bash ./install.sh --source --kiro-home "$HOME/.kiro"` manually. Existing sessions retain their generation; restart for new code. To disable automation, remove only the verified Fabric `post-merge` hook; no global Git configuration is changed.

If `.kiro` already contains data, stop Kiro and back it up before arranging the checkout. The installer does not migrate or overwrite that directory with a clone. Preserve settings, authentication, sessions and foreign profiles; reconcile source filename collisions manually. Never use `git clean -fdx` in a live Kiro home. `.gitignore` excludes known private/runtime paths but cannot anticipate every third-party credential filename; inspect staged files and never `git add -f` private data. Git-tracked source resources such as `skills/fabric-exec` remain source-owned.

Without hook opt-in, updates require `git pull --ff-only` followed by the explicit source install command. Source acquisition inside the home stages its incoming bundle in a private temporary directory outside the home before managed activation, preserving the incoming-bundle isolation rule.

From an external checkout containing `install.sh`, the same command works on Linux and macOS:

```sh
cd /path/to/kiro-fabric
bash ./install.sh --source --kiro-home "${KIRO_HOME:-$HOME/.kiro}" --migrate-pi-fabric
"${KIRO_HOME:-$HOME/.kiro}/kiro-fabric/bin/kiro-fabric" doctor
cd /path/to/your/project
"${KIRO_HOME:-$HOME/.kiro}/kiro-fabric/bin/kiro-fabric" start
# Explicit opt-in profiles; default remains unchanged:
"${KIRO_HOME:-$HOME/.kiro}/kiro-fabric/bin/kiro-fabric" start --guidance-mode review
"${KIRO_HOME:-$HOME/.kiro}/kiro-fabric/bin/kiro-fabric" start --guidance-mode minimal
```

The install command works for any username on Linux or macOS: it uses `KIRO_HOME`
when set, otherwise `$HOME/.kiro`. After confirmation, installation changes the
selected home and its existing `agents` directory from ordinary user-owned modes
such as 0755/0750 to private mode 0700. Missing directories are created privately.
No manual `chmod` or `sudo` is needed. Foreign ownership, writable-by-others
directories, and symlinks are rejected before building; other directory/file
permissions are preserved. Doctor never adjusts permissions.

Human-readable installs show an ASCII banner labeled with the installer's version
from `package.json` and an overview even with `--yes`: the selected Kiro home,
installation root, active profile, detected installed Fabric version, components and planned
configuration-backup root. After bundle verification and before activation, the
installer reports the exact target version, private Node/ripgrep versions and
whether this is a fresh install, upgrade, downgrade, same-version replacement or
already-installed generation. The guided frontend, `node scripts/install-tui.mjs`,
shows the same version, the full resolved destination paths, Navigator's private parser,
and the skills/runtime preservation policy before confirmation. `--kiro-home`
takes precedence over `KIRO_HOME`, which takes precedence over `~/.kiro`.
An alternative such as `--kiro-home "$HOME/.kiro-fabric"` selects the entire Kiro
home; the Fabric installation is its `kiro-fabric/` child and profiles are in
its `agents/` child. Use that home's installed launcher to select it consistently.
Legacy installations without version metadata are
explicitly reported as version unknown. Kiro CLI itself is not installed or updated.

As soon as a backup succeeds, its exact path under
`<Kiro home>/kiro-fabric/backups/` is printed, along with exclusions; this is a
configuration backup, not a complete `.kiro` clone. The saved path is also retained
in the final result or any later error. An absent home needs no backup. `--json`
remains a single result without a banner; `--dry-run` only reports the installed
identity and planned backup root, without creating a backup or verifying a target.

Source installation includes `--migrate-pi-fabric` automatically as part of
confirmed installation/upgrade. The flag remains available for direct manager
installs. It handles an older Pi Fabric profile using
`.kiro-fabric/install.json`. The record must identify a user installation and its
profile checksum must match. A complete configuration backup is required before
the verified profile is copied durably to `kiro-fabric/legacy-profiles/` and removed
from the active profile path under the installation lock. The new profile then
selects the new verified generation. Existing skills (including custom
`skills/fabric-exec` and legacy skills), old runtimes and other agents remain in
place. Cleanup replaces the old active profile; it does not delete runtime
directories that existing sessions or rollback may need. Unknown or modified
profiles are preserved and rejected.
The option does nothing when migration is unnecessary. If later activation fails,
the error reports the saved profile path; keep that backup when retrying.

The source command already performs frozen dependency installation and a build. A fresh clone only contains committed/published files: `No such file or directory` for `install.sh` means the checkout is missing the installer, not that macOS needs a different command. Obtain a revision containing the installer and its companion scripts; copying only `install.sh` is insufficient. These local changes do not reach another computer until explicitly transferred or committed and pushed.

From the existing trusted checkout:

```sh
bash ./install.sh --source --kiro-home "${KIRO_HOME:-$HOME/.kiro}" --migrate-pi-fabric
# equivalent package command (includes the migration option):
pnpm run agent:install --kiro-home "${KIRO_HOME:-$HOME/.kiro}"
# automation, using a disposable or explicitly intended home:
bash ./install.sh --source --kiro-home "${KIRO_HOME:-$HOME/.kiro}" --migrate-pi-fabric --yes --non-interactive --json
```

Source mode requires developer Node >=24. It first verifies matching source inputs, Git HEAD/dirty state, captured build closure, target, toolchain pins and immutable bundle bytes. A verified warm hit skips pnpm, dependency installation, compilation and archive creation; a receipt alone is never sufficient. Missing/stale inputs rebuild with pinned pnpm **11.20.0** and frozen dependencies. Corrupt evidence refuses rather than silently rebuilding over it. It never clones/resets. Local-source provenance records Git HEAD, dirty state and a source-input digest. Default `bash ./install.sh` fails clearly until a genuine release-pinned bootstrap is generated.

### Source cache and packaging

Agent staging and complete bundles reuse only independently validated generations. Normal source activation requests no archive; explicit complete-bundle archive production streams deterministic USTAR/gzip to private output with bounded buffers and input-drift checks before publication. Private-tool verification hashes in bounded chunks. Build-input/target/toolchain changes invalidate reuse.

`pnpm run agent:cache:gc` previews checkout-cache collection; `node scripts/installer-cache.mjs --apply` opts into deletion. `--keep COUNT` defaults to two generations per kind/target and `--max-bytes BYTES` to 2 GiB of validated retained artifacts. This is a non-destructive preview, not the manager's strictly read-only `--dry-run`: a transient coordination gate is used. Only recorded, independently verified `.tmp` Agent/bundle/private-tool generations are eligible. Current pointers, referenced/current tool pins, unknown or modified files and all installed data are preserved; active entries can exceed the requested budget. Archives are not pruned.

Builders and the source frontend hold per-consumer leases through final artifact use, including activation. GC refuses any lease, including stale or malformed evidence; no age/PID cleanup or force bypass exists. Interrupted gates/leases require inspection. The retired `pnpm run test:installer` command no longer exists; the maintained local installer acceptance cases run via `pnpm run verify:offline installer` (local-development coverage only, currently partial, and not release qualification). Native/authenticated release qualification is separate.

The selected global home is explicit --kiro-home, supplied KIRO_HOME, then the current user's home/.kiro. Empty/relative/control-bearing and unsafe destinations fail. Installer cwd is never stored as the coding workspace. The generated profile explicitly authorizes Kiro's per-session MCP launch directory when client roots are absent. Install/update also configure a backed-up bash/zsh default-agent/workspace-handoff block (opt out with --no-shell-integration). No default-agent setting or authentication changes occur.

### Troubleshooting: `Verified workspace binding is required` / `explicitly-empty`

This means Fabric has no usable authorized project directory. Older profiles
required a shell/launcher handoff that bare Kiro did not supply. Update through
the installer and restart the Kiro session from your project. The updated profile
sets `KIRO_FABRIC_WORKSPACE_SOURCE=launch-cwd`: Kiro starts the MCP server in its
session directory, which Fabric captures once and verifies. No fixed project path
or shell reload is needed for `kiro-cli --v3 --agent kiro-fabric`.

For older installations, this launcher remains a workaround:

```sh
"${KIRO_HOME:-$HOME/.kiro}/kiro-fabric/bin/kiro-fabric" start
# Explicit opt-in profiles; default remains unchanged:
"${KIRO_HOME:-$HOME/.kiro}/kiro-fabric/bin/kiro-fabric" start --guidance-mode review
"${KIRO_HOME:-$HOME/.kiro}/kiro-fabric/bin/kiro-fabric" start --guidance-mode minimal
```

The launcher selects Fabric and supplies an explicit canonical project path,
which takes precedence over the profile's launch-directory source. Client MCP
roots still take precedence over either launch source; ambiguous, removed, or
temporarily unavailable roots never silently fall back. Home, Kiro/Fabric storage,
unsafe, and overly broad directories remain rejected. `fabric.workspace`
status/list return recovery guidance when unbound. Do not disable workspace
checks or hard-code a project path in the global profile.

### Automatic shell setup: `kiro-cli --v3`

Install and update configure the current user's bash (`~/.bashrc`) or zsh
(`${ZDOTDIR:-$HOME}/.zshrc`) automatically, based on `SHELL`. **Open a new terminal**
to load the default-agent shortcut, then change to your project and run
`kiro-cli --v3`. This shortcut is optional for workspace binding: selecting Fabric
with `kiro-cli --v3 --agent kiro-fabric` works without it, including in an existing
terminal. Already-running Kiro sessions must restart to load an updated profile.
Bash login profiles must source `.bashrc` to load the shortcut.

The managed function selects `kiro-fabric` and the installed Kiro home when no
agent is specified. Explicit `--agent`/`-a` selections and non-v3 invocations are
preserved. Each v3 invocation passes its own canonical working directory; no
project path is stored globally and the official executable is never replaced.

Before changing a startup file, the installer saves a private sibling backup
(`.bashrc.kiro-fabric-backup-*` or `.zshrc.kiro-fabric-backup-*`). Updates do not
append duplicates. Uninstall removes only the exact owned block, preserving
later user edits and the original backup. Modified blocks, symlinks, hardlinks,
unsafe permissions, and existing `kiro-cli` definitions are preserved and reported
as conflicts rather than overwritten. Definitions loaded indirectly at shell
startup also take precedence, with a warning. Shell setup is a recoverable
post-activation step: failure reports backend commit truth and exit 7.

Use `--no-shell-integration` with install/update/uninstall to leave startup files
untouched. Unsupported/missing `SHELL` produces an explicit warning instead of
guessing. In these cases use `kiro-cli --v3 --agent kiro-fabric` or the installed
`kiro-fabric start` launcher. Changing
shells after installation does not migrate an existing recorded integration.
The shell backup is separate from Kiro configuration backups; do not restore an
entire old rc over newer user edits when removing the managed block is sufficient.

When upgrading an older installation, rerun the source installer rather than
editing `~/.kiro/agents/kiro-fabric.json` manually: profile bytes are managed and
integrity-checked. Restart existing Kiro processes to use the new profile.

## Installed commands

```sh
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" --help
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" doctor
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" doctor --source-root /path/to/kiro-fabric --json
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" recover --yes --non-interactive --json
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" update --dry-run --json
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" update
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" rollback
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" start
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" uninstall
```

For a custom location use `"$KIRO_HOME/kiro-fabric/bin/kiro-fabric"`. The launcher resolves its own installation, not a changed caller KIRO_HOME. `start` invokes official Kiro with --v3 --agent kiro-fabric, preserving project cwd and explicitly passing its canonical project directory through KIRO_FABRIC_LAUNCH_WORKSPACE. Use this launcher from your project for automatic workspace binding when Kiro supplies no initial roots; no manual attachment is needed. Client roots retain precedence, and reserved home/runtime/data roots are rejected. Bare Kiro need not provide this variable: the generated profile authorizes its per-session MCP launch directory through `KIRO_FABRIC_WORKSPACE_SOURCE=launch-cwd`. It also expands `${KIRO_FABRIC_LAUNCH_WORKSPACE}` into the MCP environment for explicit overrides, because Kiro filters inherited variables. The latter remains useful for older profiles or hosts whose MCP launch directory differs from the project. Do not hard-code a project path into the global profile: concurrent sessions need independent handoffs. Local authenticated Kiro CLI 2.21.1 v3 smoke verified binding on macOS ARM64; full release qualification remains separate. Kiro itself and project-specific Git/Python/Java/Docker/etc. remain external prerequisites. Kiro executables (including a sibling `kiro-cli-chat`) and their directory ancestry must not be group/other-writable; unsafe prerequisites are rejected before execution. The narrow macOS exception is exactly `/Applications`, owned by root:admin (UID 0/GID 80), mode 0775; application descendants and executables remain strict. This explicitly trusts macOS administrators, who can already replace installed applications. The installer does not change their permissions.

Before any client execution (including help/version probes), `start` requires a verified active complete installation. Absent, legacy, or retired installations return prerequisite exit 4; pending transaction/candidate evidence returns recovery exit 7. Integrity failures remain exit 5. This preflight is read-only: it never repairs an interrupted installation, removes evidence, or initializes data.

Kiro CLI binaries may have hard-link aliases, including `kiro-cli-chat`. These are accepted when the shared file and its executable path pass the ownership and permission checks. Fabric does not modify these external binaries. A failed sibling check reports the path and underlying reason; Fabric-managed files still require a single link.

Installed management uses its private Node, not system Node/pnpm or the checkout. It always rejects --source; rebuild through the explicit checkout command. install/update accept --version or --from-archive, never both. Offline archives require exact `<archive>.release.json`, `<archive>.release.sig` and `<archive>.spdx.json` sidecars. The signed release binds the exact SBOM size/hash; byte authentication is not SPDX semantic validation; first-install bootstrap also requires matching embedded archive/member pins. No local archive bypasses production verification. Public update/discovery currently fails before networking because the production key is missing.

Use --yes --non-interactive for explicit automation and --json for one structured result on stdout. `restore` and `recover` require explicit `--yes`; missing consent returns usage exit 2 without prompting or writing. Generated `--help` reads no installation state. Mutation `--dry-run` previews are explicitly partial: they do not download, build, probe clients, capture backups or change the installation, and do not claim candidate compatibility or authorization of later writes. For source previews use `bash ./install.sh --source --dry-run --json` from the chosen checkout.

`doctor --source-root /absolute/checkout` compares explicit source, build and installed identities as data only. Missing/stale/unavailable evidence remains explicit; matching hashes are not signed-release or authenticated-client qualification. Source installations receive source-update guidance; the installed launcher never executes a remembered checkout. Selecting `--version` or `--from-archive` explicitly requests the signed-release path and still requires production verification.

Human and JSON errors preserve known commit status, preparation changes, backup information and recovery requirements. A post-commit failure is not reported as an untouched installation; recover before choosing a new operation. Doctor rejects mutation options and never repairs, locks, logs, initializes durable data, authenticates or contacts downstream MCP. Its Kiro help/version probes have disposable homes. Live model inventory, resources, elicitation, compaction/resume and MCP connectivity are NOT TESTED offline. Terminal output is plain ASCII and does not require color/TUI dependencies.

Doctor also reports `signed-distribution`: WARNING while the production trust root is absent, never PASS merely because a key is configured. An otherwise healthy local installation is not production qualification.

Exit codes: 0 successful outcome, 2 usage, 3 cancellation, 4 prerequisites, 5 integrity/conflict, 6 busy, 7 recovery required (including committed-cleanup-required and unsupported stale-lock recovery), 8 unavailable release discovery. Committed errors explicitly retain committed=true; never blindly retry an uncertain effect.

## Layout and preservation

### Pre-mutation configuration backup

Every mutating operation (`install`, `update`, `rollback`, `uninstall`) first
captures the surrounding Kiro configuration — settings, authentication,
sessions, projects and foreign agent profiles — into a private
`<kiro-home>/kiro-fabric/backups/<timestamp>-<id>/` directory with a
`backup-manifest.json` inventory (per-file SHA-256, sizes and modes). The
managed `kiro-fabric` tree itself is excluded: it has its own transaction
journals, immutable generations and `data/` preservation. If the Kiro home is
absent (first install), no backup is created.

The trusted source frontend supplies the actual canonical checkout as
`sourceRoot`. Only when it exactly equals the selected Kiro home may backup omit
safe top-level `.git/`, `.tmp/`, `dist/`, and `node_modules/` source/build
directories. This keeps generated private tools and dependencies out of the
configuration backup without raising its size limits. The manifest and result
record `sourceRoot` and effective `excludes`; settings, authentication, sessions,
foreign profiles, and other configuration remain covered. Ordinary homes have
no inferred source exclusions, and excluded source artifacts are not restorable
from a configuration backup.

- Backup failure aborts before backend activation but **preserves all produced
  evidence**. Once destination creation is attempted, errors report its path as
  `configurationBackup: { path, status: "unverified" }`, with the underlying
  failure retained as the cause. The path may exist even if mkdir/write/close
  reported failure. Explicitly approved permission preparation may also have
  happened; failure is not a no-change guarantee.
- `backup-manifest.json` is a reserved top-level source name: it is refused before
  copying. The bounded manifest is published exclusively after payload sync,
  never by replacement rename. The exact completed tree is verified before
  success. There is no failed-copy rollback deletion.
- Backups never follow symlinks; links are recreated verbatim on restore.
- Directories are 0700, backup files are read-only owner modes; a tampered
  backup fails verification instead of restoring.
- Non-regular entries (FIFOs, sockets) and safely owned ordinary hardlinked
  configuration files are recorded as `skipped`, not copied. Managed controls,
  unsafe ownership/modes, and unexpected filesystem changes still fail closed.
  Skipped entries are not restorable from that backup.
- **Preserve-all policy:** creation never prunes older backups, even beyond the
  former 20-backup threshold. Validity is not deletion authority. Repository
  metadata, unknown snapshots and failed attempts remain untouched. Storage can
  grow without a retention cap; plan capacity and preserve recovery evidence.
- Listing now validates the same-home manifest and exact snapshot closure,
  ownership, modes, link counts and content hashes before returning `complete`.
  It skips invalid snapshots and never follows manifest symlinks. Global listing
  limits are explicit: 256 root entries, 20,001 physical enumerated entries
  (including manifests) and 256 MiB of charged reads, with a 4 MiB per-manifest limit. Exhaustion throws instead of
  silently returning an incomplete or empty list. These are listing limits, not
  creation/restore caps: an explicit valid larger backup can still be restored
  under the existing per-backup bounds.
- `complete` means verified current contents, **not** proof that an earlier
  creation call acknowledged success or all fsyncs completed. A failed sync can
  leave fully valid bytes; they may pass subsequent verification. Partial or
  malformed copies fail exact verification before restore writes. This is not
  an atomic snapshot or hostile-filesystem race-containment guarantee. A manifest
  and its own hashes establish consistency, not independent author authenticity.
- Successful results retain `configurationBackup` and the human label
  `Prior configuration backup: <path>`. Unverified errors instead print
  `Unverified configuration backup evidence: <path>`. Inspect such evidence
  before retrying; do not treat the failure detail as a successful backup receipt.

The legacy `install-agent-user.mjs` update path likewise retains **all** owned
runtime generations: an active session may still open files from any older
runtime, not merely the previous one. It has no session-liveness proof for safe
pruning. The existing 256-generation capacity remains enforced: admitting a new
generation at that cap fails before mutation, without removing any runtime;
reusing an already owned generation remains allowed. Explicit uninstall retains
its ownership-checked removal behavior and should only run after sessions stop.

Restore is explicit, never automatic. Use the installed launcher or the
source module:

```sh
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" restore --yes --backup \
  "$HOME/.kiro/kiro-fabric/backups/<timestamp>-<id>"
# or, from a checkout:
node scripts/installer-configuration-backup.mjs list "$HOME/.kiro"
node scripts/installer-configuration-backup.mjs restore \
  "$HOME/.kiro/kiro-fabric/backups/<timestamp>-<id>" "$HOME/.kiro"
```

Restore verifies every recorded hash first, containment-checks every manifest
path, refuses to overwrite any existing target path, and unwinds completely on
failure. It preserves the recorded original file modes so Kiro can rewrite its
own settings after recovery. The managed agent profile
(`agents/kiro-fabric.json`) is captured for evidence but never rewritten by
restore: it is regenerated by `install`, and a stale profile would fail
ownership verification.

A generation at `kiro-fabric/runtime/<bundle-digest>/` contains app/, tools/node, tools/rg, manager/install-manager.mjs, resources/steering/fabric.md, resources/skills/fabric-exec/, notices/ and bundle-manifest.json. Every generated profile binds exact matching generation paths. Durable configuration/projects/memory/state/artifacts stay in the existing `kiro-fabric/data/fabric/` structure; namespaces/salts are unchanged. Private directories and executables are 0700; ordinary managed files are 0600.

New sessions adopt the updated profile. Existing sessions keep their exact retained code/tools/resources. There is no automatic generation GC; bounded capacity refuses further updates rather than deleting potentially active files. Rollback validates a retained complete generation and restores its verified original profile from private, integrity-bound `kiro-fabric/profile-snapshots/` evidence. It never renders an old target using an incompatible new profile generator. Missing, changed or unbound original profile evidence refuses activation before live controls change. Ownership schema-3 fields are unchanged, but this does not imply that an older manager understands newer snapshot or journal sidecars. Rollback does not rewind user data or release anti-downgrade state; raw backend smoke is not proof of shared-data or authenticated-client compatibility.

Uninstall deregisters the verified agent and publishes retired ownership, retaining data, immutable generations and the verified management launcher for doctor, repeat uninstall or explicit reinstall. It does not claim complete disk erasure. Foreign/modified files are preserved and reported as conflicts. `--purge-data` is explicit but currently **refused**: complete process-inactivity visibility is not qualified. No negative process snapshot is treated as proof that deleting live data is safe.

Schema-2 legacy trees are verified; schema-1 limited evidence remains explicitly unverified where appropriate. Migration preserves old runtimes and shared skills at their original paths. Legacy code cannot participate in the new startup fence, so automatic legacy/data deletion is prohibited.

After macOS device renumbering, a schema-1 profile snapshot can be verified through a schema-2 snapshot from the same installation only when both exact historical directory device/inode pairs match and both saved volume UUIDs verify against the live directories. All snapshot ownership, content and profile bindings must pass first. This corroboration leaves original snapshots unchanged; legacy-only histories, null-volume evidence, changed directories and transaction/candidate journals retain their strict identity checks.

## Trust and recovery

Bundle identity hashes a canonical payload inventory and metadata, excluding self-hash circularity. External signed release metadata binds final archive bytes, platform/compatibility/source identity and bundle digest. Local ownership schema 3 records activation and retained identities; it is not a publisher signature. release-state.json preserves stable-release high-water identities across rollback/source changes/retirement.

The portable generated bootstrap verifies the entire pinned archive and fixed private Node/manager members before executing downloaded code. A shared bounded restricted-USTAR consumer rejects links/special entries/traversal/collisions/unknown modes and oversized or malformed streams before extraction. Private Node 24.20.0 and ripgrep 14.1.1 archives/member hashes and exact license notices are recorded in build-toolchain.json. Linux requires glibc >=2.28/kernel >=4.18; musl is rejected. The declared macOS minimum is 13.5; its execution/quarantine/resource behavior is not yet natively qualified.

Installer transactions use the existing destination/ownership policy, a shared incarnation/inode-bound lock and versioned journals. New-format backend admission takes the same short lock through data initialization. Individual file replacements are atomic, not the entire transaction. Actual owner bytes establish commit; precommit recovery restores only verified controls, while postcommit cleanup never rolls activation backward. Unknown/partial locks, foreign journal identities and unsupported versions preserve evidence and report recovery-required. `recover --yes` reconciles only provably owned existing transaction/candidate/lock evidence, offline, without requiring Kiro, a release lookup, a build, or a new installation/removal. Repetition is a no-op once recovery is complete. Recovery syncs affected control directories before deleting the journal, including retries whose restored bytes already match. A default rollback retry stops after recovering a previously committed action rather than selecting a different new default target; a new rollback is a separate deliberate operation. Unknown identities and unsupported recovery capabilities still fail closed. Do not manually remove an uncertain lock or backup based only on age/PID.

### Device-number changes and persisted directory identity

New profile snapshots and transaction/candidate journals use sidecar schema 2; **ownership schema 3 is unchanged**. On macOS APFS, new identities bind the exact directory inode to the volume UUID obtained from trusted `/usr/sbin/diskutil`, corroborated against the root-owned block device's live device number. A matching UUID and inode permit device-number changes without rewriting snapshots or journals. UUID checks still run when device numbers match; another volume or a replacement directory is not accepted. These are local integrity checks, not publisher authentication or protection against hostile same-user/root access or a cloned filesystem with duplicated UUID/inode identities.

Use the normal `recover --yes --non-interactive --json` command for interrupted transactions. Healthy snapshots are read without repair or rewriting. Recovery still requires safe ownership/modes, original owner/profile bindings, generation inventories, and independently valid lock evidence. A UUID match does **not** authorize stale-lock reclamation across an uncertain reboot.

Legacy sidecar schema 1 remains readable only with its original exact `dev/ino`. New records on unsupported platforms/filesystems, or where stable volume discovery is unavailable at capture, explicitly retain device-bound identity. A later mismatch in either case returns recovery-required (exit **7**) and preserves evidence: inode equality, content hashes, or a user confirmation alone cannot prove that the directory stayed on the same volume. Recorded stable identity also fails closed if its OS evidence later becomes unavailable. No recovery command upgrades, reanchors, renames, or resigns unknown existing evidence automatically. Preserve the report and original controls for maintainer review; do not edit device numbers or delete snapshots/journals to bypass the check. Older managers may not understand schema-2 sidecars; use a current trusted manager for recovery.

### Unsupported automatic recovery

A dead PID is not sufficient proof that automatic recovery is available. Read-only lock inspection verifies the existing lock through the same inode-pinned capability used by recovery and reports `recoverable: false` with a reason when it cannot do so. No claim, journal replay or repair is performed by doctor. A capability check is not full native-platform qualification.

If inode-pinned recovery is unavailable (including a failed or timed-out macOS helper), the next mutation returns recovery exit **7**, preserves the lock and transaction evidence, and does not silently fall back to unsafe pathname recovery. Empty or partially published claims also remain recovery-required: process death is not permission to delete uncertain bytes. Run the installed `doctor --json`, retain its report privately, stop retrying mutations, and arrange maintainer review of the preserved ownership/journal evidence. Do not remove locks, candidates or backups based only on age or PID. A changed macOS boot timestamp remains uncertain rather than automatic deletion authority; purge remains disabled.

These checks are defense in depth for cooperating processes, not an OS sandbox against hostile same-user access. Approved shell commands retain host authority. Native runner, production signing and exact-artifact authenticated Kiro gates remain separate release requirements.

### Interrupted lock release

A private `.install-lock-release.json` hard-link marker retains the original owner evidence while the lock directory is removed and recovery hands ownership to a new lock. Inode/root/process and positive stable directory-birth identities must match; committed transaction provenance survives interrupted reclaimers. The existing recovery command handles provable markers. Legacy empty locks without such evidence, unavailable birth identity, changed namespaces and foreign markers remain fail-closed and must not be deleted blindly. Native macOS qualification of these new release changes remains pending.
