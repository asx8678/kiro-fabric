# Release

Run `pnpm run check`, `pnpm run agent:archive`, and `pnpm pack --dry-run`. Agent staging, closure, archive, SBOM, and evidence are deterministic and digest-bound. `pnpm run certify:agent:real` is a separate authenticated user-owned Kiro gate; ordinary CI cannot claim it.

A release requires profile validation/listing/selection, `customAgentSelected === true`, `powerActivated === false`, native tool visibility, one three-tool Fabric set, roots and form elicitation, QuickJS execution, persistent memory/state across sessions, denied side effects, and orphan-free shutdown. Kiro binary path/version/digest are recorded before and after. This gate is presently blocked on Kiro CLI 2.21.0's rejection of the preserved workspace schema.
