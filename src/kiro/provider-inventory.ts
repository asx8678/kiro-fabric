import type { FabricProviderRequirements } from "../protocol.js";

/**
 * One entry in the current runtime provider inventory. This is documentation
 * and a consistency contract, never an authorization list. Trusted registry
 * invocation guards enforce authority; `providers()` reports availability.
 * Guest-visible descriptors do not grant authority.
 */
export interface FabricProviderInventoryEntry {
  /** Runtime provider name as registered or marked unavailable by createKiroRuntime. */
  readonly name: string;
  /** Human-facing availability summary; not part of guest-visible authority. */
  readonly description: string;
  /** Requirements when registered; unavailable-provider fallback is registry policy. */
  readonly requirements: Readonly<FabricProviderRequirements>;
}

const entry = (
  name: string,
  description: string,
  requirements: Readonly<FabricProviderRequirements>,
): FabricProviderInventoryEntry =>
  Object.freeze({ name, description, requirements: Object.freeze({ ...requirements }) });

/**
 * The single current supported runtime provider inventory. `createKiroRuntime`
 * mounts a subset of these per configuration and marks the rest unavailable,
 * but the name set is fixed: fabric, local, review, probe, repo, artifacts,
 * mcp, memory, state and continuity.
 *
 * The historical `agent-product.json` `mountedProviders` field is a frozen
 * packaging-era subset retained for byte-exact admission. It is NOT the current
 * runtime inventory; this constant is. Do not add new current fields to that
 * product manifest without a separate reviewed product era.
 */
export const FABRIC_RUNTIME_PROVIDER_INVENTORY: readonly FabricProviderInventoryEntry[] = Object.freeze([
  entry("artifacts", "Retained in-memory artifacts with public checkpoint/read access", {}),
  entry("continuity", "Opt-in durable task checkpoints with explicit host operation capture", { verifiedWorkspace: true }),
  entry("fabric", "Bootstrap help, info and workspace recovery", {}),
  entry("local", "Verified workspace local coding with bounded reads and exact approved effects", { verifiedWorkspace: true, settlement: true }),
  entry("mcp", "Approval-gated calls to explicitly configured MCP servers", { settlement: true }),
  entry("memory", "Private workspace-scoped Fabric memory", { verifiedWorkspace: true }),
  entry("probe", "Explicit approved retained independent probes with declared provenance", { verifiedWorkspace: true, settlement: true }),
  entry("repo", "Native Navigator repository navigation (advisory, not correctness evidence)", { verifiedWorkspace: true, settlement: true }),
  entry("review", "Optional ephemeral review ledger; structural evidence accounting only", { verifiedWorkspace: true, settlement: true }),
  entry("state", "Workspace-bound atomic durable state", { verifiedWorkspace: true }),
]);

/** Current runtime provider names in inventory order. */
export const FABRIC_RUNTIME_PROVIDER_NAMES: readonly string[] = Object.freeze(
  FABRIC_RUNTIME_PROVIDER_INVENTORY.map((item) => item.name),
);

/** Registered-provider requirements, not a replacement for live registry policy. */
export const FABRIC_RUNTIME_PROVIDER_REQUIREMENTS: Readonly<Record<string, Readonly<FabricProviderRequirements>>> = Object.freeze(
  Object.fromEntries(FABRIC_RUNTIME_PROVIDER_INVENTORY.map((item) => [item.name, item.requirements])),
);
