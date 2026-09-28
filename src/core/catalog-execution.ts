import { CatalogSnapshotStore } from "./catalog-snapshot-store.js";
import { catalogResultDependencies, type CatalogMethod, type CatalogPageOptions, type CatalogReservation } from "./catalog-contract.js";
import { FabricRepairError } from "./repair-error.js";
import { fabricJsonText, MAX_FABRIC_JSON_CHARS } from "../runtime/json-budget.js";

export const catalogUnavailable = (): FabricRepairError => new FabricRepairError("Catalog cursor unavailable; explicitly reopen discovery in an authorized runtime", {
  code: "catalog_cursor_unavailable", phase: "discovery", dispatchState: "not_dispatched", effectOutcome: "none",
});
const catalogMethods = new Map<string, CatalogMethod>([
  ["fabric.listPage", "tools.listPage"], ["fabric.searchPage", "tools.searchPage"], ["fabric.describePage", "tools.describePage"],
  ["mcp.$toolsPage", "mcp.toolsPage"], ["mcp.$describePage", "mcp.describePage"],
]);
export const catalogMethodForBridge = (ref: string): CatalogMethod | undefined => catalogMethods.get(ref);
export const validateCatalogRequest = (method: CatalogMethod, args: Record<string, unknown>): void => {
  const describe = method.endsWith("describePage");
  const selectors = Object.hasOwn(args, "cursor") ? ["cursor"]
    : method === "tools.searchPage" ? ["query"] : method === "tools.describePage" ? ["ref"]
    : method === "mcp.describePage" ? ["server", "tool"] : method === "mcp.toolsPage" ? ["server"] : [];
  const allowed = [...selectors, "maxBytes", ...(describe ? [] : ["limit"])];
  if (Object.keys(args).some(key => !allowed.includes(key)) || selectors.some(key => typeof args[key] !== "string" || !(args[key] as string).length)) {
    throw new Error("Catalog initial selectors and cursor are mutually exclusive and require exact string selectors");
  }
  if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || (args.limit as number) < 1 || (args.limit as number) > 100)) throw new Error("Catalog limit must be a positive safe integer at most 100");
  if (args.maxBytes !== undefined && (!Number.isSafeInteger(args.maxBytes) || (args.maxBytes as number) < 1000 || (args.maxBytes as number) > 2_000_000)) throw new FabricRepairError("Catalog maxBytes must be a safe integer from 1000 to 2000000", { code: "catalog_page_budget", phase: "validation", dispatchState: "not_dispatched", effectOutcome: "none" });
};
export const continueCatalog = (store: CatalogSnapshotStore, method: CatalogMethod, cursor: string, options: CatalogPageOptions, maxChars: number): unknown => {
  if (store.method(cursor) !== method) throw catalogUnavailable();
  return method.endsWith("describePage") ? store.describePage(cursor, options, maxChars) : store.catalogPage(cursor, options, maxChars);
};
export const publishCatalog = (
  store: CatalogSnapshotStore | undefined, reservation: CatalogReservation | undefined,
  method: CatalogMethod, value: unknown, maxChars: number,
  page?: CatalogPageOptions, query?: string,
): unknown => {
  // Check both pre-discovery revocation tickets and the inventory epoch captured
  // by the provider after its own successful discovery, even for legacy values.
  reservation?.depend(catalogResultDependencies(value));
  // Small legacy values retain their exact array/object shapes. Formatting cannot
  // replay a provider; oversized values become authenticated continuation errors.
  if (!page) {
    try { if (fabricJsonText(value, MAX_FABRIC_JSON_CHARS).length <= maxChars) return value; }
    catch { /* The store validates raw descriptors before retaining any snapshot. */ }
  }
  if (!store || !reservation) throw catalogUnavailable();
  const descriptors = method.endsWith("describePage") ? [value] : value;
  if (!Array.isArray(descriptors)) throw new Error("Catalog operation requires a descriptor array");
  const cursor = reservation.publish(method, descriptors, query);
  if (page) return continueCatalog(store, method, cursor, page, maxChars);
  throw new FabricRepairError("Catalog requires paging; continue with the host-issued method and cursor", {
    code: "catalog_requires_paging", phase: "discovery", dispatchState: "not_dispatched", effectOutcome: "none",
    catalogContinuation: { method, cursor },
  });
};
