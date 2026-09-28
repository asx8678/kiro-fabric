import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({ servers: [] as Array<{ handlers: Map<unknown, (...args: any[]) => Promise<any>> }> }));
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({ Server: class {
  handlers = new Map<unknown, (...args: any[]) => Promise<any>>();
  constructor() { wire.servers.push(this); }
  setRequestHandler(schema: unknown, handler: (...args: any[]) => Promise<any>) { this.handlers.set(schema, handler); }
  setNotificationHandler(schema: unknown, handler: (...args: any[]) => Promise<any>) { this.handlers.set(schema, handler); }
  getClientCapabilities() { return {}; }
  async connect() {}
  async close() {}
} }));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: class {} }));

import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  KiroPowerWorkspaceBinding,
  kiroPowerWorkspaceRequestSchema,
} from "../src/kiro/power/workspace-binding.js";
import { createKiroMcpServer } from "../src/kiro/mcp-server.js";
import { CachedWorkspaceContextProvider } from "../src/kiro/power/workspace-context.js";
import type { KiroWorkspaceSnapshot, WorkspaceContextProvider } from "../src/kiro/power/workspace-context.js";

const roots: string[] = [];
const temporary = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-workspace-")); roots.push(root); return root; };
afterEach(() => { while (roots.length) removeFixtureSync(roots.pop()!, { recursive: true, force: true }); });
const fixture = () => {
  const root = temporary();
  const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data");
  fs.mkdirSync(pluginRoot); fs.mkdirSync(pluginData);
  return { root, pluginRoot, pluginData, binding: new KiroPowerWorkspaceBinding({ pluginRoot, pluginData }) };
};

type WorkspaceCallResponse = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
const responseText = (response: WorkspaceCallResponse): string => response.content.map((entry) => entry.text).join("");
const responseJson = (response: WorkspaceCallResponse): Record<string, unknown> => {
  expect(response.isError, responseText(response)).not.toBe(true);
  return JSON.parse(responseText(response)) as Record<string, unknown>;
};
const mutableWorkspaceContext = (initial: readonly string[]) => {
  let paths = [...initial];
  const provider: WorkspaceContextProvider = {
    current: async (): Promise<KiroWorkspaceSnapshot> => ({
      revision: 1,
      status: paths.length ? "verified" : "explicitly-empty",
      roots: paths.map((entry) => ({ uri: pathToFileURL(entry).href })),
      observedAt: Date.now(),
    }),
    invalidate() {},
    subscribe: () => ({ dispose() {} }),
  };
  return { provider, set(next: readonly string[]) { paths = [...next]; } };
};
const mountWorkspaceServer = async (options: {
  runtimeRoot: string;
  dataRoot: string;
  context: WorkspaceContextProvider;
  opened: Array<{ close(): Promise<void> }>;
}) => {
  const server = await createKiroMcpServer({
    runtimeRoot: options.runtimeRoot,
    dataRoot: options.dataRoot,
    version: "fixture",
    workspaceContext: options.context,
    prepareRuntime: async () => { throw new Error("workspace-binding fixture must not create a runtime"); },
  });
  options.opened.push(server);
  const handlers = wire.servers.at(-1)!.handlers;
  return {
    call: (args: Record<string, unknown>): Promise<WorkspaceCallResponse> =>
      handlers.get(CallToolRequestSchema)!({ params: { name: "fabric_workspace", arguments: args } }, { signal: new AbortController().signal }),
  };
};

describe("canonical workspace binding", () => {
  it("publishes a strict MCP object schema while preserving action variants", () => {
    expect(Reflect.get(kiroPowerWorkspaceRequestSchema, "type")).toBe("object");
    expect(Value.Check(kiroPowerWorkspaceRequestSchema, { action: "status" })).toBe(true);
    expect(Value.Check(kiroPowerWorkspaceRequestSchema, { action: "select", rootId: "root-1" })).toBe(true);
    expect(Value.Check(kiroPowerWorkspaceRequestSchema, { action: "select" })).toBe(false);
    expect(Value.Check(kiroPowerWorkspaceRequestSchema, { action: "status", rootId: "root-1" })).toBe(false);
  });

  it("turns oversized client root inventories into unavailable context", async () => {
    const context = new CachedWorkspaceContextProvider({
      supported: () => true,
      async load() {
        return Array.from({ length: 129 }, (_, index) => ({
          uri: pathToFileURL(`/workspace-${index}`).href,
        }));
      },
    });
    const snapshot = await context.current();
    expect(snapshot.status).toBe("temporarily-unavailable");
    expect(snapshot.roots).toEqual([]);
    expect(snapshot.error).toContain("count exceeds");
  });

  it("fails closed on ambiguous roots and requires exact selection", async () => {
    const { root, binding } = fixture();
    const a = path.join(root, "a"); const b = path.join(root, "b"); fs.mkdirSync(a); fs.mkdirSync(b);
    binding.updateClientRoots([a, b].map((entry) => ({ uri: pathToFileURL(entry).href })));
    expect(binding.status()).toEqual({ status: "unbound", requiresSelection: true });
    const listed = binding.list();
    await expect(binding.handle({ action: "select", rootId: "unknown" })).rejects.toThrow("unknown workspace rootId");
    await binding.handle({ action: "select", rootId: listed.roots[0]!.rootId });
    expect(binding.status().status).toBe("bound");
  });

  it("detaches a removed root before rebinding", async () => {
    const { root, binding } = fixture();
    const a = path.join(root, "a"); const b = path.join(root, "b"); fs.mkdirSync(a); fs.mkdirSync(b);
    binding.updateClientRoots([{ uri: pathToFileURL(a).href }]);
    expect(binding.boundRoot()).toBe(fs.realpathSync(a));
    binding.updateClientRoots([{ uri: pathToFileURL(b).href }]);
    expect(binding.status().status).toBe("unbound");
  });

  it("fails closed when an advertised parent alias becomes unverifiable", () => {
    if (process.platform === "win32") return;
    const { root, binding } = fixture();
    const parent = path.join(root, "real");
    const workspace = path.join(parent, "workspace");
    const alias = path.join(root, "parent-alias");
    fs.mkdirSync(parent);
    fs.mkdirSync(workspace);
    fs.symlinkSync(parent, alias);
    const advertised = path.join(alias, "workspace");
    binding.updateClientRoots([{ uri: pathToFileURL(advertised).href }]);
    expect(binding.workspaceObservation().status).toBe("verified");

    fs.unlinkSync(alias);
    binding.updateClientRoots([{ uri: pathToFileURL(advertised).href }]);
    expect(binding.workspaceObservation().status).toBe("temporarily-unavailable");
    expect(binding.boundRoot()).toBeUndefined();
  });

  it("rejects final-entry aliases and reserved storage", async () => {
    const { root, pluginRoot, binding } = fixture();
    const workspace = path.join(root, "workspace"); const alias = path.join(root, "alias"); fs.mkdirSync(workspace); fs.symlinkSync(workspace, alias);
    await expect(binding.handle({ action: "attach", path: alias })).rejects.toThrow();
    await expect(binding.handle({ action: "attach", path: pluginRoot })).rejects.toThrow("too broad or reserved");
  });

  it("reserves an explicit non-default Kiro home from workspace selection", async () => {
    const root = temporary();
    const kiroContainer = path.join(root, "custom-kiro-container");
    const kiroHome = path.join(kiroContainer, "home");
    const agents = path.join(kiroHome, "agents");
    const pluginRoot = path.join(root, "runtime");
    const pluginData = path.join(root, "data");
    const workspace = path.join(root, "workspace");
    for (const directory of [kiroContainer, kiroHome, agents, pluginRoot, pluginData, workspace]) fs.mkdirSync(directory);
    const binding = new KiroPowerWorkspaceBinding({ pluginRoot, pluginData, kiroHome });

    binding.updateClientRoots([{ uri: pathToFileURL(agents).href }]);
    expect(binding.list().roots).toEqual([]);
    await expect(binding.handle({ action: "attach", path: agents })).rejects.toThrow("too broad or reserved");

    binding.updateClientRoots([{ uri: pathToFileURL(kiroContainer).href }]);
    expect(binding.list().roots).toEqual([]);
    await expect(binding.handle({ action: "attach", path: kiroContainer })).rejects.toThrow("too broad or reserved");

    binding.updateClientRoots([{ uri: pathToFileURL(workspace).href }]);
    expect(binding.boundRoot()).toBe(fs.realpathSync(workspace));
  });

  it("derives and validates the installed custom Kiro home from Agent storage", async () => {
    const opened: Array<{ close(): Promise<void> }> = [];
    const priorDebug = process.env.KIRO_FABRIC_DEBUG;
    process.env.KIRO_FABRIC_DEBUG = "0";
    const root = temporary();
    const elsewhere = path.join(root, "elsewhere");
    const kiroHome = path.join(elsewhere, ".kiro-custom");
    const installRoot = path.join(kiroHome, "kiro-fabric");
    const installedData = path.join(installRoot, "data");
    const installedRuntime = path.join(installRoot, "app");
    const agents = path.join(kiroHome, "agents");
    const workspace = path.join(root, "workspace");
    const unrelatedRuntime = path.join(root, "unrelated-runtime");
    const libraryData = path.join(root, "library-data");
    for (const directory of [agents, installedData, installedRuntime, workspace, unrelatedRuntime, libraryData]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    try {
      // A mismatched runtime for the same installed data root fails closed on the
      // installed app layout before any server, storage, or trace effect.
      const serversBefore = wire.servers.length;
      await expect(createKiroMcpServer({
        runtimeRoot: unrelatedRuntime,
        dataRoot: installedData,
        version: "fixture",
        prepareRuntime: async () => { throw new Error("workspace-binding fixture must not create a runtime"); },
      })).rejects.toThrow("does not match its app layout");
      expect(wire.servers.length).toBe(serversBefore);
      expect(fs.existsSync(path.join(installedData, "fabric"))).toBe(false);

      // The installed layout infers the custom Kiro home: its agents storage and
      // an ancestor container stay reserved for workspace selection.
      const inferred = mutableWorkspaceContext([agents]);
      const inferredServer = await mountWorkspaceServer({ runtimeRoot: installedRuntime, dataRoot: installedData, context: inferred.provider, opened });
      expect(responseJson(await inferredServer.call({ action: "list" })).roots).toEqual([]);
      const agentsAttach = await inferredServer.call({ action: "attach", path: agents });
      expect(agentsAttach.isError).toBe(true);
      expect(responseText(agentsAttach)).toContain("too broad or reserved");

      inferred.set([elsewhere]);
      expect(responseJson(await inferredServer.call({ action: "list" })).roots).toEqual([]);
      const ancestorAttach = await inferredServer.call({ action: "attach", path: elsewhere });
      expect(ancestorAttach.isError).toBe(true);
      expect(responseText(ancestorAttach)).toContain("too broad or reserved");

      inferred.set([workspace]);
      const bound = responseJson(await inferredServer.call({ action: "list" }));
      expect(bound.status).toBe("bound");
      expect(bound.rootId).toEqual(expect.any(String));
      expect(fs.existsSync(path.join(installedData, "fabric", "traces"))).toBe(false);

      // Unrelated runtime and library data infer no custom home, so an ordinary
      // home-like task path is accepted through the public workspace list.
      const unrelated = mutableWorkspaceContext([agents]);
      const unrelatedServer = await mountWorkspaceServer({ runtimeRoot: unrelatedRuntime, dataRoot: libraryData, context: unrelated.provider, opened });
      const accepted = responseJson(await unrelatedServer.call({ action: "list" }));
      expect(accepted.status).toBe("bound");
      expect(accepted.rootId).toEqual(expect.any(String));
    } finally {
      for (const server of opened.splice(0).reverse()) await server.close();
      if (priorDebug === undefined) delete process.env.KIRO_FABRIC_DEBUG; else process.env.KIRO_FABRIC_DEBUG = priorDebug;
    }
  });
});
