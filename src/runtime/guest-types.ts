import { REPO_GUEST_DECLARATIONS } from "../providers/repo-contract.js";
import { LOCAL_GUEST_DECLARATIONS } from "../providers/local-contract.js";
import { REVIEW_GUEST_DECLARATIONS } from "../providers/review-contract.js";
import { PROBE_GUEST_DECLARATIONS } from "../providers/probe-contract.js";
import { CONTINUITY_GUEST_DECLARATIONS } from "../providers/continuity-contract.js";

export const fabricGuestDeclarations = `
${LOCAL_GUEST_DECLARATIONS}
${REPO_GUEST_DECLARATIONS}
${REVIEW_GUEST_DECLARATIONS}
${PROBE_GUEST_DECLARATIONS}
${CONTINUITY_GUEST_DECLARATIONS}
type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type FabricCheckpointHandle = { id: string; label?: string };
type FabricFailureMetadata = {
  code: "invalid_arguments" | "stale_descriptor" | "timeout" | "provider_error" | "catalog_requires_paging" | "catalog_cursor_unavailable" | "catalog_quota_exceeded" | "catalog_page_budget" | "quota_exceeded" | "approval_denied";
  catalogContinuation?: { method: CatalogMethod; cursor: string };
  phase: "compile" | "validation" | "discovery" | "dispatch" | "execution";
  dispatchState: "not_dispatched" | "dispatched";
  effectOutcome: "none" | "uncertain";
  ref?: string; descriptorDigest?: string; invalidPath?: string;
  relevantSchema?: JsonObject; replacementDescriptor?: JsonObject; checkpoints?: FabricCheckpointHandle[];
};
/** Host-issued, bounded repair hints. Not complete schemas or permission to retry effects. */
interface Error { readonly failure?: FabricFailureMetadata }
type KiroArtifactReadResult = { id: string; text: string; offset: number; nextOffset: number; totalChars: number; done: boolean };
type KiroArtifactCheckpointResult = { id: string; retrieval: { ref: "artifacts.read"; args: { id: string }; encoding: "json"; ephemeral: true } };
type EmptyArgs = Record<string, never>;
type FabricActionSummary = {
  freshness?: "observed";
  ref: string;
  provider: string;
  name: string;
  description: string;
  descriptorDigest: string;
  risk: "read" | "write" | "execute" | "network";
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  namespace?: string;
  effect?: { kind: "none" | "read" | "write" | "emission"; resources?: string[] };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}
type CatalogMethod = "tools.listPage" | "tools.searchPage" | "tools.describePage" | "mcp.toolsPage" | "mcp.describePage";
type CatalogPageOptions = { limit?: number; maxBytes?: number };
type CatalogContinuation = CatalogPageOptions & { cursor: string };
type CatalogPage<T> = { items: Array<{ descriptor: T } | { descriptorDigest: string; descriptorCursor: string }>; total: number; returned: number; complete: boolean; nextCursor?: string };
type DescriptorJsonPage = { text: string; encoding: "json"; totalChars: number; descriptorDigest: string; complete: boolean; nextCursor?: string };
interface FabricTools {
  providers(): Promise<Array<{ name: string; description: string; available: boolean; reason?: string }>>;
  list(): Promise<FabricActionSummary[]>;
  search(input: string | { query: string; limit?: number }): Promise<FabricActionSummary[]>;
  describe(input: string | { ref: string }): Promise<FabricActionSummary>;
  listPage(input?: CatalogPageOptions | CatalogContinuation): Promise<CatalogPage<FabricActionSummary>>;
  searchPage(input: ({ query: string } & CatalogPageOptions) | CatalogContinuation): Promise<CatalogPage<FabricActionSummary>>;
  describePage(input: { ref: string; maxBytes?: number } | { cursor: string; maxBytes?: number }): Promise<DescriptorJsonPage>;
  /** Digest/projection are only supported for canonical remote refs. */
  call(input: { ref: string; args?: JsonObject; expectedDescriptorDigest?: string; projection?: "full" | "text" | "structured" }): Promise<JsonValue>;
}
declare const tools: Readonly<FabricTools>;
type FabricWorkspaceRequest =
  | { action: "status" | "list" | "detach" }
  | { action: "select"; rootId: string }
  | { action: "attach"; path: string };
declare const fabric: Readonly<{
  info(): Promise<JsonObject>;
  help(args: { topic: "overview" | "api" | "skill" | "guide" | "recipes" | "workflow" | "review"; offset?: number; limit?: number }): Promise<{ topic: string; text: string; truncated: boolean; nextOffset?: number }>;
  workspace(args: FabricWorkspaceRequest): Promise<JsonObject>;
}>;
declare const payloads: Readonly<Record<string, string>>;
declare const artifacts: Readonly<{
  /** UTF-16 cursors; escaped-envelope-aware pages. Advance only to nextOffset; done means EOF. */
  read(args: { id: string; offset?: number; limit?: number }): Promise<KiroArtifactReadResult>;
  /** Explicit chosen JSON evidence, in memory with TTL/quotas; normal write approval and at most 8 reservations per execution. */
  checkpoint(args: { value: JsonValue; label?: string }): Promise<KiroArtifactCheckpointResult>;
}>;
declare const memory: Readonly<{
  get(args: { key: string }): Promise<JsonValue>;
  set(args: { key: string; value: JsonValue }): Promise<JsonValue>;
  delete(args: { key: string }): Promise<JsonValue>;
  search(args: { query: string; limit?: number }): Promise<JsonValue>;
  index(args?: EmptyArgs): Promise<JsonValue>;
}>;
declare const state: Readonly<{
  get(args: { key: string }): Promise<JsonValue>;
  set(args: { key: string; value: JsonValue; expectedRevision?: number }): Promise<JsonValue>;
  list(args?: { limit?: number }): Promise<JsonValue>;
  delete(args: { key: string; expectedRevision?: number }): Promise<JsonValue>;
}>;
type WebSearchResult = { title: string; url: string; snippet: string };
type WebSearchOutput = { source: "google" | "bing"; query: string; results: WebSearchResult[] };
type WebOpenOutput = { url: string; finalUrl: string; title: string; text: string; chars: number; truncated: boolean; selector: string };
declare const web: Readonly<{
  search(args: { query: string; limit?: number }): Promise<WebSearchOutput>;
  open(args: { url: string; selector?: string; wait?: "networkIdle" | "almostIdle" | "load"; settleMs?: number; maxChars?: number }): Promise<WebOpenOutput>;
}>;
type FabricMcpToolSummary = {
  server: string;
  name: string;
  ref: string;
  description: string;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  descriptorDigest: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  freshness: "observed";
  transport: { kind: "stdio" | "http"; digest: string; configDigest: string | null };
}
declare const mcp: Readonly<{
  servers(args?: EmptyArgs): Promise<JsonValue>;
  tools(args: { server: string }): Promise<FabricMcpToolSummary[]>;
  toolsPage(args: ({ server: string } & CatalogPageOptions) | CatalogContinuation): Promise<CatalogPage<FabricMcpToolSummary>>;
  describePage(args: { server: string; tool: string; maxBytes?: number } | { cursor: string; maxBytes?: number }): Promise<DescriptorJsonPage>;
  describe(args: { server: string; tool: string }): Promise<FabricMcpToolSummary>;
  /** Projection happens before the host/guest bridge. full (default) preserves legacy results; text selects joined text (or ""), structured selects structuredContent (or null). Missing forms are not converted. Errors/approval/schema checks are unchanged. */
  call(args: { server: string; tool: string; args?: JsonObject; expectedDescriptorDigest?: string; projection?: "full" | "text" | "structured" }): Promise<JsonValue>;
}>;
declare function parallel<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R> | R,
  options?: number | { concurrency?: number },
): Promise<R[]>;
declare function parallel<T>(
  tasks: ReadonlyArray<() => Promise<T> | T>,
  options?: number | { concurrency?: number },
): Promise<T[]>;
declare function print(...values: unknown[]): void;
`;
