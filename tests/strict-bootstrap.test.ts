import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({
  handlers: new Map<unknown, (...args: any[]) => Promise<any>>(),
  approve: false,
  forms: [] as string[],
  elicitation: true,
  onForm: undefined as undefined | (() => void),
}));
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({ Server: class {
  setRequestHandler(schema: unknown, handler: (...args: any[]) => Promise<any>) { wire.handlers.set(schema, handler); }
  setNotificationHandler() {}
  getClientCapabilities() { return { roots: {}, ...(wire.elicitation ? { elicitation: { form: {} } } : {}) }; }
  async elicitInput(request: { message: string }) { wire.forms.push(request.message); wire.onForm?.(); return { action: wire.approve ? "accept" : "decline", content: { approved: wire.approve } }; }
  async connect() {}
  async close() {}
} }));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: class {} }));

import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createKiroMcpServer } from "../src/kiro/mcp-server.js";
import { normalizeFabricConfig } from "../src/config.js";
import { createKiroRuntime } from "../src/kiro/runtime.js";
import type { KiroWorkspaceSnapshot } from "../src/kiro/power/workspace-context.js";

const temporary: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];
beforeEach(() => { wire.handlers.clear(); wire.approve = false; wire.elicitation = true; wire.forms.length = 0; wire.onForm = undefined; });
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); vi.restoreAllMocks(); for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const fixture = async (rootCount = 1, unavailable = false, launch: "project" | "data" | undefined = undefined) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "strict-bootstrap-")); temporary.push(base);
  const runtimeRoot = path.join(base, "runtime"); const dataRoot = path.join(base, "data");
  fs.mkdirSync(runtimeRoot); fs.mkdirSync(dataRoot);
  const projects = [path.join(base, "project-a"), path.join(base, "project-b")];
  for (const root of projects) { fs.mkdirSync(root); fs.writeFileSync(path.join(root, "fixture.txt"), `source:${path.basename(root)}\n`); }
  let snapshot: KiroWorkspaceSnapshot = {
    status: unavailable ? "temporarily-unavailable" : rootCount ? "verified" : "explicitly-empty",
    roots: projects.slice(0, rootCount).map((root) => ({ uri: pathToFileURL(root).href, name: path.basename(root) })),
    revision: 1, observedAt: Date.now(),
  };
  const server = await createKiroMcpServer({ runtimeRoot, dataRoot, ...(launch ? { launchWorkspaceRoot: launch === "project" ? projects[0]! : dataRoot } : {}), version: "fixture", workspaceContext: {
    current: async () => snapshot, invalidate() {}, subscribe: () => ({ dispose() {} }),
  }, prepareRuntime: (options) => createKiroRuntime({ ...options, config: normalizeFabricConfig({
    // These fixtures exercise interactive approval, independently of product defaults.
    approvals: { write: "ask", execute: "ask", network: "ask" },
    executor: { timeoutMs: 5000, maxTimeoutMs: 180000 }, mcp: { enabled: false },
  }) }) });
  servers.push(server);
  const call = (code: string, payloads?: Record<string, string>, signal = new AbortController().signal) => wire.handlers.get(CallToolRequestSchema)!({ params: { name: "fabric_exec", arguments: { code, resultFormat: "json", ...(payloads ? { payloads } : {}) } } }, { signal });
  const value = (response: any) => JSON.parse(response.content[0].text.split("\n\nWorkspace transition:")[0]);
  return { base, projects, dataRoot, call, value, snapshot: (next: KiroWorkspaceSnapshot) => { snapshot = next; } };
};

describe("strict checked workspace bootstrap", () => {
  it("automatically reads the launch project without roots or approval", async () => {
    const f = await fixture(0, false, "project");
    const response = await f.call('return await local.read({path:"fixture.txt"})');
    expect(response.isError).not.toBe(true);
    expect(f.value(response)).toMatchObject({ text: "source:project-a\n" });
    expect(wire.forms).toHaveLength(0);
  });
  it("does not fall back after client roots are removed", async () => {
    const f = await fixture(1, false, "project");
    expect((await f.call('return await local.read({path:"fixture.txt"})')).isError).not.toBe(true);
    f.snapshot({ status: "explicitly-empty", roots: [], revision: 2, observedAt: Date.now() });
    expect((await f.call('return await local.read({path:"fixture.txt"})')).isError).toBe(true);
  });
  it("does not override ambiguous client roots", async () => {
    const f = await fixture(2, false, "project");
    expect((await f.call('return await local.read({path:"fixture.txt"})')).isError).toBe(true);
    expect(f.value(await f.call('return await fabric.workspace({action:"list"})')).roots).toHaveLength(2);
  });
  it("never uses a launch fallback during roots failure or for data storage", async () => {
    for (const [unavailable, launch] of [[true, "project"], [false, "data"]] as const) {
      const f = await fixture(0, unavailable, launch);
      expect((await f.call('return await local.read({path:"fixture.txt"})')).isError).toBe(true);
    }
  });
  it("first execution auto-binds the single verified root and reads through local", async () => {
    const f = await fixture();
    const response = await f.call('return await local.read({path:"fixture.txt"})');
    expect(response.isError).not.toBe(true);
    expect(f.value(response)).toMatchObject({ text: "source:project-a\n", truncated: false });
    expect(wire.forms).toHaveLength(0);
    const info = f.value(await f.call("return await fabric.info()"));
    expect(info.workspace.status).toBe("bound");
    expect(info.nativeKiroTools.availability).toBe("not-exposed");
    expect(info.providers.some((entry: any) => entry.name === "local" && entry.available)).toBe(true);
  });

  it.each([false, true])("unbound/unavailable bootstrap is usable and data-root coding is denied (%s)", async (unavailable) => {
    const f = await fixture(0, unavailable);
    fs.writeFileSync(path.join(f.dataRoot, "private.txt"), "NOT-A-PROJECT");
    const help = await f.call('return await fabric.help({topic:"overview",limit:100})');
    expect(help.isError).not.toBe(true); expect(f.value(help)).toMatchObject({ truncated: true, nextOffset: 100 });
    const info = await f.call("return await fabric.info()"); expect(info.isError).not.toBe(true);
    const status = await f.call('return await fabric.workspace({action:"status"})'); expect(f.value(status).status).toBe("unbound");
    for (const code of ['return await local.read({path:"private.txt"})', 'return await tools.call({ref:"local.read",args:{path:"private.txt"}})', 'return await state.get({key:"x"})']) {
      const response = await f.call(code); expect(response.isError).toBe(true); expect(response.content[0].text).toMatch(/Verified workspace|verified workspace/);
      expect(response.content[0].text).not.toContain("NOT-A-PROJECT");
    }
  });

  it("selects among multiple roots after guest settlement without self-drain, then uses the next binding", async () => {
    const f = await fixture(2);
    const list = f.value(await f.call('return await fabric.workspace({action:"list"})'));
    expect(list.requiresSelection).toBe(true);
    const selected = await f.call('return await fabric.workspace({action:"select",rootId:payloads.root})', { root: list.roots[1].rootId });
    expect(selected.isError).not.toBe(true);
    expect(f.value(selected)).toMatchObject({ status: "pending", committed: false });
    expect(selected.content[0].text).toContain('"committed":true');
    const read = await f.call('return await local.read({path:"fixture.txt"})');
    expect(f.value(read).text).toBe("source:project-b\n");
  });

  it("rejects switch/effects in either order, including generic calls; failed programs never commit a pending switch", async () => {
    const f = await fixture(2);
    const list = f.value(await f.call('return await fabric.workspace({action:"list"})'));
    const root = list.roots[0].rootId;
    for (const code of [
      'await fabric.workspace({action:"select",rootId:payloads.root}); return await local.read({path:"fixture.txt"});',
      'await tools.call({ref:"fabric.workspace",args:{action:"select",rootId:payloads.root}}); return await tools.call({ref:"local.read",args:{path:"fixture.txt"}});',
      'await fabric.workspace({action:"select",rootId:payloads.root}); throw new Error("later failure");',
    ]) {
      const response = await f.call(code, { root }); expect(response.isError).toBe(true);
      expect(f.value(await f.call('return await fabric.workspace({action:"status"})')).status).toBe("unbound");
    }
    await f.call('return await fabric.workspace({action:"select",rootId:payloads.root})', { root });
    const response = await f.call('await local.read({path:"fixture.txt"}); return await fabric.workspace({action:"detach"});');
    expect(response.isError).toBe(true); expect(response.content[0].text).toContain("separate bootstrap execution");
    expect(f.value(await f.call('return await fabric.workspace({action:"status"})')).status).toBe("bound");
  });

  it("validates bootstrap types before calls and dynamic action combinations at runtime", async () => {
    const f = await fixture(0);
    const invalidType = await f.call('return await fabric.workspace({action:"select"})');
    expect(invalidType.isError).toBe(true); expect(invalidType.content[0].text).toContain("TypeScript validation failed");
    const invalidDynamic = await f.call('return await tools.call({ref:"fabric.workspace",args:{action:"status",path:"/tmp"}})');
    expect(invalidDynamic.isError).toBe(true); expect(invalidDynamic.content[0].text).toContain("Invalid fabric.workspace");
    const badHelp = await f.call('return await tools.call({ref:"fabric.help",args:{topic:"/etc/passwd"}})');
    expect(badHelp.isError).toBe(true);
  });

  it("manual attach preserves exact elicitation and denied/missing approval fails closed", async () => {
    const f = await fixture(0);
    const code = 'return await fabric.workspace({action:"attach",path:payloads.root})';
    expect((await f.call(code, { root: f.projects[0]! })).isError).toBe(true);
    expect(wire.forms[0]).toContain(f.projects[0]);
    wire.elicitation = false; wire.approve = true;
    expect((await f.call(code, { root: f.projects[0]! })).isError).toBe(true);
    wire.elicitation = true;
    const approved = await f.call(code, { root: f.projects[0]! });
    expect(approved.isError).not.toBe(true); expect(approved.content[0].text).toContain('"committed":true');
    const read = await f.call('return await local.read({path:"fixture.txt"})');
    expect(f.value(read).text).toBe("source:project-a\n");
  });

  it("a denied local edit/shell never takes effect despite allowed outer execution", async () => {
    const f = await fixture();
    const edit = await f.call('return await local.edit({path:"fixture.txt",oldText:"source",newText:"changed"})');
    expect(edit.isError).toBe(true); expect(fs.readFileSync(path.join(f.projects[0]!, "fixture.txt"), "utf8")).toContain("source:");
    const shell = await f.call('return await local.shell({command:"printf altered > fixture.txt",settle:true})');
    expect(shell.isError).toBe(true); expect(fs.readFileSync(path.join(f.projects[0]!, "fixture.txt"), "utf8")).toContain("source:");
    expect(wire.forms.join("\n")).toContain("printf altered");
    expect(wire.forms.join("\n")).toContain("fixture.txt");
  });

  it("local argument type errors prevent ALL earlier source effects and dynamic malformed args are rejected", async () => {
    const f = await fixture(); wire.approve = true;
    const response = await f.call('await local.write({path:"should-not-exist",content:"x"}); return await local.read({path:12});');
    expect(response.isError).toBe(true); expect(response.content[0].text).toContain("TypeScript validation failed");
    expect(fs.existsSync(path.join(f.projects[0]!, "should-not-exist"))).toBe(false);
    expect(wire.forms).toHaveLength(0);
    const malformed = await f.call('return await tools.call({ref:"local.read",args:{path:12}})');
    expect(malformed.isError).toBe(true);
  });
  it("runs the documented coding example against real fixture tests, with compact output", async () => {
    const f = await fixture(); wire.approve = true;
    const root = f.projects[0]!;
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "strict-fixture", type: "module", scripts: { test: "node --test test.mjs" } }));
    fs.writeFileSync(path.join(root, "src/example.js"), "export function oldFunction() { return 2; }\n");
    fs.writeFileSync(path.join(root, "test.mjs"), 'import assert from "node:assert/strict"; import {oldFunction} from "./src/example.js"; assert.equal(oldFunction(), 3); console.log("fixture-assertion-passed");\n');
    const code = `const [manifest, search] = await Promise.all([
      local.read({path:"package.json"}),
      local.grep({path:"src",pattern:"oldFunction",literal:true,limit:20})
    ]);
    if (manifest.truncated) throw new Error("Read the remaining manifest first");
    const packageName = JSON.parse(manifest.text).name;
    const change = await local.edit({path:"src/example.js",oldText:payloads.oldText,newText:payloads.newText});
    const test = await local.shell({command:"node --test test.mjs",timeoutMs:120000,settle:true});
    return {packageName,inspectedMatches:search.matches.length,searchTruncated:search.truncated,changed:change.changed,testsPassed:test.ok,failureEvidence:test.ok?"":(test.stdout+test.stderr).slice(-2000),testOutputTruncated:test.truncated};`;
    const response = await f.call(code, { oldText: "return 2", newText: "return 3" });
    expect(response.isError, response.content[0].text).not.toBe(true);
    expect(f.value(response)).toEqual({ packageName: "strict-fixture", inspectedMatches: 1, searchTruncated: false, changed: true, testsPassed: true, failureEvidence: "", testOutputTruncated: false });
    expect(fs.readFileSync(path.join(root, "src/example.js"), "utf8")).toContain("return 3");
    expect(wire.forms).toHaveLength(2);
    expect(response.content[0].text.length).toBeLessThan(500);
  });

  it("returns partial progress after a later failure and never retries completed edits", async () => {
    const f = await fixture(); wire.approve = true;
    const response = await f.call('await local.edit({path:"fixture.txt",oldText:"source",newText:"changed"}); await local.shell({command:"exit 7"}); return true;');
    expect(response.isError).toBe(true);
    expect(fs.readFileSync(path.join(f.projects[0]!, "fixture.txt"), "utf8")).toBe("changed:project-a\n");
    expect(response.content[0].text).toContain('"ref":"local.edit","outcome":"succeeded"');
    expect(response.content[0].text).toContain('"effectOutcome":"uncertain"');
    expect(response.content[0].text).toContain("never automatically retry");
    expect(wire.forms).toHaveLength(2);
  });

  it("keeps bounded intermediate content inside execution and validates fresh guest contexts", async () => {
    const f = await fixture();
    fs.writeFileSync(path.join(f.projects[0]!, "large.txt"), "PRIVATE_INTERMEDIATE_".repeat(20).concat("\n").repeat(1000));
    const response = await f.call('const read=await local.read({path:"large.txt",limit:2000}); return {bytes:read.text.length,truncated:read.truncated,nextOffset:read.nextOffset??null};');
    expect(response.isError, response.content[0].text).not.toBe(true);
    expect(f.value(response).truncated).toBe(true);
    expect(response.content[0].text).not.toContain("PRIVATE_INTERMEDIATE");
    expect(response.content[0].text.length).toBeLessThan(200);
    const first = await f.call('Object.defineProperty(globalThis,"fixtureEphemeral",{value:42}); return true;');
    expect(first.isError).not.toBe(true);
    const second = await f.call('return Object.getOwnPropertyDescriptor(globalThis,"fixtureEphemeral") === undefined;');
    expect(f.value(second)).toBe(true);
  });
});
