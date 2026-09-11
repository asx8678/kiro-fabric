export type CatalogMethod = "tools.listPage" | "tools.searchPage" | "tools.describePage" | "mcp.toolsPage" | "mcp.describePage";
export interface CatalogPageOptions { limit?: number; maxBytes?: number }
export interface CatalogContinuation extends CatalogPageOptions { cursor: string }
export interface CatalogPage<T> {
  items: Array<{ descriptor: T } | { descriptorDigest: string; descriptorCursor: string }>;
  total: number; returned: number; complete: boolean; nextCursor?: string;
}
export interface DescriptorJsonPage {
  text: string; encoding: "json"; totalChars: number; descriptorDigest: string; complete: boolean; nextCursor?: string;
}
export interface CatalogBinding {
  clientSession: string; runtimeNonce: string; workspace: string; device: string; inode: string; authorizationEpoch: string;
}
export interface CatalogReservation {
  publish(method: CatalogMethod, descriptors: readonly unknown[], query?: string): string;
  release(): void;
}
const catalogResults = new WeakMap<object, "mcp.toolsPage" | "mcp.describePage">();
export const markCatalogResult = <T extends object>(value: T, method: "mcp.toolsPage" | "mcp.describePage"): T => { catalogResults.set(value, method); return value; };
export const catalogResultMethod = (value: unknown): "mcp.toolsPage" | "mcp.describePage" | undefined => typeof value === "object" && value !== null ? catalogResults.get(value) : undefined;
