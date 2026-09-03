export const fabricGuestDeclarations = `
type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type EmptyArgs = Record<string, never>;
interface FabricActionSummary { ref: string; provider: string; name: string; description: string; risk: "read" | "write" | "execute" | "network"; inputSchema: JsonObject; }
interface FabricTools {
  providers(): Promise<Array<{ name: string; description: string; available: boolean; reason?: string }>>;
  list(): Promise<FabricActionSummary[]>;
  search(input: string | { query: string; limit?: number }): Promise<FabricActionSummary[]>;
  describe(input: string | { ref: string }): Promise<FabricActionSummary>;
  call(input: { ref: string; args?: JsonObject }): Promise<JsonValue>;
}
declare const tools: Readonly<FabricTools>;
declare const payloads: Readonly<Record<string, string>>;
declare const artifacts: Readonly<{ read(args: { id: string; offset?: number; limit?: number }): Promise<JsonValue> }>;
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
declare const mcp: Readonly<{
  servers(args?: EmptyArgs): Promise<JsonValue>;
  call(args: { server: string; tool: string; args?: JsonObject }): Promise<JsonValue>;
}>;
declare function print(...values: unknown[]): void;
`;
