import path from "node:path";
import type { FabricActionEffect } from "../protocol.js";

export type FabricEffectConflictReason = "shared_resource" | "unknown_resource";

const FILE_MUTATION_ACTIONS = new Set(["write", "edit", "commit"]);

const reasonText = (reason: FabricEffectConflictReason): string =>
  reason === "unknown_resource"
    ? "unknown resource footprint; declare resources and ordering"
    : "shared noncommutative resource";

export const formatFabricEffectConflict = (
  target: string,
  resources: readonly string[],
  reason: FabricEffectConflictReason,
): string => `${target} [${resources.join(", ")}] (${reasonText(reason)})`;

const addFileResource = (resources: string[], cwd: string, value: unknown): void => {
  if (typeof value !== "string" || value.length === 0) return;
  resources.push(`file:${path.resolve(cwd, value)}`.slice(0, 256));
};

/** Path resources for write/edit/commit so overlapping mutations conflict. */
const fileMutationResources = (
  actionName: string,
  args: Record<string, unknown>,
  cwd: string,
): string[] => {
  if (!FILE_MUTATION_ACTIONS.has(actionName)) return [];
  const resources: string[] = [];
  addFileResource(resources, cwd, args.path);
  if (Array.isArray(args.operations)) {
    for (const operation of args.operations) {
      if (operation && typeof operation === "object" && !Array.isArray(operation)) {
        addFileResource(resources, cwd, (operation as { path?: unknown }).path);
      }
    }
  }
  return [...new Set(resources)].slice(0, 64);
};

export const refineActionEffect = (
  effect: FabricActionEffect,
  actionName: string,
  args: Record<string, unknown>,
  cwd: string,
): FabricActionEffect => {
  if (effect.kind === "none") return effect;
  const extra = fileMutationResources(actionName, args, cwd);
  if (extra.length === 0) return effect;
  return {
    ...effect,
    resources: [...new Set([...(effect.resources ?? []), ...extra])].slice(0, 64),
    ordering: effect.ordering === "commutative" ? "ordered" : (effect.ordering ?? "ordered"),
  };
};
