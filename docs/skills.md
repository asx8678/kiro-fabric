# Managed Kiro skills

Kiro Fabric ships a small, verification-first skill surface. The hierarchy is
core-first and user-opt-in; skill packaging is not a filesystem authorization
boundary.

## Shipped skills

- `fabric-exec` is the model-visible reference for the exact managed Kiro API:
  bounded `k.*` tools, discovery, optional MCP/memory, and optional Kiro ACP
  children.
- `fabric-workflow` is an explicitly invoked, bounded fan-out across already
  partitioned Kiro ACP work items. It requires `--allow-shell --subagents`.
- `fabric-review` defines a two-lane advisory review using those same optional
  Kiro children.
- `fabric-guide` recommends the smallest of those paths without running it.

Only `fabric-exec` is model-invocable. The other skills require explicit user
invocation and never invoke one another automatically.

## Deliberately unavailable

Managed Kiro does not expose Pi extension capture, Pi/Claude/Veda runners,
persistent actors, peers, mesh/state, schema transactions, components,
worktrees, transcript compaction, durable residency, fusion/council panels, or
the global `agent()` workflow helper. Skills that depend on those surfaces are
not included in the package.

The optional `agents.*` provider is session-local, Kiro-only, non-recursive,
and capped at four children. Its usage is explicitly unavailable; the adapter
does not present token or cost accounting for Kiro ACP children.
