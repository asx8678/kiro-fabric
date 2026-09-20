# Historical installed manager: bundle schema 1 → 2

## Current owner verification

The subsequent owner full suite and separately registered installer suite both
executed all four cases against fresh generation
`f2e29f265b7bd17ca7bf51fae509c093e334428ada417dd5183825c98440de9e`.
The original scoped stage/counts below are historical. The test is now enrolled
in `scripts/test-installer.mjs`'s bundle registry; native CI checkout retains full
history (`fetch-depth: 0`) without persisted credentials so the exact old Git
object is available. This does not claim that the four native targets executed.
See [remaining-verification.md](remaining-verification.md).

## Scope and result

Qualified locally on Linux x64 with
`tests/fovea/historical-manager-migration.test.ts`: **4 passed**, 57.02s
(2026-09-20). No production repair was needed for the supported trusted-source
handoff. This is real historical-manager execution, not same-schema parity.

The baseline is the exact local Git object
`1dd4df19aac5e3ab4e404a4b43a133e59da6488a`. The test archives it into a private
temporary directory; it never resets the checkout, fetches a release, changes
retained code, installs into the user's home, or creates credentials/signing
keys. The source archive is disposable, not a new Git worktree.

These are three different version numbers:

| Document | Baseline | New generation |
| --- | --- | --- |
| `bundle-manifest.json` | **schema 1** | **schema 2**, including Fovea and private ast-grep |
| `install-owner.json` | schemaVersion **3** | **3**, same exact field set |
| Fabric `config/config.json` | schemaVersion **1** | Original bytes preserved; Fovea settings go into separate `config/fovea.v1.json` |

`tests/managed-installation.test.ts` ownership-schema fixtures and
`tests/installed-bundle-history.test.ts` synthetic pre-worker bundles remain
useful, but neither executes this historical manager through bundle schema 1 → 2.
Nor does changing steering bytes between two schema-2 bundles establish a
cross-schema result.

## What is executed

- Historical tracked `dist/kiro-agent-closure`, skills and steering come from the
  pinned archive, unchanged. Its archived closure verifier checks integrity.
- The **archived** manager and its archived dependencies are compiled with the
  historical packager's esbuild settings. Every compiler input must remain
  inside that archive, without test or npm runtime modules. This is fixture-only
  manager compilation, not a project build or a historical published-release
  reproduction claim.
- Real private Node/ripgrep and their notices are copied from local staged tools
  only after comparing the complete historical pins and member SHA-256s. There
  is no binary stub or download fallback. The **historical** manifest builder
  creates and validates the schema-1 bundle.
- Initial installation executes that historical manager with the real private
  Node and production candidate smoke. Subsequent old-manager invocations use
  the actual installed module and its own generation's private Node; installed
  manager identity validation is not bypassed.
- The new schema-2 archive is captured once from `.tmp/complete-bundle.json`,
  extracted privately and checked against the staged digest/native target. The
  tested stage was
  `4d96d38d6707bb81c2137b7597c50649db78fd0958d5e3359d9e32fa1f0b44c1`.
  Later owner staging cannot change the captured fixture halfway through.
- HOME, KIRO_HOME, workspace, temporary files and PATH are explicitly bound to
  disposable locations. The only stub is Kiro's offline version/help prerequisite
  contract. Backends, parser, manager, smoke and raw MCP requests are real. No
  authenticated Kiro session is started.

## Acceptance ledger

### 1. Unsupported old-manager admission is safe

The installed baseline's public `update --yes --non-interactive --json` rejects
an implicit source update with exit **4** and trusted-checkout guidance.

The test then actually invokes the installed baseline's exported `runManager`
with a trusted `sourceBundle` handoff pointing to the captured schema-2 bundle.
It rejects with exit **5**, **`Manifest identity`**. This is an internal source
frontend admission test, **not** a public unsigned-archive switch. The test
checks unchanged owner/profile/launcher bytes, one unchanged old generation,
no transaction journal, preserved old configuration and user data, and full
retained inventory validation. Preflight configuration backup is permitted and
verified: rejection does **not** mean no filesystem writes occurred.

### 2. New trusted source migrates; both generations keep running

The current trusted source manager's `runManager` receives the staged schema-2
bundle through the same `sourceBundle` handoff used by
`scripts/source-install.mjs`. Production admission/smoke/activation execute.
The live ownership record contains both schema-1 and schema-2 generations with
new current/old previous pointers, without adding ownership or generation-record
fields.

An actual old MCP process starts **before** migration and remains alive. The new
profile starts a distinct new MCP process. Admission is sequential because the
installation lock deliberately fails fast; after admission their requests run
concurrently. Old local reads still succeed while new `repo.focus` returns
hash-bound source reads. New `repo.configure` publishes real global Fovea
settings through an accepted fixture elicitation; the resulting file is private
0600. The original Fabric config is not rewritten or given Fovea fields.

### 3. Cross-schema rollback restores originals, not regenerated approximations

The new installed manager's public `rollback` command activates the retained
schema-1 generation with production compatibility smoke. Assertions check:

- Exact original old profile bytes are restored. The content-addressed snapshot
  contains the exact original owner and profile bytes, not today's regenerated
  profile template. Snapshot filename SHA-256 is verified.
- The new profile has its own retained snapshot. Both complete generations
  remain intact; full old inventory verification includes manager, tools,
  closure, resources and manifest.
- New Fovea settings, old Fabric config and user data remain byte-identical.
- Both already-running backends remain usable, and a **fresh** old backend starts
  from the restored old profile while the new backend is still alive.
- Reapplying the trusted new source bundle restores the exact saved new profile
  and preserves settings and the old snapshot.

**Important historical limitation:** once schema 2 is retained, the old manager
cannot inspect the entire installation, even after rollback makes schema 1
current. Its actual `doctor --json` reports installation FAIL / `Manifest identity`
(exit **5**) without changing activation controls. Old backend admission still
works: it validates its own retained generation. Do not delete the newer runtime
or Fovea data to make the old manager happy. Use trusted **new** management code
for subsequent installation/maintenance. This is supported source migration and
runtime rollback, not transparent old-manager self-update or complete management
compatibility after downgrade.

### 4. Interrupted cross-schema activation preserves recovery evidence

A real child process running the current lifecycle is killed with **SIGKILL** at
`profile-published` and `owner-committed`. Production candidate smoke is retained;
only the test phase observer injects the kill. Each case requires a real SIGKILL
result, not a spawn timeout mistaken for an interruption.

Both cases retain `active.json` and a candidate record declaring bundle schema 2.
The journal's before owner/profile are checked against the original snapshots.
The actual old installed manager's doctor reports recovery-required (exit **7**).
Its attempted offline `recover` refuses the unsupported candidate with
`Manifest identity` (exit **5**). Journal, candidate and activation controls stay
byte-identical across those old-manager calls. Do not infer activation state from
the old refusal's `committed: false`; the recorded owner/journal determines it.

Explicit offline recovery using the trusted **new source** manager then:

| Kill point | Verified result |
| --- | --- |
| `profile-published` | Restores exact journal-before controls and old runtime selection; removes only the recorded, uncommitted candidate. |
| `owner-committed` | Retains exact journal-after controls and both generations; completes committed cleanup. |

Both preserve old profile snapshots, old config and user data. A second recovery
is a no-op. These assertions cover the two stated cross-schema **installation**
interruption points, not every possible historical-manager recovery operation or
all rollback interruption phases.

## Supported operator path versus public update

From an explicitly trusted updated checkout, the source frontend remains:

```sh
bash ./install.sh --source --kiro-home /absolute/disposable/.kiro \
  --yes --non-interactive --no-shell-integration
```

This qualification invokes its already-staged manager handoff directly; it does
not rerun dependency installation/build or claim a new full shell-installer run.
An interrupted operation must first use the updated trusted manager offline:

```sh
node scripts/install-manager.mjs recover --kiro-home /absolute/disposable/.kiro \
  --yes --non-interactive --json
```

Use a trusted compatible Node executable. `recover` does not need a bundle,
Kiro discovery, authentication or network access. Preserve journals, backups and
unknown material; do not hand-edit ownership or replace retained manager code.

The old public `update` does not automatically acquire new source management
code. Public signed update, release signing, native client authentication/TUI
and non-Linux qualification are separate gates and are **not** certified here.

## Reproduction and evidence

Prerequisites: local pinned Git object, esbuild from developer dependencies,
trusted Node, and an owner-staged native schema-2 complete archive. Missing
staging or the Git object is a failure, never a synthetic fallback or a skip.
After the owner stages dependencies, run only:

```sh
pnpm exec vitest run tests/fovea/historical-manager-migration.test.ts \
  --reporter=default --reporter=json \
  --outputFile=.tmp/fovea-historical-manager-vitest.json
```

Latest strengthened-assertion run: **4/4 passed**, one file, **57.02s**. Evidence:
`.tmp/fovea-historical-manager-test.log` and
`.tmp/fovea-historical-manager-vitest.json`. File-scoped TypeScript diagnostics
also passed (explicit `--ignoreConfig` with the repository compiler options).
Private test installations are removed after assertions; the test does not
retain user-like homes, credentials or processes. It preserves transaction
evidence until the explicit recovery step, then checks the selected controls
against the captured journal before fixture cleanup.

No full suite, installer suite or project build was run by this task. The owner
runs the serial check, installer qualification and final fresh build; those
results must be reported separately against the final staged tree.
