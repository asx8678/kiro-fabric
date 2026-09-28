# src/fovea

Native Navigator subsystem for Kiro Fabric.

This directory is the behavior-preserving TypeScript port of `pi-fovea`
(`b594483868d27b7eb37a9b185c59ce812f8a9c01`) with the hosting/state/scheduling/
delivery architecture rewritten for Fabric. See `docs/fovea/architecture.md`.

Implemented responsibilities:

- `core/`            faithful upstream-derived analysis modules (extraction, graph, heat, ranking, impact, sync, protocols)
- `upstream.json`    pinned upstream identity and port metadata
- `host.ts`          lifetime owner/supervisor/coordinator, created once per Fabric MCP host
- `engine-entry.ts`  persistent child entry point
- `engine.ts`        instance-owned engine API
- `engine-process.ts` host-side child client and bounded crash recovery
- `protocol.ts`      bounded versioned private IPC contracts
- `engine.ts` / `core/context.ts` conversation/navigation/sync state (explicit owners, not module globals)
- `root-leases.ts`   authorized roots and revocation epochs
- `source-access.ts` approved enumeration and source snapshots (SHA-256 bound)
- `parser-executable.ts` managed ast-grep descriptor validation and launch
- `scheduler.ts`     admission, ordering, cancellation, refresh, coalescing
- `observations.ts`  compact trusted host-operation events
- `delivery.ts`      result/context preparation and emission state
- `result-store.ts`  immutable bounded packets and continuations
- `config.ts`        separate versioned Navigator configuration
- `host.ts` / `engine-process.ts` sanitized health and recovery status
- `provenance-journal.ts` bounded worktree-scoped committed transitions; no private navigation sharing

Invariants: no Pi agent/TUI/extension-runner dependency in the installed
runtime; one persistent analysis child per Fabric host; no engine construction
inside `invoke()`, the `fabric_exec` handler, QuickJS setup, or per-event hook
clients; mutable state never lives inside an immutable runtime generation.
