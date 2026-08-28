import fs from "node:fs";
import path from "node:path";
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
    _context: FabricInvocationContext,
  ): Promise<unknown> {
    const memory = this.#memory();
    switch (actionName) {
      case "get":
        return memory.get(String(args.key));
      case "set":
        return memory.set(String(args.key), args.value as KiroMemoryJsonValue);
      case "search":
        return memory.search(
          String(args.query),
          typeof args.limit === "number" ? args.limit : undefined,
        );
      case "index":
        return memory.index();
      default:
        throw new Error(`Unknown managed Kiro memory action: ${actionName}`);
    }
  }

  #memory(): KiroMemoryBinding<KiroMemoryJsonValue> {
    this.#binding ??= openKiroMemory<KiroMemoryJsonValue>(this.#namespace, this.#root);
    return this.#binding;
  }
}
