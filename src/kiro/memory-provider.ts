import fs from "node:fs";
import path from "node:path";
import { throwIfAborted } from "../async-settlement.js";
import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderListRequest,
} from "../protocol.js";
import { sha256Bytes } from "./managed.js";
import {
  openKiroMemory,
  type KiroMemoryBinding,
} from "./memory.js";

type KiroMemoryJsonValue =
  | null
  | boolean
  | number
  | string
  | KiroMemoryJsonValue[]
  | { [key: string]: KiroMemoryJsonValue };

const MAX_KEY_CHARS = 512;
const MAX_QUERY_CHARS = 2_000;

const boundedString = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new TypeError(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
};

const descriptors: FabricActionDescriptor[] = [
  {
    name: "get",
    description: "Read one value from this project's persistent Kiro memory namespace",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string", minLength: 1, maxLength: 512 } },
      required: ["key"],
      additionalProperties: false,
    },
    risk: "read",
    namespace: "kiro-project",
  },
  {
    name: "set",
    description: "Persist one bounded JSON value in this project's Kiro memory namespace",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", minLength: 1, maxLength: 512 },
        value: {},
      },
      required: ["key", "value"],
      additionalProperties: false,
    },
    risk: "write",
    namespace: "kiro-project",
  },
  {
    name: "search",
    description:
      "Search this project's persistent Kiro memory by key and JSON value; results are ranked and bounded",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 2_000 },
        limit: { type: "number", minimum: 1, maximum: 32 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    risk: "read",
    namespace: "kiro-project",
  },
  {
    name: "index",
    description:
      "List bounded metadata for this project's Kiro memory keys without returning stored values",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    risk: "read",
    namespace: "kiro-project",
  },
];

export interface KiroMemoryProviderOptions {
  cwd: string;
  root: string;
}

/**
 * Mounted managed-Kiro memory. The project namespace is fixed by the host and
 * never accepted from guest code, so one repository cannot select another
 * repository's values. Opening is lazy to avoid filesystem writes merely from
 * starting the MCP server.
 */
export class KiroMemoryProvider implements FabricProvider {
  readonly name = "memory";
  readonly description =
    "Project-isolated, bounded persistent memory for managed Kiro sessions";

  readonly #cwd: string;
  readonly #root: string;
  readonly #namespace: string;
  #binding: KiroMemoryBinding<KiroMemoryJsonValue> | undefined;

  constructor(options: KiroMemoryProviderOptions) {
    this.#cwd = fs.realpathSync(options.cwd);
    this.#root = path.resolve(options.root);
    this.#namespace = `project:${sha256Bytes(this.#cwd)}`;
  }

  async list(
    request: FabricProviderListRequest,
    _context: FabricInvocationContext,
  ): Promise<FabricActionDescriptor[]> {
    const query = request.query?.normalize("NFKC").trim().toLowerCase();
    const filtered = query
      ? descriptors.filter((descriptor) =>
          `${descriptor.name} ${descriptor.description}`.toLowerCase().includes(query),
        )
      : descriptors;
    return filtered.slice(0, Math.max(1, Math.min(request.limit ?? 100, 100)));
  }

  async describe(
    actionName: string,
    _context: FabricInvocationContext,
  ): Promise<FabricActionDescriptor | undefined> {
    return descriptors.find((descriptor) => descriptor.name === actionName);
  }

  async invoke(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<unknown> {
    throwIfAborted(context.signal);
    let operation: Promise<unknown>;
    switch (actionName) {
      case "get": {
        const key = boundedString(args.key, "memory.get key", MAX_KEY_CHARS);
        operation = this.#memory().get(key);
        break;
      }
      case "set": {
        const key = boundedString(args.key, "memory.set key", MAX_KEY_CHARS);
        operation = this.#memory().set(key, args.value as KiroMemoryJsonValue, context.signal);
        break;
      }
      case "search": {
        const query = boundedString(args.query, "memory.search query", MAX_QUERY_CHARS);
        operation = this.#memory().search(
          query,
          typeof args.limit === "number" ? Math.max(1, Math.min(Math.floor(args.limit), 32)) : undefined,
        );
        break;
      }
      case "index":
        operation = this.#memory().index();
        break;
      default:
        throw new Error(`Unknown managed Kiro memory action: ${actionName}`);
    }
    const result = await operation;
    throwIfAborted(context.signal);
    return result;
  }

  #memory(): KiroMemoryBinding<KiroMemoryJsonValue> {
    this.#binding ??= openKiroMemory<KiroMemoryJsonValue>(this.#namespace, this.#root);
    return this.#binding;
  }
}
