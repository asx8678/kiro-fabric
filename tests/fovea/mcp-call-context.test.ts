import { removeFixtureSync } from "../fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInstalledParser, type InstalledParser } from "./installed-parser.js";

const distIndex = path.resolve("dist/index.js");
const distEngine = path.resolve("dist/fovea/engine-entry.js");
let parser: InstalledParser | undefined;
let dispose: (() => void) | undefined;
const nodePath = process.execPath;

beforeAll(() => {
  const installed = createInstalledParser();
  parser = installed?.parser;
  dispose = installed?.dispose;
});
afterAll(() => dispose?.());

const portable = process.platform === "darwin" || process.platform === "linux";
const ready = () => portable && !!parser && fs.existsSync(distIndex) && fs.existsSync(distEngine) && fs.existsSync(parser!.path);

async function withServer(
  options: { enabled: boolean; approvals?: { read: "allow" | "ask" | "deny"; write: "allow" } },
  body: (call: (code: string) => Promise<string>, paths: { root: string; data: string }) => Promise<void>,
): Promise<void> {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fovea-call-context-mcp-")));
  fs.chmodSync(base, 0o700);
  const data = path.join(base, "data"), root = path.join(base, "workspace");
  fs.mkdirSync(data, { mode: 0o700 }); fs.mkdirSync(root, { mode: 0o700 });
  if (options.approvals) {
    const configDir = path.join(data, "fabric", "config");
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(data, "fabric"), 0o700);
    fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify({
      schemaVersion: 1,
      approvals: { read: options.approvals.read, write: options.approvals.write },
    }, null, 2)}\n`, { mode: 0o600 });
  }
  const driver = path.join(base, "driver.mjs");
  fs.writeFileSync(driver, `import { createKiroMcpServer } from ${JSON.stringify(pathToFileURL(distIndex).href)};
const server = await createKiroMcpServer(${JSON.stringify({
    runtimeRoot: path.resolve("dist"),
    dataRoot: data,
    version: "test",
    launchWorkspaceRoot: root,
    managedParser: parser,
    ...(options.enabled ? { foveaCallContext: true as const } : {}),
  })});
process.stdin.once("end", () => { void server.close().then(() => process.exit(0)); });
`);
  const client = new Client({ name: "component-call-context-test", version: "1" });
  const transport = new StdioClientTransport({
    command: nodePath!,
    args: [driver],
    cwd: root,
    env: { HOME: base, PATH: process.env.PATH ?? "/usr/bin:/bin" },
    stderr: "pipe",
  });
  let errors = "";
  try {
    await client.connect(transport);
    transport.stderr?.on("data", bytes => { errors = (errors + bytes.toString()).slice(-4000); });
    const call = async (code: string): Promise<string> => {
      const result = await client.callTool({ name: "fabric_exec", arguments: { code } }, undefined, { timeout: 60_000 });
      expect(result.isError, JSON.stringify(result) + errors).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text.length).toBeLessThanOrEqual(50_000);
      return content[0]!.text;
    };
    await body(call, { root, data });
  } finally {
    await client.close();
    removeFixtureSync(base, { recursive: true, force: true });
  }
}

// Built stdio MCP same-call suffix. Not native Kiro lifecycle qualification.
describe.skipIf(!portable)("built MCP same-call Fovea context", () => {
  it.each([false, true])("appends a disposable suffix after a committed local.edit only when enabled=%s", async enabled => {
    expect(ready(), "Build dist and install the pinned ast-grep platform package before built tests").toBe(true);
    await withServer({ enabled, approvals: { read: "allow", write: "allow" } }, async (call, { root }) => {
      const source = path.join(root, "math.ts");
      fs.writeFileSync(source, "export function calculateTotal() { return 1; }\n");
      const first = await call('const f = await local.read({path:"math.ts",limit:1}); await local.edit({path:"math.ts",expectedSha256:f.sha256,edits:[{oldText:"return 1",newText:"return 2"}]}); return {taskValue:"unchanged"};');
      expect(first.startsWith('{"taskValue":"unchanged"}')).toBe(true);
      if (enabled) {
        expect(first).toContain("Navigator advisory (untrusted");
        expect(first).toContain("math.ts");
      } else expect(first).toBe('{"taskValue":"unchanged"}');
      const status = JSON.parse(await call("return await repo.status();"));
      expect(status.engineStarts).toBe(enabled ? 1 : 0);
      expect(status.notices).toMatchObject({ pending: 0, emitted: 0, acknowledged: 0 });
      expect(await call('return "next";')).toBe("next");
      expect(await call('await local.read({path:"math.ts"}); return {taskValue:"unchanged"};')).toBe('{"taskValue":"unchanged"}');
      const refreshed = await call('const f = await local.read({path:"math.ts",limit:1}); await local.edit({path:"math.ts",expectedSha256:f.sha256,edits:[{oldText:"return 2",newText:"return 3"}]}); return {taskValue:"unchanged"};');
      expect(refreshed.startsWith('{"taskValue":"unchanged"}')).toBe(true);
      if (enabled) {
        expect(refreshed).toContain("Navigator advisory (untrusted");
        expect(refreshed).toContain("math.ts");
      } else expect(refreshed).toBe('{"taskValue":"unchanged"}');
    });
  }, 60_000);

  it.each(["allow", "ask", "deny"] as const)("respects approvals.read=%s after an independently allowed write", async read => {
    expect(ready(), "Build dist and install the pinned ast-grep platform package before built tests").toBe(true);
    await withServer({ enabled: true, approvals: { read, write: "allow" } }, async (call, { root, data }) => {
      const output = await call('await local.write({path:"new.ts",content:"export const n = 1;\\n"}); return {taskValue:"unchanged"};');
      expect(output.startsWith('{"taskValue":"unchanged"}')).toBe(true);
      expect(fs.readFileSync(path.join(root, "new.ts"), "utf8")).toBe("export const n = 1;\n");
      if (read === "allow") {
        expect(output).toContain("Navigator advisory (untrusted");
        expect(output).toContain("new.ts");
      } else {
        expect(output).toBe('{"taskValue":"unchanged"}');
        // Do not issue repo.status: it is itself denied/approval-gated here.
        // The synthetic embedder owns this storage; no source snapshot should exist.
        const instances = path.join(data, "fabric", "fovea", "instances");
        const engineDirectories = fs.readdirSync(instances).flatMap(instance =>
          fs.readdirSync(path.join(instances, instance)).filter(name => name.startsWith("engine-")));
        expect(engineDirectories).toEqual([]);
      }
    });
  }, 60_000);
});
