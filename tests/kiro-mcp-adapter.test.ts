import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  fabricExecInputSchema,
  fabricExecInputSchemaJson,
  prepareFabricExecArguments,
} from "../src/kernel/fabric-exec-contract.js";
import { createKiroRuntime, type KiroRuntimeOptions } from "../src/kiro/runtime.js";
import { generateKiroProfile, kiroProfilePath, KIRO_CLI_VERSION, KIRO_AGENT_ENGINE } from "../src/kiro/profile.js";
import {
  KIRO_MODEL_OUTPUT_MAX_CHARS,
  projectFabricExecutionText,
} from "../src/kiro/projection.js";
import { FabricDenyApprovalFallback } from "../src/kiro/host.js";
import { KIRO_PROFILE_REQUEST_TIMEOUT_MS } from "../src/kiro/deadlines.js";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { Value } from "typebox/value";

const clientServer = async (
  cwd: string,
  registerProviders?: Parameters<typeof createKiroRuntime>[0]["registerProviders"],
  runtimeOptions: Pick<KiroRuntimeOptions, "config" | "allowExecute"> = {},
) => {
  const runtime = createKiroRuntime({
    cwd,
    ...runtimeOptions,
    ...(registerProviders ? { registerProviders } : {}),
  });
  const artifacts = runtime.artifacts;
  const server = new Server(
    { name: "kiro-fabric", version: "0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "fabric_exec",
        description: "test",
        inputSchema: fabricExecInputSchemaJson() as never,
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const prepared = prepareFabricExecArguments(request.params.arguments ?? {});
    if (!Value.Check(fabricExecInputSchema, prepared)) {
      return {
        content: [{ type: "text" as const, text: "invalid" }],
        isError: true,
      };
    }
    const input = prepared as { code: string };
    const result = await runtime.service.execute({
      code: input.code,
      signal: undefined,
      parentToolCallId: "kiro-test",
      host: runtime.host,
      onPartial() {},
    });
    const projected = await projectFabricExecutionText({
      result,
      code: input.code,
      resultFormat: "auto",
      maxOutputChars: runtime.service.config.executor.maxOutputChars,
      writeArtifact: (content) => Promise.resolve(artifacts.write(content)),
    });
    return {
      content: [{ type: "text" as const, text: projected.text }],
      ...(projected.isError ? { isError: true } : {}),
    };
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  const closeAll = async () => {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    await runtime.close();
    artifacts.close();
  };
  return { client, runtime, server, artifacts, closeAll };
};

describe("Kiro MCP adapter", () => {
  it("advertises exactly one tool with the golden kernel schema", async () => {
    const { client, runtime } = await clientServer(process.cwd());
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(1);
    expect(tools.tools[0]!.name).toBe("fabric_exec");
    // Semantically identical to the PR 3 kernel contract (the MCP transport
    // may reorder JSON keys; deep equality is the correct assertion).
    expect(tools.tools[0]!.inputSchema).toEqual(fabricExecInputSchemaJson());
    await runtime.close();
  });

  it("executes a pure TypeScript call and returns model-facing text", async () => {
    const { client, runtime } = await clientServer(process.cwd());
    const result = await client.callTool({
      name: "fabric_exec",
      arguments: { code: "return 1 + 2;" },
    });
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "3" }]);
    await runtime.close();
  });

  it("caps Kiro model-facing output below the general Fabric limit", async () => {
    const { client, runtime, artifacts } = await clientServer(process.cwd());
    const result = await client.callTool({
      name: "fabric_exec",
      arguments: { code: `return ${JSON.stringify("x".repeat(40_000))};` },
    });
    expect(result.isError).toBeUndefined();
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text.length).toBeLessThanOrEqual(KIRO_MODEL_OUTPUT_MAX_CHARS);
    expect(text).toMatch(/Full output|\.\.\./i);
    await runtime.close();
    artifacts.close();
  });

  it("recovers truncated output through the opaque session artifact store", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-artifact-"));
    try {
      const { client, runtime, server, artifacts } = await clientServer(cwd);
      const result = await client.callTool({
        name: "fabric_exec",
        arguments: { code: `return ${JSON.stringify("x".repeat(40_000))};` },
      });
      expect(result.isError).toBeUndefined();
      const text = (result.content as Array<{ text: string }>)[0]!.text;
      const artifactId = /artifact (ka_[a-f0-9]{48})/m.exec(text)?.[1];
      expect(artifactId).toBeDefined();
      expect(fs.readdirSync(cwd)).not.toContain(".kiro-fabric-artifacts");
      const recovered = await client.callTool({
        name: "fabric_exec",
        arguments: {
          code: `return await k.readArtifact({ id: ${JSON.stringify(artifactId!)} });`,
        },
      });
      expect(recovered.isError).toBeUndefined();
      const recoveredText = (recovered.content as Array<{ text: string }>)[0]!.text;
      expect(recoveredText).toContain("x".repeat(100));
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      await runtime.close();
      artifacts.close();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("returns compact colorized diffs for edits and writes", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-mcp-diff-"));
    fs.writeFileSync(path.join(cwd, "example.ts"), "export const answer = 41;\n");
    const { client, runtime, server } = await clientServer(cwd);
    try {
      const result = await client.callTool({
        name: "fabric_exec",
        arguments: {
          code: [
            'await k.edit({ path: "example.ts", oldText: "answer = 41", newText: "answer = 42" });',
            'await k.write({ path: "created.ts", content: "export const created = true;\\n" });',
            'return "mutations complete";',
          ].join("\n"),
        },
      });
      expect(result.isError).toBeUndefined();
      const text = (result.content as Array<{ text: string }>)[0]!.text;
      expect(text).toContain("mutations complete");
      expect(text).toContain("Changes:");
      expect(text).toContain("\x1b[2mk.edit");
      expect(text).toContain("\x1b[2mk.write");
      expect(text).toContain("\x1b[31m-");
      expect(text).toContain("\x1b[32m+");
      expect(fs.readFileSync(path.join(cwd, "example.ts"), "utf8"))
        .toBe("export const answer = 42;\n");
      expect(fs.readFileSync(path.join(cwd, "created.ts"), "utf8"))
        .toBe("export const created = true;\n");

      const returnedEdit = await client.callTool({
        name: "fabric_exec",
        arguments: {
          code: 'return await k.edit({ path: "example.ts", oldText: "answer = 42", newText: "answer = 43" });',
        },
      });
      const returnedText = (returnedEdit.content as Array<{ text: string }>)[0]!.text;
      expect(returnedEdit.isError).toBeUndefined();
      expect(returnedText).not.toContain("Changes:");
      expect(returnedText).toContain("\x1b[31m-");
      expect(returnedText).toContain("\x1b[32m+");
      expect(fs.readFileSync(path.join(cwd, "example.ts"), "utf8"))
        .toBe("export const answer = 43;\n");
    } finally {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      await runtime.close();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("returns isError for a type error without executing", async () => {
    const { client, runtime } = await clientServer(process.cwd());
    const result = await client.callTool({
      name: "fabric_exec",
      arguments: { code: "return noSuchGlobalAnywhere();" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("Type errors; code was not executed:");
    await runtime.close();
  });

  it("rejects invalid arguments without invoking execution", async () => {
    const { client, runtime } = await clientServer(process.cwd());
    const result = await client.callTool({
      name: "fabric_exec",
      arguments: { tokenBudget: 5 }, // missing required code
    });
    expect(result.isError).toBe(true);
    await runtime.close();
  });

  it("allows k.bash only with the trusted-local execute opt-in", async () => {
    const config = structuredClone(DEFAULT_FABRIC_CONFIG);
    config.approvals.execute = "ask";

    const denied = await clientServer(process.cwd(), undefined, { config });
    const deniedResult = await denied.client.callTool({
      name: "fabric_exec",
      arguments: {
        code: 'const result = await k.bash({ command: "printf trusted-shell-ok" }); return result.output;',
      },
    });
    expect(deniedResult.isError).toBe(true);
    expect((deniedResult.content as Array<{ text: string }>)[0]!.text)
      .toContain("no MCP elicitation");
    await denied.runtime.close();

    const allowed = await clientServer(process.cwd(), undefined, {
      config,
      allowExecute: true,
    });
    const allowedResult = await allowed.client.callTool({
      name: "fabric_exec",
      arguments: {
        code: 'const result = await k.bash({ command: "printf trusted-shell-ok" }); return result.output;',
      },
    });
    expect(allowedResult.isError).toBeUndefined();
    expect((allowedResult.content as Array<{ text: string }>)[0]!.text)
      .toContain("trusted-shell-ok");

    const settledResult = await allowed.client.callTool({
      name: "fabric_exec",
      arguments: {
        code: [
          'const result = await k.bash({ command: "printf expected-failure; exit 7", settle: true });',
          'return { ok: result.ok, output: result.output, exitCode: result.exitCode };',
        ].join("\n"),
      },
    });
    expect(settledResult.isError).toBeUndefined();
    const settledText = (settledResult.content as Array<{ text: string }>)[0]!.text;
    expect(settledText).toContain("ok: false");
    expect(settledText).toContain("output: expected-failure");
    expect(settledText).toContain("exitCode: 7");
    await allowed.runtime.close();
  });

  it("fails closed on approval-requiring actions (no elicitation)", async () => {
    const { client, runtime } = await clientServer(process.cwd(), (registry) => {
      registry.register({
        name: "demo",
        description: "demo",
        async list() {
          return [{
            name: "mutate",
            description: "mutate",
            inputSchema: { type: "object", properties: {} },
            risk: "write" as const,
          }];
        },
        async describe(name) {
          return name === "mutate"
            ? { name: "mutate", description: "mutate", inputSchema: { type: "object", properties: {} }, risk: "write" as const }
            : undefined;
        },
        async invoke() {
          throw new Error("side effect must not run");
        },
      });
    });
    // Force write to "ask" so it needs approval; Kiro host denies it.
    runtime.service.config.approvals.write = "ask";
    const result = await client.callTool({
      name: "fabric_exec",
      arguments: { code: 'return tools.call({ ref: "demo.mutate", args: {} });' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("no MCP elicitation");
    await runtime.close();
  });
});

describe("Kiro profile generation", () => {
  it("produces the v3 fail-closed profile with exactly one tool", () => {
    const profile = generateKiroProfile({
      projectRoot: "/proj",
      mcpEntryPath: "/dist/kiro/mcp-entry.js",
      nodePath: "/usr/bin/node",
    });
    expect(profile.includeMcpJson).toBe(false);
    expect(profile.tools).toEqual(["@fabric/fabric_exec"]);
    expect(profile.allowedTools).toEqual(["@fabric/fabric_exec"]);
    expect(profile.includePowers).toBe(false);
    expect(profile.permissions).toEqual({
      rules: [{ capability: "mcp", match: ["fabric/fabric_exec"], effect: "ask" }],
    });
    const server = profile.mcpServers.fabric as { command: string; args: string[]; requestTimeout: number };
    expect(server.command).toBe("/usr/bin/node");
    expect(server.args).toEqual(["/dist/kiro/mcp-entry.js"]);
    expect(server.requestTimeout).toBe(KIRO_PROFILE_REQUEST_TIMEOUT_MS);
    expect(kiroProfilePath("/proj")).toBe("/proj/.kiro/agents/kiro-fabric.json");
    expect(KIRO_CLI_VERSION).toBe("2.20.1");
    expect(KIRO_AGENT_ENGINE).toBe("v3");
  });
});

describe("FabricDenyApprovalFallback", () => {
  it("denies ask and auto, allows explicit allow", async () => {
    const session = new Set<"read" | "write">();
    const deny = new FabricDenyApprovalFallback(
      { read: "allow", write: "ask", execute: "auto", network: "allow", agent: "allow" },
      session as never,
      "Managed Kiro exposes no MCP elicitation approval bridge; approval-requiring actions fail closed",
    );
    await expect(
      deny.approve({ ref: "k.read", risk: "read", description: "" } as never),
    ).resolves.toBeUndefined();
    await expect(
      deny.approve({ ref: "k.write", risk: "write", description: "" } as never),
    ).rejects.toThrow(/no MCP elicitation/);
    await expect(
      deny.approve({ ref: "k.bash", risk: "execute", description: "" } as never),
    ).rejects.toThrow(/no MCP elicitation/);
  });
});
