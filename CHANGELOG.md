# Unreleased

- Convert Kiro Fabric from a Power to one native Kiro CLI 3 custom agent with an agent-owned Fabric MCP backend.
- Make the checkout-local `.kiro/agents/kiro-fabric.json` launch Fabric MCP via a cwd-independent wrapper, with skill and steering URIs resolved from the agent file.
- Advertise `fabric_workspace` without a top-level schema combinator while keeping the strict runtime union.
- Warn on install when a leftover Power may duplicate `@fabric`.
- Point CI at `tests/agent-user-install.test.ts` instead of the removed Power install test.

# Changelog

## 0.64.0

- Replaced all prior integration modes with one Kiro Power product.
- Reduced the MCP surface to `fabric_info`, `fabric_workspace`, and `fabric_exec`.
- Kept QuickJS as the sole checked guest runtime and reduced providers to artifacts, memory, state, and configured MCP federation.
- Made staging hermetic and user-folder export an explicit hardened operation.
- Added exact closure graph, digest, SBOM, and release qualification evidence.
- Enforced strict guest API checking, private bounded persistence, cancellation-safe MCP federation, deterministic package policy, and exact real-client evidence binding.
