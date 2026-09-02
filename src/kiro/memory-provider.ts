import { createHash } from "node:crypto";
import fs from "node:fs";
import { throwIfAbortedOrExpired } from "../async-settlement.js";
import type { FabricActionDescriptor, FabricInvocationContext, FabricProvider } from "../protocol.js";
import { normalizeKiroMemoryToken, openKiroMemory, type KiroMemoryBinding } from "./memory.js";

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
  constructor(options: { cwd: string; root: string; namespace?: string; maxEntries: number; maxValueChars: number }) {
    this.#root = options.root;
    const canonicalWorkspace = fs.realpathSync(options.cwd);
    this.#namespace = options.namespace ?? `project:${createHash("sha256").update(canonicalWorkspace).digest("hex")}`;
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
  prepareArguments(actionName: string, args: Record<string, unknown>): Record<string, unknown> {
    if (["get", "set", "delete"].includes(actionName) && typeof args.key === "string") {
      args.key = normalizeKiroMemoryToken(args.key, "key");
    }
    if (actionName === "search" && typeof args.query === "string") {
      args.query = normalizeKiroMemoryToken(args.query, "query");
      if (args.limit === undefined) args.limit = 8;
    }
    if (actionName === "set" && Object.hasOwn(args, "value")) {
      const encoded = JSON.stringify(args.value);
      if (encoded === undefined) throw new TypeError("Kiro memory values must be JSON-serializable");
      if (encoded.length > this.#maxValueChars) throw new Error(`Kiro memory value exceeds ${this.#maxValueChars} configured characters`);
      args.value = JSON.parse(encoded) as JsonValue;
    }
    return args;
  }
  effectResources(_action: string, args: Record<string, unknown>): readonly string[] { return typeof args.key === "string" ? [`memory:${args.key}`] : ["memory:index"]; }
  async invoke(actionName: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    throwIfAbortedOrExpired(context.signal, context.deadline);
    const memory = this.#memory();
    if (actionName === "get") return (await memory.get(args.key as string)) ?? { key: args.key, found: false };
    const beforeCommit = () => throwIfAbortedOrExpired(context.signal, context.deadline);
    if (actionName === "set") return memory.set(args.key as string, args.value as JsonValue, context.signal, beforeCommit);
    if (actionName === "delete") return memory.delete(args.key as string, context.signal, beforeCommit);
    if (actionName === "search") return memory.search(args.query as string, typeof args.limit === "number" ? args.limit : 8);
    if (actionName === "index") return memory.index();
    throw new Error(`Unknown memory action: ${actionName}`);
  }
}
