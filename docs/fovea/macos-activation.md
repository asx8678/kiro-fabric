# macOS explicit Fovea activation — 2026-09-20

## Current follow-up

The installation and full check have since been refreshed; see
[completion-ledger.md](completion-ledger.md#installed-verification) for the active
generation, direct tool evidence, current test counts and remaining gates. The
rest of this document preserves the earlier explicit-navigation activation.
Darwin provenance is now implemented/component-tested, but automatic native Kiro
routing and H01–H12 qualification remain incomplete.

## Earlier result and use

Fabric **0.65.0**, Fovea **0.29.2 / port 0.1.1**, private parser **0.45.3**
are installed and active on the authorized Darwin arm64 host, Kiro CLI **2.22.1**.
No toggle is needed for explicit navigation. Start a **new** Kiro session from
the project (existing sessions may retain their previous generation):

```sh
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" start
```

Ask Kiro to use Fovea through `fabric_exec`, for example:

```ts
return await repo.focus({ query: "resolveFoveaGit", maxTokens: 512 });
```

`repo` is a predeclared namespace, **not** `await fabric.repo()`. `repo.sketch`,
`repo.dwell`, `repo.impact`, and `repo.status` use the same admitted engine.
Automatic hook injection, hidden delivery, native session routing, queue-safe
continuation and Darwin cross-session provenance are **not enabled/qualified**.
No H01–H12 row is promoted by a single explicit read-only analysis.

## Implementation

- `scripts/build-fovea-native.mjs`: build-time local compiler/header discovery,
  Darwin API declarations, explicit target architecture and macOS 13.5 floor.
  No downloads and no production compiler discovery.
- `scripts/build-kiro-closure.mjs`: inventories native binary and metadata in the
  relocatable closure; complete bundle hashes cover both. Cross-target reuse is
  rejected by `scripts/build-complete-bundle.mjs`.
- `src/fovea/native-source-loader.ts`: validates complete bundle, same-generation
  Node/parser, inventory hashes, C source identity, ABI and Mach-O architecture.
  Captured bytes load only from fresh private engine storage. No env/PATH helper,
  workspace addon, `/dev/fd` fallback, permission weakening or runtime compilation.
- `src/fovea/engine.ts`: instance-owned `SourceAccess` uses the verified Darwin
  binding; Linux continues using its existing backend. The unbound factory stays
  fail-closed on Darwin.
- `src/fovea/source-access.ts`: excludes `.tmp`, `.fabric`, `.kiro` host/cache
  storage before traversal and budget accounting; other hidden source remains
  eligible. This does not claim arbitrary `.gitignore` parity or relax bounds.
- The earlier `src/fovea/git-executable.ts` fixed-CLT Git selection remains intact.

## Observed checks (keep scopes separate)

| Check | Result / evidence |
| --- | --- |
| Initial complete Fovea run, before final cache fix | Exit 0: 288 passed / 88 skipped, 23 passing / 6 skipped files. `.tmp/fovea-darwin-suite.log`. |
| Final native/loader/bounds/coverage modules | Exit 0: 110 passed / 4 skipped, four files. `.tmp/fovea-darwin-targeted.log`. Includes actual compiled Darwin tests, unsafe objects, races, exact reads and cache-budget regression. |
| Final complete Fovea attempt | 285 passed / 92 skipped; historical-manager suite failed setup because source installer had republished `.tmp/complete-bundle.json` with `archive:null`. `.tmp/fovea-darwin-suite-final.log`. Not relabeled as a green aggregate. |
| Repaired fixture prerequisite | Restaged real archive using `scripts/build-complete-bundle.mjs`, then reran only `tests/fovea/historical-manager-migration.test.ts`: exit 0, all four passed. `.tmp/fovea-darwin-migration-final.log`. No test/production assertions weakened. |
| Typecheck and Knip | Exit 0. Knip emits an unused `cc` ignore-entry hint. |
| Build, complete bundle and installer smoke | Passed; native addon loads with private Node and no Homebrew runtime dependency (`otool -L`: only `/usr/lib/libSystem.B.dylib`). Foreign bundle target rejected. |
| Source install | `--source --yes --non-interactive --no-shell-integration --json`: committed/activated, data preserved, no recovery required. `.tmp/fovea-darwin-install-final.json`. |
| Native Kiro, fresh session | Actual `@fabric/fabric_exec` completed with `focus.status:"ok"`, match `src/fovea/git-executable.ts` (line 5), caller links and hash-bound read windows. 498 source files / 5,850,788 bytes, source budget not capped. `.tmp/fovea-darwin-kiro-final.jsonl`. |

The first live attempt inserted nonexistent `fabric.repo()` and failed validation
before dispatch. A corrected attempt executed but scanned 134 MB of local caches
and returned no match. These are retained as `.tmp/fovea-darwin-kiro.jsonl` and
`.tmp/fovea-darwin-kiro-retry.jsonl`; neither counts as the successful source match.
The final run is a new session using the cache-excluding generation.

An optional `build-agent-dev.mjs` run refused an existing pre-pull development
stage with `agent product authority digest drifted`; that evidence was preserved,
not deleted or bypassed. Complete-bundle source installation does not use that
staging pointer. Full `pnpm run check`, release signing, platform-wide CI and
interactive acceptance/decline were **not** certified by this work.

## Installed identity and retained recovery

- Source changes remain uncommitted atop `020d86c37178ab17453d9a03ec6e60318fcda243`.
- Active generation: `b0bbcf7fe8b4042ef881dc35f498e5770114bbf76e4fd33aae8f6c03ecc481e6`.
- Previous generation: `fd2669d45a1211b9ad79e7e80fe37718ceedb926ebac80cb98704c2e1c163052`.
- Original Fabric 0.64.0 generation is also retained:
  `7b8ba7db706d04ef565e0f97a1bd4094249f69ddb88d30170b61423169eb225a`.
- Final configuration backup:
  `~/.kiro/kiro-fabric/backups/20260920T200322Z-6373e1585d659c2c`.
- Successful native session: `sess_65a0148f-41be-4614-87c7-f7298ec76a30`.
- Final checks: `.tmp/fovea-darwin-final-build.log`,
  `.tmp/fovea-darwin-doctor-final.json`, `.tmp/fovea-darwin-activation-evidence.json`.

All installs used the supported transaction path and trusted private Node. No
partition, volume, credentials, shell configuration, or approval-policy changes.
Installer backups/runtime generations and original snapshot evidence are retained.
