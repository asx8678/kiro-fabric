# Kiro integration records

This directory preserves the planning and implementation evidence from the Kiro
integration workspaces.

## Start here: choose an integration

The additive default is [Kiro Fabric Power](power.md). Run `pnpm power:dev` in a
source checkout and import the generated local folder in Kiro IDE. Public GitHub
imports launch the checked-in runtime closure without activation-time package
resolution and remain gated by Power certification plus a clean-machine client
qualification.

The managed custom-agent integration below is **Strict mode**.

Requirements: Node.js 24 or newer and an installed, authenticated Kiro CLI
2.20.1 native executable (ELF/Mach-O/PE as applicable). Unsupported shebang
wrappers are rejected unless a future launcher supplies a complete attested
dependency closure.

After installing the npm package globally, launch the guided setup console:

```bash
npm install --global kiro-fabric
kiro-fabric-setup
```

A terminal gets an interactive menu. Automation must use an explicit command:

```bash
kiro-fabric-setup status
kiro-fabric-setup doctor
kiro-fabric-setup install --user --project-root /absolute/path/to/project --dry-run
kiro-fabric-setup install --user --project-root /absolute/path/to/project
```

From a Linux or macOS source checkout, run `sh
scripts/install-kiro-fabric.sh`. The friendly bootstrap checks Node.js, asks
before preparing dependencies plus compiled artifacts when needed, and installs
the shared profile under `$KIRO_HOME` or `~/.kiro`. The source installer is
user-scope only: it adds `--user` automatically to `install`, `update`, and
`uninstall`. Setup and launch default their project root to the canonical source
checkout, or `KIRO_FABRIC_PROJECT_ROOT` when set; an explicit `--project-root`
still overrides the default. Tool auto-approval remains off unless the user
explicitly passes `--allow-tools`; that exact `fabric/fabric_exec` grant is
bound to the canonical project root and may never target the Kiro config home.
Non-interactive source preparation requires `--yes` on a mutating command or
`KIRO_FABRIC_AUTO_BUILD=1`; set `KIRO_FABRIC_AUTO_BUILD=0` to require a prebuilt
checkout. Always inspect an explicit mutation with `--dry-run` first. Do not use a
transient package runner because the generated profile stores absolute paths
to its format-3 managed runtime. Installed doctor and managed launch require
that fully attested format; legacy formats fail with update/repair guidance.

See [installer.md](installer.md) for all commands, update/uninstall behavior,
backups, ownership rules, troubleshooting, and exit codes.

## Which document is authoritative?

| Document | Role | Status |
|---|---|---|
| [power.md](power.md) | Additive Agent Plugins 1.0.0 Power, local import, workspace/security/lifecycle limits | Deterministic local implementation; real IDE gates listed |
| [release-governance.md](release-governance.md) | Protected CI, reproducibility, real-client qualification, signed release and SBOM policy | Required public-release process |
| [capabilities-2.20.1-v3.md](capabilities-2.20.1-v3.md) | Current Strict Kiro 2.20.1/v3 contract, feature review, migration decisions, and efficient-use guidance | Authenticated non-billable gates passed; model-turn gate pending |
| [baseline.md](baseline.md) | Implementation notebook, verification results, and PR-by-PR notes | Best record of work actually completed |
| [capabilities-2.19.1.md](capabilities-2.19.1.md) | Results of the Kiro 2.19.1 capability spike and resulting fail-closed decisions | Implemented evidence |
| [installer.md](installer.md) | Install, doctor, and uninstall behavior | Current v3 user documentation |
| [release-a.md](release-a.md) | Packed and real non-billable Release-A certification | Historical v2 gate |
| [release-b.md](release-b.md) | Explicitly billable, double-opt-in real multi-turn/resume certification | Release-B gate; not run by default |
| [adr-durability-residency.md](adr-durability-residency.md) | Single-owner supervisor decision, fencing, migration, and rollback requirements | Accepted prerequisite for Release C |
| [release-c.md](release-c.md) | Crash, mailbox-idempotency, durable-resume, and rollback rehearsals | Current non-billable Release-C gate |
| [implementation-plan.md](implementation-plan.md) | Validated phase/release plan that refined the original architecture | Planning record; unchecked work is not proof of completion |
| [architecture-plan.md](architecture-plan.md) | Original architecture, contracts, phase descriptions, risks, and decision log template | Historical vision; superseded where the validated plan or implementation evidence differs |

Use the implementation and verification records to determine current behavior.
The plans explain intent and preserve deferred steps, but some proposed names,
PR boundaries, daemon choices, and version assumptions changed during delivery.

## Imported source inventory

The two code worktrees below contained the same relevant working files when this
record was imported:

- `/Users/adam2/projects/kirofabric/kiro-fabric`
- `/Users/adam2/projects/kiro-fabric`

Their Kiro-specific source, tests, scripts, and four implementation documents
were already present in this workspace. The only non-transient planning records
that existed outside those worktrees were copied as follows:

- `/Users/adam2/projects/kirofabric/plan(20260824-075704).md` →
  `architecture-plan.md`
- `/Users/adam2/projects/kirofabric/kiro-cli-implementation-plan.md` →
  `implementation-plan.md`

The copies are byte-for-byte snapshots. They intentionally retain original path
references and unchecked task lists for provenance.

Transient `.pi` state, `.DS_Store`, Git metadata, dependencies, and build output
were not imported as project documentation.
