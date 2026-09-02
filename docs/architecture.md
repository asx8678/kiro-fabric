# Architecture

## Product boundary

Kiro Fabric is one Kiro CLI v3 Power, not a session wrapper, custom agent, extension-host adapter, or orchestration layer. Its sole process entry is `src/kiro/mcp-entry.ts`; it exposes exactly `fabric_info`, `fabric_workspace`, and `fabric_exec`. Kiro retains ordinary file, edit, shell, web, and subagent ownership.

`power-product.json` is the machine-readable authority for the entrypoint, mounted providers, direct runtime dependencies, and forbidden modules. `scripts/package-policy.mjs` validates package/manifests before every build. `scripts/build-kiro-closure.mjs` then proves the resolved closure and emits `.tmp/power-reachability.json` plus a digest inventory in `closure-manifest.json`.

## Checked execution path

A `fabric_exec` request has one path and no textual, action-name, manual-command, or legacy fallback:

```text
MCP schema -> strict TypeScript worker -> QuickJS -> ActionRegistry -> provider
```

The MCP contract requires a TypeScript function body in `code`. The compiler reports all semantic diagnostics. Successful checks reuse one bounded warm worker (30-second idle timeout and 250-use cap); timeout, cancellation, or worker failure terminates that worker before request settlement. QuickJS is the only guest runtime. It exposes immutable `payloads` and the documented provider bridge, but no timers, host imports, process, environment, filesystem, shell, or direct network. Source, input, transpiled output, nested values, logs, final output, memory, and time each have independent bounds.

Code Mode is mandatory whenever work is routed through Fabric. The Power does not intercept operations that the product contract leaves to Kiro native tools. Provider composition and bounded data transformation use `fabric_exec`; ordinary native file/edit/system operations remain outside the Power rather than being reimplemented by a hidden bypass.

The effective guest deadline is:

```text
min(configuredMaximum, max(executorDefault, exactActionFloor, invocationTimeout))
```

Action floors use exact provider/action references. For `mcp.$call`, the floor reserves the configured shared discovery/invocation budget, at most two approval windows, and cleanup grace; the configured guest maximum remains the hard cap. The outer MCP request deadline adds a bounded shutdown margin. Cancellation interrupts QuickJS, reaches provider calls, closes a contacted federated MCP server before provider settlement, and drains active leases before runtime replacement or shutdown settles.

## Trust and persistence boundaries

Workspace roots are canonicalized and bound to filesystem identity. Multiple client roots require explicit selection; manual attachment requires MCP elicitation bound to dev/inode/ctime; transient inspection failures fail closed without silently detaching. Runtime replacement drains the old workspace runtime.

All Fabric-owned Power data is under private `PLUGIN_DATA` paths. Configuration must be a current-user, non-symlink, single-link private regular file and is read through the verified descriptor. Memory uses ownership markers, canonical namespace confinement, atomic replacement, and a cross-process mutation lock. Workspace state validates persisted documents, enforces value/document quotas, and serializes cross-process mutation with an identity-checked lock. Artifacts enforce TTL on reads and writes; old crash residue is reclaimed at startup and unknown artifact-root entries fail closed.

Approval occurs in `ActionRegistry` before provider invocation and is bound to the exact provider, action, arguments, risk, and workspace. Network calls require network approval. Configured stdio MCP calls additionally require a separate execute approval before a process can start. Discovery is static and does not contact external servers.

## Components and dependency direction

- `kernel/` owns only the strict top-level tool contract.
- `runtime/` owns compilation, source maps, JSON budgets, and QuickJS confinement.
- `core/action-registry.ts` owns schema checks, approval-before-side-effect ordering, overlap control, and provider leases.
- `providers/` contains the workspace-state provider.
- `kiro/` owns Kiro MCP adaptation, workspace binding, private data paths, projection, memory/artifacts, and configured MCP federation.
- `scripts/` owns build, package validation/export, certification, SBOM, and release evidence.

Dependencies point from the Kiro adapter toward the registry/kernel/runtime and from the registry toward provider interfaces. Providers do not depend on MCP transport or release scripts. Build and release scripts inspect runtime artifacts but are never reachable from the Power entrypoint. Narrow test seams are constructor/source interfaces (`runtimeFactory`, `prepareRuntime`, workspace source/elicitor); production does not select implementation modes.

## Measured deletion result

The pre-deletion measurements are retained in `docs/architecture/power-reachability-baseline.json`. Using the same final-logical-line method, the Power graph fell from 104 source files / 27,768 lines to 30 / 4,684 (71.2% fewer files and 83.1% fewer lines). The full `src/` tree fell from 315 files / 99,457 lines to 33 / 4,784 (89.5% fewer files and 95.2% fewer lines). The built closure fell from 91 files / 14,228,778 bytes to 76 / 13,329,871 (16.5% fewer files and 6.3% fewer bytes). The current graph contains 13 checked-kernel, 6 mounted-provider, and 11 Power-runtime source modules. These measured reachability results, not filenames alone, are the deletion authority.

See `docs/audit.md` for the final file-by-file responsibility and Code Mode assessment.
