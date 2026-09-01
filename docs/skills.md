# Managed Kiro skills

Kiro Fabric ships a small, verification-first skill surface. The hierarchy is
core-first and user-opt-in; skill packaging is not a filesystem authorization
boundary.

## Shipped skills

Managed Kiro ships exactly one routable skill, `fabric-exec`. Its main
`SKILL.md` contains the exact managed API boundary: bounded `k.*` tools,
discovery, optional MCP/memory, and optional Kiro ACP children.

Detailed paths are progressive references beneath
`fabric-exec/references/`. The main skill loads only the relevant file:

- `mcp.md` for configured MCP federation;
- `agents.md` for explicitly enabled Kiro ACP children;
- `workflow.md` for an explicitly requested, already partitioned workflow;
- `review.md` for an explicitly requested two-lane Fabric review;
- `guide.md` when choosing a Fabric path without executing it.

The workflow, review, and guide references are not separate skills and must
not activate for ordinary implementation or review requests that did not ask
to use Fabric. This keeps router context small while preserving exact examples
on demand.

## Deliberately unavailable

Managed Kiro does not expose Pi extension capture, Pi/Claude/Veda runners,
persistent actors, peers, mesh/state, schema transactions, components,
worktrees, transcript compaction, durable residency, fusion/council panels, or
the global `agent()` workflow helper. Skills that depend on those surfaces are
not included in the package.

The optional `agents.*` provider is session-local, Kiro-only, non-recursive,
and capped at four children. Its usage is explicitly unavailable; the adapter
does not present token or cost accounting for Kiro ACP children.
