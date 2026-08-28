import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG, type FabricConfig } from "../src/config.js";
import { createKiroRuntime, type KiroRuntime } from "../src/kiro/runtime.js";

const roots: string[] = [];

const scratch = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-parity-"));
  roots.push(root);
  return root;
};

const config = (): FabricConfig => structuredClone(DEFAULT_FABRIC_CONFIG);

const execute = async (runtime: KiroRuntime, code: string) =>
  runtime.service.execute({
    code,
    signal: undefined,
    parentToolCallId: `kiro-parity-${Date.now()}`,
    host: runtime.host,
    onPartial() {},
  });

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("managed Kiro host-compatible parity providers", () => {
  it("mounts lazy project-isolated memory without dirtying either project", async () => {
    const root = scratch();
    const projectA = path.join(root, "project-a");
    const projectB = path.join(root, "project-b");
    const memoryRoot = path.join(root, "memory");
    fs.mkdirSync(projectA);
    fs.mkdirSync(projectB);

    const runtimeA = createKiroRuntime({ cwd: projectA, memoryRoot });
    const runtimeB = createKiroRuntime({ cwd: projectB, memoryRoot });
    try {
      expect(fs.existsSync(memoryRoot)).toBe(false);
      const stored = await execute(
        runtimeA,
        'return await memory.set({ key: "architecture", value: { decision: "bounded" } });',
      );
      expect(stored.success).toBe(true);
      expect(stored.value).toMatchObject({ key: "architecture", value: { decision: "bounded" } });
      expect(fs.existsSync(memoryRoot)).toBe(true);

      const found = await execute(
        runtimeA,
        'return await memory.search({ query: "bounded", limit: 4 });',
      );
      expect(found.success).toBe(true);
      expect(found.value).toEqual([
        expect.objectContaining({ key: "architecture", value: { decision: "bounded" } }),
      ]);

      const isolated = await execute(
        runtimeB,
        'return await memory.get({ key: "architecture" });',
      );
      expect(isolated).toMatchObject({ success: true, value: null });
      expect(fs.readdirSync(projectA)).toEqual([]);
      expect(fs.readdirSync(projectB)).toEqual([]);
    } finally {
      await runtimeA.close();
      await runtimeB.close();
    }
  });

  it("keeps MCP discovery inert and gates contact before server startup", async () => {
    const root = scratch();
    const project = path.join(root, "project");
    const countFile = path.join(root, "mcp-count.log");
    const configPath = path.join(root, "mcporter.json");
    fs.mkdirSync(project);
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        test: {
          command: process.execPath,
          args: [path.resolve("tests/fixtures/fake-mcp-server.mjs")],
          env: {
            KIRO_FABRIC_MCP_COUNT_FILE: countFile,
            KIRO_FABRIC_MCP_COUNT_LABEL: "test",
          },
        },
      },
      imports: [],
    }));
    const deniedConfig = config();
    deniedConfig.mcp = { ...deniedConfig.mcp, configPath };
    deniedConfig.approvals = { ...deniedConfig.approvals, network: "deny" };
    const runtime = createKiroRuntime({ cwd: project, config: deniedConfig });
    try {
      const providers = await execute(runtime, "return await tools.providers();");
      expect(providers.value).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "mcp" }),
        expect.objectContaining({ name: "memory" }),
      ]));
      expect(fs.existsSync(countFile)).toBe(false);

      const servers = await execute(runtime, "return await mcp.servers();");
      expect(servers.success).toBe(true);
      expect(servers.value).toEqual([
        expect.objectContaining({ name: "test", transport: "stdio" }),
      ]);
      expect(fs.existsSync(countFile)).toBe(false);

      const denied = await execute(
        runtime,
        'return await mcp.call({ server: "test", tool: "echo-value", args: { value: "no" } });',
      );
      expect(denied.success).toBe(false);
      expect(denied.error).toMatch(/requires network approval/i);
      expect(fs.existsSync(countFile)).toBe(false);
    } finally {
      await runtime.close();
    }
  });

  it("contacts a configured MCP server only inside an approved explicit call", async () => {
    const root = scratch();
    const project = path.join(root, "project");
    const countFile = path.join(root, "mcp-count.log");
    const configPath = path.join(root, "mcporter.json");
    fs.mkdirSync(project);
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        test: {
          command: process.execPath,
          args: [path.resolve("tests/fixtures/fake-mcp-server.mjs")],
          env: {
            KIRO_FABRIC_MCP_COUNT_FILE: countFile,
            KIRO_FABRIC_MCP_COUNT_LABEL: "test",
          },
        },
      },
      imports: [],
    }));
    const allowedConfig = config();
    allowedConfig.mcp = { ...allowedConfig.mcp, configPath };
    allowedConfig.approvals = { ...allowedConfig.approvals, network: "allow" };
    const runtime = createKiroRuntime({ cwd: project, config: allowedConfig, allowExecute: true });
    try {
      const called = await execute(
        runtime,
        'return await mcp.call({ server: "test", tool: "echo-value", args: { value: "yes" } });',
      );
      expect(called.success).toBe(true);
      expect(called.value).toMatchObject({ text: "echo:yes" });
      expect(fs.readFileSync(countFile, "utf8").trim().split("\n")).toEqual(["test"]);

      const dynamic = await execute(
        runtime,
        'return await mcp.test.echo_value({ value: "bypass" });',
      );
      expect(dynamic.success).toBe(false);
      expect(dynamic.error).toMatch(/undefined|cannot read property/i);
      expect(fs.readFileSync(countFile, "utf8").trim().split("\n")).toEqual(["test"]);
    } finally {
      await runtime.close();
    }
  });

  it("requires execute approval before starting a configured stdio server", async () => {
    const root = scratch();
    const project = path.join(root, "project");
    const countFile = path.join(root, "mcp-count.log");
    const configPath = path.join(root, "mcporter.json");
    fs.mkdirSync(project);
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        test: {
          command: process.execPath,
          args: [path.resolve("tests/fixtures/fake-mcp-server.mjs")],
          env: { KIRO_FABRIC_MCP_COUNT_FILE: countFile },
        },
      },
      imports: [],
    }));
    const networkAllowed = config();
    networkAllowed.mcp = { ...networkAllowed.mcp, configPath };
    networkAllowed.approvals = {
      ...networkAllowed.approvals,
      network: "allow",
      execute: "allow",
    };
    // Managed Kiro ignores ambient execute=allow without its explicit grant.
    const runtime = createKiroRuntime({ cwd: project, config: networkAllowed });
    try {
      const denied = await execute(
        runtime,
        'return mcp.call({ server: "test", tool: "echo-value", args: { value: "no" } });',
      );
      expect(denied.success).toBe(false);
      expect(denied.error).toMatch(/requires execute approval/i);
      expect(fs.existsSync(countFile)).toBe(false);
    } finally {
      await runtime.close();
    }
  });
});
