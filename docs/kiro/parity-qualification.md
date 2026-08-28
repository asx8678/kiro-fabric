# Kiro parity qualification

> Historical Release-D matrix: the recorded real-gate results below target
> Kiro CLI 2.19.1 / engine v2. Current v3 decisions and remaining authenticated
> gates are in [capabilities-2.20.1-v3.md](capabilities-2.20.1-v3.md).

Release-D qualification applies to Node `>=24`, `kiro-cli 2.19.1`, and
`--agent-engine v2`. It is fail-closed and never claims native Kiro transcript
fidelity. The table below mirrors `src/kiro/diagnostics.ts`; that module is the
executable source of truth.

| Capability | Status | Qualified boundary / diagnostic |
|---|---|---|
| MCP federation | `QUALIFIED` | Main mounts only on-demand `mcp.servers()` and approval-gated `mcp.call({ server, tool, args })`. Discovery never contacts servers; dynamic registration, dynamic call paths, and background revalidation are disabled. |
| captured extension tools | `UNAVAILABLE` | `extensions.*` capture requires a live Pi extension runner/catalog, which the standalone Kiro host does not own. |
| schema / components / compact | `UNAVAILABLE` | These require Pi-owned transaction, supervisor, or safe host-compaction commit boundaries; their globals are omitted. |
| mesh | `UNAVAILABLE` | Managed Kiro does not mount `mesh.*` or `state.*`; general mesh semantics remain Pi-owned. |
| memory | `QUALIFIED` | Main mounts lazy `memory.get/set/search/index` over a bounded, manifest-owned store outside the repository. The host fixes the namespace from the canonical project root; guest code cannot select another project. |
| topology | `QUALIFIED` | Explicit writes remain available, and `createKiroTopologyLease()` adds fenced CAS renewal plus ownership-checked cleanup. Nothing publishes automatically. |
| pre-walk trajectory metadata | `UNAVAILABLE` | Evidence helpers exist, but there is no managed Kiro boundary trajectory adapter. |
| semantic handoff | `QUALIFIED` | `agents.run/spawn({ context })` transfers a bounded, delimited semantic packet to the ACP child; envelopes include the normalized packet and stable digest. Native transcript fidelity is explicitly not qualified. |
| agents | `QUALIFIED` | With `--allow-shell --subagents`, Managed Main mounts bounded `agents.*` fan-out: at most four non-recursive Kiro ACP children, each with scoped `k.bash` verification. It remains unavailable by default. |
| workflows | `QUALIFIED` | Runtime-local `workflow.parallel`, `pipeline`, `configure`, `phase`, `item`, `event`, `log`, and `budget` only. `workflow.agent` and top-level `agent` are omitted before execution because ACP usage cannot be accounted. |
| councils | `UNAVAILABLE` | `council` is omitted from declarations and runtime before any child can launch; use direct bounded `agents.*` fan-out. |
| recursion | `UNAVAILABLE` | `rlm.query()` forces the Pi runner. |
| swarm | `UNAVAILABLE` | No managed Kiro swarm adapter or guest API exists. |

## Invariants

- Managed Kiro exposes its core coding tools as `k.*`; the shared/original Pi
  runtime remains `pi.*`.

- `src/kiro/mcp-server.ts:createKiroMcpServer` advertises one model-visible tool:
  `fabric_exec`.
- `src/kiro/host.ts:FabricDenyApprovalFallback` denies whenever approval or MCP
  elicitation is unavailable.
- `src/kiro/handoff.ts` is semantic only; `neverNativeTranscriptOK` remains true.
- `memory.*` is a Kiro-specific project-fact API, not Pi transcript recall.
  Topology leases remain an explicit library API rather than an automatic
  project write, and `mesh.*`/`state.*` stay unavailable.
- `kiroFeatureDiagnostics()` must be updated with this document in the same
  change whenever a status or diagnostic changes.
