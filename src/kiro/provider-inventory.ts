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
 * but the name set is fixed: fabric, local, repo, artifacts, mcp, memory and state.
 */
export const FABRIC_RUNTIME_PROVIDER_INVENTORY: readonly FabricProviderInventoryEntry[] = Object.freeze([
  entry("artifacts", "Retained in-memory artifacts with public checkpoint/read access", {}),
  entry("fabric", "Bootstrap help, info and workspace recovery", {}),
  entry("local", "Verified workspace local coding with bounded reads and exact approved effects", { verifiedWorkspace: true, settlement: true }),
  entry("mcp", "Approval-gated calls to explicitly configured MCP servers", { settlement: true }),
  entry("memory", "Private workspace-scoped Fabric memory", { verifiedWorkspace: true }),
  entry("repo", "Native Navigator repository navigation (advisory, not correctness evidence)", { verifiedWorkspace: true, settlement: true }),
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
