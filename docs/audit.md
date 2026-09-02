# Power architecture and code-quality audit

This audit covers every retained source, build/release script, test, manifest, workflow, and generated-artifact class after the Power-only deletion. “Code Mode” means the required `fabric_exec` path: strict TypeScript checking followed by QuickJS and provider calls. Kiro-native operations are deliberately outside Fabric; no retained file creates an alternate Fabric execution path.

## Findings resolved

| Finding | Resolution and evidence |
|---|---|
| Guest declarations exposed `setTimeout`, but QuickJS did not provide it | Removed the phantom declaration; strict-compiler coverage proves `setTimeout` is rejected. |
| The retained MCP implementation duplicated a generic, mode-heavy provider/cache | Deleted both generic files; `kiro/mcp-provider.ts` now owns only configured `$servers`/`$call` federation, static discovery, exact server/tool checks, separate stdio approval, cancellation, and bounded close. |
| Type checking deliberately suppressed argument/type diagnostics | Removed the relaxed mode entirely. Every semantic diagnostic now stops execution before QuickJS. |
| Compiler timeout/abort could settle before worker termination and had an abort-listener race | Await worker termination on every completion path, preserve abort reason, recheck after listener installation, and never post after settlement. |
| Effective timeout reporting ignored an exact MCP action floor | Track and report the actual floor selected during host-call dispatch. |
| Configuration privacy was asserted but not enforced | Enforce owner, mode, link/type, and 256 KiB checks before parsing. |
| Memory filesystem errors could be mistaken for missing entries | Only `ENOENT` is treated as absence; permission/I/O failures propagate. |
| State had only per-value bounds and process-local overlap protection | Add complete-document validation/quota and an identity-checked, stale-aware cross-process mutation lock. |
| Process-local artifact crash residue consumed quota forever | Remove only valid residue names at startup and fail closed on foreign entries. |
| MCP process signal/stdin listeners survived shutdown | Remove all installed listeners on either successful or failed close. |
| Package policy existed but was not on the build path | Export one policy assertion and invoke it before every build; exact files, exports, manifests, providers, and direct dependencies are checked. |
| Closure build allowed declared dependencies that were not reached | Reject any direct runtime dependency absent from the exact metafile graph. Removed stale install-script allowances. |
| Real-client release reports checked only a subset of evidence | Centralized exact digest/session/tool/activation/no-agent validation; reject stale SBOMs and unsafe driver paths. |
| CI compared two closure hashes but did not require a clean regenerated checkout | Added a clean-tree assertion after the second deterministic build. |

No unresolved critical, high, or medium finding remains in the retained Power scope. The explicit real Kiro CLI run remains a release gate, not an ordinary-CI claim.

## Retained runtime source: file-by-file

| File | Why it exists / closure decision | Code Mode, API, security, and quality assessment |
|---|---|---|
| `src/async-settlement.ts` | Shared abort racing and bounded drain primitive; **in closure**. | Host lifecycle support only; observes late promises and cannot execute guest text. |
| `src/config.ts` | One normalized Power configuration contract; **in closure**. | Every field drives an enforced runtime/provider bound. Private-file checks fail closed; no mode selector. |
| `src/core/action-registry.ts` | Provider registry, exact schemas, approvals, overlap control, leases; **in closure**. | Sole provider dispatch boundary. Approval precedes invoke; exact refs prevent fuzzy or textual bypass. |
| `src/execution-service.ts` | Compiler-to-QuickJS orchestration and deadline calculation; **in closure**. | The only Fabric execution service. Strict checking is unconditional; no alternate runtime/fallback. |
| `src/index.ts` | Minimal package-root runtime/provider exports; **library artifact, not Power entry closure**. | Exposes interfaces/factories, not a second process or execution mode. |
| `src/kernel/fabric-exec-contract.ts` | Exact top-level schema and non-rewriting preparation; **in closure**. | Requires `code`; rejects extra fields and malformed payloads rather than guessing intent. |
| `src/kernel/index.ts` | Package export barrel for the one tool contract; **library artifact, tree-shaken from Power closure**. | No logic or bypass. |
| `src/protocol.ts` | Narrow provider/action/context interfaces; **type surface, tree-shaken from Power closure**. | Keeps approval/cancellation/effect contracts explicit; no implementation selection. |
| `src/schema-validation.ts` | Value validation with trace-safe diagnostics; **in closure**. | Fails closed for Fabric-owned schemas and redacts caller-owned property names. |
| `src/kiro/artifacts.ts` | Private, bounded, process-local artifact store; **in closure**. | No arbitrary path API. IDs are generated, writes bounded, residue/foreign entries handled safely. |
| `src/kiro/canonical-path.ts` | Canonical path and filesystem-identity primitives; **in closure**. | Centralizes anti-alias/replace checks; no authorization on lexical paths. |
| `src/kiro/deadlines.ts` | Exact deadline floor/clamp policy; **in closure**. | Exact `mcp.$call` match only; cannot infer authority from guest source text. |
| `src/kiro/mcp-entry.ts` | Sole stdio process entry and bounded shutdown; **in closure**. | Starts only the three-tool server from Power launch context; cleans process listeners. |
| `src/kiro/mcp-provider.ts` | Configured MCP federation provider; **in closure**. | Static discovery avoids contact. Exact calls are schema-checked, approved, bounded, cancellable, and close contacted servers before settlement. Factory seam is test-only injection, not a product mode. |
| `src/kiro/mcp-server.ts` | Kiro MCP transport, workspace/runtime leasing, and three tools; **in closure**. | `fabric_exec` always enters `FabricExecutionService`; input schema has no alternate action/text route. Runtime swaps drain leases. |
| `src/kiro/memory-provider.ts` | Bounded Power-memory action adapter; **in closure**. | Exact schemas and risk metadata route every operation through `ActionRegistry`. |
| `src/kiro/memory.ts` | Private namespaced persistent memory and lock; **in closure**. | Canonical confinement, ownership marker, quotas, atomic replacement, and fail-closed I/O. |
| `src/kiro/power/approver.ts` | Kiro elicitation adapter and approval projection; **in closure**. | Binds approval to exact action/args/risk/workspace and denies when elicitation is unavailable. |
| `src/kiro/power/artifacts-provider.ts` | Read-only guest adapter over process artifacts; **in closure**. | Guest cannot choose paths or write through this provider. |
| `src/kiro/power/data-paths.ts` | Derives private plugin/workspace data roots; **in closure**. | Uses canonical workspace identity hashes; never writes repository or user settings. |
| `src/kiro/power/launch-context.ts` | Validates `PLUGIN_ROOT`/`PLUGIN_DATA`; **in closure**. | Absolute existing non-symlink directories must be distinct and non-containing. |
| `src/kiro/power/workspace-binding.ts` | Workspace discovery, explicit selection/manual attachment, identity revalidation; **in closure**. | Manual attach approval is dev/inode/ctime-bound; ambiguity and replacement fail closed. |
| `src/kiro/power/workspace-context.ts` | Conservative roots cache; **in closure**. | Coalesces refreshes; transient failure preserves prior observation and does not imply detach. Source interface is a narrow test/transport seam. |
| `src/kiro/projection.ts` | Bounded/redacted MCP result and approval rendering; **in closure**. | Prevents oversized or secret-bearing diagnostics; does not execute content. |
| `src/kiro/runtime.ts` | Mounts exactly artifacts, memory, state, and MCP; **in closure**. | No provider discovery/plugin mechanism. Removed unused approver constructor state. |
| `src/providers/state-provider.ts` | Workspace-bound persistent JSON state; **in closure**. | Exact schemas, optimistic revisions, total quotas, validated files, atomic writes, and cross-process lock. No path API. |
| `src/runtime/compiler-worker-entry.ts` | Isolated compiler worker protocol; **in closure**. | One request, strict check, one response; no runtime selection. |
| `src/runtime/guest-stack-map.ts` | Maps wrapped/transpiled stack locations to guest lines; **in closure**. | Diagnostic-only and bounded; no source rewriting. |
| `src/runtime/guest-types.ts` | Single declared guest API; **in closure**. | Matches mounted providers and intentionally omits host/timer APIs. |
| `src/runtime/json-budget.ts` | Iterative depth/node/string JSON guard; **in closure**. | Prevents cycles and bridge amplification without recursive host-stack risk. |
| `src/runtime/quickjs-runtime.ts` | QuickJS context, interrupt, bridge, quotas, and disposal; **in closure**. | Sole guest runtime; host function calls require exact refs. Termination clears timers, rejects pending calls, and disposes handles/context/runtime. |
| `src/runtime/source-limit.ts` | Shared source/input/transpiled size limits; **in closure**. | Same constants drive schema, worker, runtime, and docs; no silent truncation of executable code. |
| `src/runtime/type-checker.ts` | Strict TypeScript program/check/emit plus bounded worker lifecycle; **in closure**. | All semantic errors are enforced. Worker is terminated before completion and never reused across requests. |

## Build, package, and release scripts

None of these files is reachable from the Power runtime.

| File | Responsibility and audit result |
|---|---|
| `scripts/package-policy.mjs` | Exact package/export/file/manifest/provider/dependency policy; invoked by build and directly tested. |
| `scripts/build.mjs` | Clean ESM/declaration build; invokes package policy first. |
| `scripts/build-kiro-closure.mjs` | Esbuild metafile authority, forbidden-module checks, source/package inventory, closure digest manifest. |
| `scripts/assert-build-artifacts.mjs` | Imports built entries and rejects stale/forbidden artifacts and declaration leaks. |
| `scripts/build-power-dev.mjs` | Creates only the private checkout-local staged import source. |
| `scripts/validate-power-package.mjs` | Rejects aliases, symlinks, unsafe modes/owners, unexpected entries, forbidden strings, and manifest drift. |
| `scripts/build-power-dev.mjs` | Publishes the sole checkout-local immutable staging generation; user-home export is not supported. |
| `scripts/assert-kiro-home-unchanged.mjs` | Guards ordinary commands against Kiro-home mutation. |
| `scripts/certify-kiro-power.mjs` | Hermetic stdio MCP certification of initialization, exact tools, workspace binding, strict execution, approval absence, and shutdown. |
| `scripts/real-client-evidence.mjs` | One exact validator for raw driver and qualification evidence. |
| `scripts/certify-kiro-power-real.mjs` | Runs an absolute reviewed real-client driver in a private temporary evidence directory. |
| `scripts/generate-power-sbom.mjs` | Generates SPDX from exact closure package inputs and closure digest. |
| `scripts/release-candidate-report.mjs` | Binds pack list, staged digest, current SBOM, hermetic evidence, and optional exact real-client evidence. |

## Tests and enforcement

| File | Retained evidence |
|---|---|
| `tests/fabric-exec-contract.test.ts` | Exact schema, no rewriting, strict API diagnostics, no guest timer. |
| `tests/quickjs-runtime.test.ts` | QuickJS isolation, bounds, stacks, cancellation, timeout, pending-call settlement, disposal. |
| `tests/action-registry.test.ts` | Exact refs/schemas, approval ordering, overlap rejection, cancellation, close/drain. |
| `tests/mcp-federation.test.ts` | Static discovery, exact configured call, stdio execute approval, cancellation close. |
| `tests/workspace-binding.test.ts` | Canonical roots, selection, transient failure, attachment identity. |
| `tests/approval-projection.test.ts` | Exact/redacted approval summaries. |
| `tests/deadline-policy.test.ts` | Exact timeout floor and clamp behavior. |
| `tests/configuration.test.ts` | Used settings, clamping, private/size checks. |
| `tests/memory-security.test.ts` | Ownership, links, bounds, locking, and cleanup. |
| `tests/artifacts-state.test.ts` | Artifact confinement/residue plus state revision/privacy/document bounds. |
| `tests/package-boundary.test.ts` | Reachability, removed subsystems, manifests, policy, export isolation. |
| `tests/hermetic-stage.test.ts` | Deterministic staged package and no user-home mutation. |
| `tests/power-export.test.ts` | Explicit export ownership, idempotence, concurrency, rollback. |
| `tests/release-evidence.test.ts` | Exact real-client evidence fields and digest binding. |

`tsconfig*.json` enforce strict NodeNext TypeScript; `vitest.config.ts` selects only the focused suite; `knip.json` checks retained source/tests; `pnpm-workspace.yaml` permits only esbuild’s install script. `package.json`, `plugin.json`, `mcp.json`, `power-product.json`, and `docs/power-product.schema.json` define one mode-free Power product. The four workflows separate hermetic CI, explicit real-client qualification, candidate reporting, and release; none installs or selects a custom agent.

Generated `dist/index.js`, declarations, and every file under `dist/kiro-power-closure/` are build outputs rather than independent source responsibilities. They are audited individually by sorted path/byte hashes, import checks, closure-manifest checksums, two-build CI reproducibility, staged-package digesting, and the SBOM binding.
