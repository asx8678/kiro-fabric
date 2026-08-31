import type { FabricMcpConfig } from "../config.js";
import type {
  FabricApprovalLease,
  FabricApprovalScope,
} from "../core/session-approvals.js";
import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderListRequest,
} from "../protocol.js";
import { McpProvider } from "../providers/mcp-provider.js";

const descriptors: FabricActionDescriptor[] = [
  {
    name: "$servers",
    description: "List MCP servers configured for this project without connecting to them",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    risk: "read",
    namespace: "management",
  },
  {
    name: "$call",
    description:
      "Call one configured MCP tool after network approval; stdio servers also require execute approval",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", minLength: 1 },
        tool: { type: "string", minLength: 1 },
        args: { type: "object", additionalProperties: true },
      },
      required: ["server", "tool"],
      additionalProperties: false,
    },
    risk: "network",
    namespace: "management",
  },
];

/**
 * Kiro-safe MCP federation facade. Dynamic descriptor discovery in the shared
 * provider can start a stdio server while resolving an action, before the
 * action's approval gate. Managed Kiro therefore exposes only the statically
 * described management call: approval happens first, and discovery/contact
 * occurs inside invoke. Background revalidation and dynamic registration are
 * disabled as well.
 */
export class KiroMcpProvider implements FabricProvider {
  readonly name = "mcp";
  readonly description =
    "On-demand calls to explicitly configured MCP servers (no background contact or dynamic registration)";
  readonly #delegate: McpProvider;

  constructor(cwd: string, config: FabricMcpConfig) {
    this.#delegate = new McpProvider(cwd, {
      ...config,
      allowDynamicServers: false,
      cache: {
        ...config.cache,
        // This facade never delegates list/describe, so the legacy metadata
        // path is still approval-safe and avoids the shared cache provider's
        // post-call background revalidation.
        enabled: false,
        revalidate: "off",
      },
    });
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
    if (actionName !== "$servers" && actionName !== "$call") {
      throw new Error(
        "Managed Kiro MCP federation requires mcp.call({ server, tool, args }); dynamic server/tool paths are not exposed",
      );
    }
    if (actionName === "$call") {
      if (typeof args.server !== "string" || args.server.trim().length === 0) {
        throw new TypeError("mcp.call server must be a non-empty string");
      }
      if (typeof args.tool !== "string" || args.tool.trim().length === 0) {
        throw new TypeError("mcp.call tool must be a non-empty string");
      }
      if (args.args !== undefined && (typeof args.args !== "object" || args.args === null || Array.isArray(args.args))) {
        throw new TypeError("mcp.call args must be an object when provided");
      }
      const server = args.server;
      const transport = await this.#delegate.configuredServerTransport(server);
      if (!transport) {
        throw new Error(`Unknown or unsupported configured MCP server: ${server}`);
      }
      if (transport === "stdio") {
        const approval = context as FabricInvocationContext & {
          approve?: (
            action: FabricActionDescriptor & { ref: string; provider: string },
            approvedArgs: Record<string, unknown>,
            scope?: FabricApprovalScope,
          ) => Promise<FabricApprovalLease>;
          approvalScope?: FabricApprovalScope;
        };
        if (!approval.approve) {
          throw new Error("stdio MCP execution approval is unavailable; refusing to start server");
        }
        const stdioAction = {
          name: "$stdio",
          ref: "mcp.$stdio",
          provider: "mcp",
          description: "Start a configured stdio MCP server executable",
          inputSchema: descriptors[1]!.inputSchema,
          risk: "execute",
          namespace: "management",
        } as const;
        const lease = await approval.approve(stdioAction, args, approval.approvalScope);
        lease.consume(stdioAction, args, approval.approvalScope);
      }
    }
    return this.#delegate.invoke(actionName, args, context);
  }

  async close(): Promise<void> {
    await this.#delegate.close();
  }
}
