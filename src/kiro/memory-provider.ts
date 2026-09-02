import { createHash } from "node:crypto";
import fs from "node:fs";
import { throwIfAborted } from "../async-settlement.js";
import type { FabricActionDescriptor, FabricInvocationContext, FabricProvider } from "../protocol.js";
import { openKiroMemory, type KiroMemoryBinding } from "./memory.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
const KEY_MAX = 512;
const QUERY_MAX = 2_000;
const descriptors: FabricActionDescriptor[] = [
  { name: "get", description: "Read one value from Power-scoped workspace memory", inputSchema: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: KEY_MAX } }, required: ["key"], additionalProperties: false }, risk: "read", effect: { kind: "read" } },
  { name: "set", description: "Persist one bounded JSON value in Power-scoped workspace memory", inputSchema: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: KEY_MAX }, value: {} }, required: ["key", "value"], additionalProperties: false }, risk: "write", effect: { kind: "write" } },
  { name: "delete", description: "Delete one Power-scoped workspace memory value after destructive approval", inputSchema: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: KEY_MAX } }, required: ["key"], additionalProperties: false }, risk: "write", effect: { kind: "write" } },
  { name: "search", description: "Search Power-scoped workspace memory with bounded ranked results", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: QUERY_MAX }, limit: { type: "integer", minimum: 1, maximum: 32 } }, required: ["query"], additionalProperties: false }, risk: "read", effect: { kind: "read" } },
  { name: "index", description: "List bounded memory metadata without values", inputSchema: { type: "object", properties: {}, additionalProperties: false }, risk: "read", effect: { kind: "read" } },
];

export class KiroMemoryProvider implements FabricProvider {
  readonly name = "memory";
  readonly description = "Private workspace-scoped Power memory";
  readonly #root: string;
  readonly #namespace: string;
  readonly #maxEntries: number;
  readonly #maxValueChars: number;
  #binding?: KiroMemoryBinding<JsonValue>;
  constructor(options: { cwd: string; root: string; maxEntries: number; maxValueChars: number }) {
    this.#root = options.root;
    const canonicalWorkspace = fs.realpathSync(options.cwd);
    // Retain the v2 namespace exactly so verified workspace-generation
    // migration preserves compatible memory entries without copying them.
    this.#namespace = `project:${createHash("sha256").update(canonicalWorkspace).digest("hex")}`;
    this.#maxEntries = options.maxEntries;
    this.#maxValueChars = options.maxValueChars;
  }
  #memory(): KiroMemoryBinding<JsonValue> {
    return this.#binding ??= openKiroMemory<JsonValue>(this.#namespace, this.#root, {
      maxEntries: this.#maxEntries,
      maxValueChars: this.#maxValueChars,
    });
  }
  async list(): Promise<FabricActionDescriptor[]> { return descriptors; }
  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> { return descriptors.find((entry) => entry.name === actionName); }
  effectResources(_action: string, args: Record<string, unknown>): readonly string[] { return typeof args.key === "string" ? [`memory:${args.key}`] : ["memory:index"]; }
  async invoke(actionName: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    throwIfAborted(context.signal);
    const memory = this.#memory();
    if (actionName === "get") return (await memory.get(args.key as string)) ?? { key: args.key, found: false };
    if (actionName === "set") return memory.set(args.key as string, args.value as JsonValue, context.signal);
    if (actionName === "delete") return memory.delete(args.key as string, context.signal);
    if (actionName === "search") return memory.search(args.query as string, typeof args.limit === "number" ? args.limit : 8);
    if (actionName === "index") return memory.index();
    throw new Error(`Unknown memory action: ${actionName}`);
  }
}
