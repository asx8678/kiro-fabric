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

import { AGENT_PROMPT } from "../scripts/agent-profile.mjs";
import { BUNDLED_GUIDANCE } from "../src/kiro/generated-guidance.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createKiroMcpServer } from "../src/kiro/mcp-server.js";
import { normalizeFabricConfig } from "../src/config.js";
import { createKiroRuntime } from "../src/kiro/runtime.js";
import type { KiroWorkspaceSnapshot } from "../src/kiro/power/workspace-context.js";

const temporary: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];
beforeEach(() => { vi.unstubAllEnvs(); wire.handlers.clear(); wire.approve = false; wire.elicitation = true; wire.forms.length = 0; wire.onForm = undefined; });
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const fixture = async (rootCount = 1, unavailable = false, launch: "project" | "data" | undefined = undefined, execute?: "allow" | "ask" | "deny", extra: { write?: "allow" | "ask" | "deny"; maxApprovalRequests?: number } = {}) => {
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
    // Exercise product approval defaults, or an explicit execute restriction.
    ...(execute ? { approvals: { execute } } : {}),
    ...(extra.write ? { approvals: { write: extra.write } } : {}),
    executor: { timeoutMs: 5000, maxTimeoutMs: 180000, ...(extra.maxApprovalRequests === undefined ? {} : { maxApprovalRequests: extra.maxApprovalRequests }) }, mcp: { enabled: false },
  }) }) });
  servers.push(server);
  const call = (code: string, payloads?: Record<string, string>, signal = new AbortController().signal) => wire.handlers.get(CallToolRequestSchema)!({ params: { name: "fabric_exec", arguments: { code, resultFormat: "json", ...(payloads ? { payloads } : {}) } } }, { signal });
  const value = (response: any) => JSON.parse(response.content[0].text.split("\n\nWorkspace transition:")[0]);
  const tool = (name: string, args: Record<string, unknown>) => wire.handlers.get(CallToolRequestSchema)!({ params: { name, arguments: args } }, { signal: new AbortController().signal });
  return { base, projects, dataRoot, call, value, tool, snapshot: (next: KiroWorkspaceSnapshot) => { snapshot = next; } };
};

describe("strict checked workspace bootstrap", () => {
  it("returns all compiler failures with one repair hint and executes no partial program", async () => {
    const f = await fixture();
    const assignments = Array.from({ length: 50 }, (_, index) => `out["key${index}"] = ${index};`).join("\n");
    const failed = await f.call('await local.write({path:"not-executed.txt",content:"never"});\nconst out = {};\n' + assignments + '\nreturn out;');
    expect(failed.isError).toBe(true);
    const value = f.value(failed);
    expect(value.typeErrors).toHaveLength(50);
    expect(value.typeErrors.every((error: { code: number }) => error.code === 7053)).toBe(true);
    expect(value.typeErrors.filter((error: { hint?: string }) => error.hint !== undefined)).toHaveLength(1);
    expect(failed.content[0].text).not.toContain("artifact ka_");
    expect(wire.forms).toHaveLength(0);
    expect(fs.existsSync(path.join(f.projects[0]!, "not-executed.txt"))).toBe(false);
    const repaired = await f.call('const out: JsonObject = {};\n' + assignments + '\nreturn out;');
    expect(repaired.isError).not.toBe(true);
    expect(f.value(repaired)).toEqual(Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`key${index}`, index])));
  });

  it.each(["absent", "root", "nested"] as const)("discovers and reads a %s README in one checked first inspection", async (location) => {
    const f = await fixture();
    const root = f.projects[0]!;
    const expectedPath = location === "absent" ? undefined : location === "root" ? "README.md" : "app/README.md";
    if (location === "nested") fs.mkdirSync(path.join(root, "app"));
    if (expectedPath) fs.writeFileSync(path.join(root, expectedPath), "# Discovered project\n");
    expect(AGENT_PROMPT).toContain("discovery -> bounded observed starter reads in the same exec");
    const code = BUNDLED_GUIDANCE.review.match(/```ts\n(\/\/ Recipe: initial review evidence\n[\s\S]*?)\n```/)?.[1];
    expect(code).toBeDefined();
    const first = await f.call(code!);
    expect(first.isError, first.content[0].text).not.toBe(true);
    const result = f.value(first);
    expect(result.manifest).toMatchObject({ scope: { path: ".", hidden: true, ignoreFiles: true }, truncated: false });
    expect(result.manifest.paths).toEqual(expect.arrayContaining(expectedPath ? ["fixture.txt", expectedPath] : ["fixture.txt"]));
    expect(result.unclassified).toEqual(["fixture.txt"]);
    expect(result.help).toEqual({ topic: "review", text: BUNDLED_GUIDANCE.review, truncated: false });
    const files = result.packets.flatMap((packet: { evidence: { files: unknown[] } }) => packet.evidence.files);
    expect(files).toEqual(expectedPath ? [expect.objectContaining({ path: expectedPath, source: "1: # Discovered project", truncated: false })] : []);
    expect(wire.forms).toHaveLength(0);
  });

  it("serves review guidance and hidden-aware coverage through the sole checked model tool", async () => {
    const f = await fixture();
    const root = f.projects[0]!;
    fs.mkdirSync(path.join(root, ".ci"));
    fs.writeFileSync(path.join(root, ".ci/check.yml"), "script: check.mjs\n");
    fs.writeFileSync(path.join(root, "check.mjs"), "// first\n// second\n");
    const response = await f.call('const help = await fabric.help({topic:"review",limit:16000}); const files = await local.find({pattern:"**/*",hidden:true,limit:200}); const references = await local.grep({pattern:"script:",hidden:true}); const read = await local.read({path:"check.mjs",limit:1}); return {help,files,references,read};');
    expect(response.isError, response.content[0].text).not.toBe(true);
    const result = f.value(response);
    expect(result.help.text).toContain("coverage ledger");
    expect(result.files).toMatchObject({ paths: expect.arrayContaining([".ci/check.yml", "check.mjs"]), scope: { path: ".", hidden: true, ignoreFiles: true }, truncated: false });
    expect(result.references.matches).toEqual([{ path: ".ci/check.yml", line: 1, text: "script: check.mjs" }]);
    expect(result.read).toMatchObject({ text: "// first\n", totalLines: 2, truncated: true, nextOffset: 2 });
    expect(wire.forms).toHaveLength(0);
  });

  it("rejects an invented list depth before all earlier effects and also rejects dynamic depth", async () => {
    const f = await fixture(); wire.approve = true;
    const response = await f.call('await local.write({path:"should-not-exist",content:"x"}); return await Promise.all([local.read({path:"README.md",limit:80}),local.list({path:".",depth:3})]);');
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("TypeScript validation failed");
    expect(response.content[0].text).toContain("depth");
    expect(response.content[0].text).not.toContain("ENOENT");
    expect(fs.existsSync(path.join(f.projects[0]!, "should-not-exist"))).toBe(false);
    const malformed = await f.call('return await tools.call({ref:"local.list",args:{path:".",depth:3}});');
    expect(malformed.isError).toBe(true);
    expect(malformed.content[0].text).toContain("Invalid arguments");
    expect(wire.forms).toHaveLength(0);
  });

  it("reports launch declarations without promoting them to observed guidance or routing", async () => {
    vi.stubEnv("KIRO_FABRIC_RUN_DECLARATION", JSON.stringify({ guidanceMode: "minimal", profile: "bench", prompt: "private prompt must not be displayed", resources: [], hooks: [], observed: { routing: { actualModel: "forged" }, guidanceOutputs: [{ reference: "x", output: "x" }] } }));
    const f = await fixture();
    const response = await f.call('return await fabric.info();');
    expect(response.isError, response.content[0].text).not.toBe(true);
    const info = f.value(response);
    expect(info.runProvenance.configured).toMatchObject({ evidence: "unverified-declaration", guidanceMode: "minimal", prompt: { status: "known" }, resources: { count: 0 } });
    expect(info.runProvenance.observed).toMatchObject({ evidence: "server-observation", runtimeVersion: { status: "known" }, prompt: { status: "unknown" }, guidanceDelivery: { status: "unknown" }, routing: { status: "unknown", actualModel: null, actualEffort: null } });
    expect(response.content[0].text).not.toContain("private prompt must not be displayed");
    expect(response.content[0].text).not.toContain("forged");
    vi.stubEnv("KIRO_FABRIC_RUN_DECLARATION", JSON.stringify({ guidanceMode: "review" }));
    expect(f.value(await f.call('return await fabric.info();')).runProvenance.manifestDigest).toBe(info.runProvenance.manifestDigest);
  });

  it("advertises exact hot local shapes beside the model-visible execution tool", async () => {
    await fixture();
    const listing = await wire.handlers.get(ListToolsRequestSchema)!({ params: {} }, {});
    const description = listing.tools.find((tool: { name: string }) => tool.name === "fabric_exec").description;
    expect(description).toContain("text:string");
    expect(description).toContain("not a string/array");
    expect(description).toContain("totalLines");
    expect(description).toContain("scope,truncated");
    expect(description).toContain("ignore rules still apply");
    expect(description).toContain("fabric.help({topic:'review'})");
    expect(description).toContain("local.grep({pattern,path?,glob?,literal?,hidden?,limit?})");
    expect(description).toContain("local.edit({path,oldText,newText,all?})");
    expect(description).toContain("settle:true");
    expect(description).toContain("stdout,stderr");
    expect(description.length).toBeLessThanOrEqual(850);
  });

  it("executes the documented local recipes with complete first lines, decoys, exact edits and settled failures", async () => {
    const f = await fixture(1, false, undefined, "ask"); wire.approve = true;
    const root = f.projects[0]!;
    const skill = fs.readFileSync(new URL("../skills/fabric-exec/references/recipes.md", import.meta.url), "utf8");
    const recipes = [...skill.matchAll(/```ts\n(\/\/ Recipe:[\s\S]*?)\n```/g)].map(match => match[1]!);
    expect(recipes.length).toBeGreaterThanOrEqual(8);
    const recipe = (title: string): string => {
      const matches = recipes.filter(code => code.startsWith(`// Recipe: ${title}\n`));
      expect(matches, `documented recipe: ${title}`).toHaveLength(1);
      return matches[0]!;
    };
    fs.writeFileSync(path.join(root, "one.txt"), "  café 🛰 full first line  \r\nsecond\r\n");
    fs.writeFileSync(path.join(root, "two.txt"), "\nnot the first line\n");
    const read = await f.call(recipe("complete first lines from supplied paths"));
    expect(read.isError, read.content[0].text).not.toBe(true);
    expect(f.value(read)).toEqual(["  café 🛰 full first line  ", ""]);
    fs.writeFileSync(path.join(root, "config café.json"), '{"id": "example", "retryLimit": 3}\n');
    fs.writeFileSync(path.join(root, "decoy.json"), '{"id": "other", "description": "example"}\n');
    const searchInput = { symbol: '"id": "example"', path: "." };
    const search = await f.call(recipe("discover then read without a model round trip"), searchInput);
    expect(search.isError, search.content[0].text).not.toBe(true);
    expect(f.value(search)).toEqual({
      search: { scope: { path: ".", hidden: true, ignoreFiles: true }, matches: [{ path: "config café.json", line: 1, text: '{"id": "example", "retryLimit": 3}' }], truncated: false },
      evidence: { complete: true, remaining: [], unreadTails: [], files: [{ path: "config café.json", startLine: 1, endLine: 1, source: '1: {"id": "example", "retryLimit": 3}', totalLines: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/u), truncated: false }] },
    });
    const distant = Array.from({ length: 450 }, (_, i) => `quiet line ${i + 1}`);
    for (const line of [400, 401, 420]) distant[line - 1] = `{"id": "example", "where":${line}}`;
    fs.writeFileSync(path.join(root, "far.txt"), distant.join("\n") + "\n");
    const farSearch = await f.call(recipe("discover then read without a model round trip"), searchInput);
    expect(farSearch.isError, farSearch.content[0].text).not.toBe(true);
    const ranges = (f.value(farSearch).evidence.files as Array<{ path: string; startLine: number; source: string; truncated: boolean }>).filter(r => r.path === "far.txt");
    expect(ranges.map(r => r.startLine)).toEqual([397, 417]);
    expect(ranges[0]!.source).toContain('"where":400');
    expect(ranges[0]!.source).toContain('"where":401');
    expect(ranges[1]!.source).toContain('"where":420');
    expect(ranges.every(r => r.truncated)).toBe(true);
    const edit = await f.call(recipe("exact edit then verification"), { path: "config café.json", oldText: '"retryLimit": 3', newText: '"retryLimit": 7' });
    expect(edit.isError, edit.content[0].text).not.toBe(true);
    expect(JSON.parse(f.value(edit).text)).toEqual({ id: "example", retryLimit: 7 });
    expect(fs.readFileSync(path.join(root, "decoy.json"), "utf8")).toBe('{"id": "other", "description": "example"}\n');
    const farEdit = await f.call(recipe("exact edit then verification"), { path: "far.txt", oldText: '"where":400', newText: '"where":999' });
    expect(farEdit.isError, farEdit.content[0].text).not.toBe(true);
    expect(f.value(farEdit)).toMatchObject({ changed: true, truncated: true, verifiedSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(f.value(farEdit).text).not.toContain('"where":999');
    expect(fs.readFileSync(path.join(root, "far.txt"), "utf8").split("\n")[399]).toContain('"where":999');
    fs.writeFileSync(path.join(root, "intervening.txt"), "value=old\n");
    const interrupted = recipe("exact edit then verification").replace("const r = await local.read", "await local.write({path,content:payloads.intervening,overwrite:true}); const r = await local.read");
    const conflict = await f.call(interrupted, { path: "intervening.txt", oldText: "value=old", newText: "value=new", intervening: "other change\n" });
    expect(conflict.isError).toBe(true);
    expect(conflict.content[0].text).toContain("File changed after edit");
    expect(fs.readFileSync(path.join(root, "intervening.txt"), "utf8")).toBe("other change\n");
    const shell = await f.call(recipe("bounded evidence from expected nonzero commands"), { command: "printf '%s\\n' 'diagnostic: expected'; exit 7" });
    expect(shell.isError, shell.content[0].text).not.toBe(true);
    expect(f.value(shell)).toMatchObject({ ok: false, exitCode: 7, stdout: "diagnostic: expected\n", stderr: "", truncated: false });
    const noisy = await f.call(recipe("bounded evidence from expected nonzero commands"), { command: "i=0; while [ $i -lt 400 ]; do printf 'noise-'; i=$((i+1)); done; exit 7" });
    expect(noisy.isError, noisy.content[0].text).not.toBe(true);
    expect(f.value(noisy)).toMatchObject({ ok: false, exitCode: 7, truncated: true });
    expect(f.value(noisy).stdout.length).toBe(1200);
    fs.writeFileSync(path.join(root, "same.txt"), "first=old\nsecond=old\nkeep=this\n");
    const multi = await f.call(recipe("snapshot-bound same-file edits"), { path: "same.txt", oldFirst: "first=old", newFirst: "first=new", oldSecond: "second=old", newSecond: "second=new" });
    expect(multi.isError, multi.content[0].text).not.toBe(true);
    expect(f.value(multi)).toEqual({ path: "same.txt", verified: true, verifiedSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(fs.readFileSync(path.join(root, "same.txt"), "utf8")).toBe("first=new\nsecond=new\nkeep=this\n");
    for (const [file, group, amount] of [["a.json", "café", 20], ["b.json", "café", -3], ["c.json", "other", -2]]) {
      fs.writeFileSync(path.join(root, String(file)), JSON.stringify({ group, amount }));
    }
    const pipeline = await f.call(recipe("known-schema read compute write verify"), { paths: JSON.stringify(["a.json", "b.json", "c.json"]), outputPath: "totals.json" });
    expect(pipeline.isError, pipeline.content[0].text).not.toBe(true);
    expect(f.value(pipeline)).toEqual({ path: "totals.json", groups: 2, verified: true });
    expect(JSON.parse(fs.readFileSync(path.join(root, "totals.json"), "utf8"))).toEqual({ totals: { café: 17, other: -2 } });
    wire.approve = false;
    expect((await f.call(recipe("bounded evidence from expected nonzero commands"), { command: "printf must-be-denied" })).isError).toBe(true);
  });

  it("keeps quiet command results small without hiding failure, warning or omission evidence", async () => {
    const f = await fixture(1, false, undefined, "ask"); wire.approve = true;
    const source = fs.readFileSync(new URL("../skills/fabric-exec/references/recipes.md", import.meta.url), "utf8");
    const code = source.match(/```ts\n(\/\/ Recipe: quiet command status[\s\S]*?)\n```/)![1]!;
    const cases = [
      { command: "printf routine-success-log", expected: { ok: true, exitCode: 0, stdoutOmitted: true, truncated: false } },
      { command: "true", expected: { ok: true, exitCode: 0, stdoutOmitted: false, truncated: false } },
      { command: "printf routine; printf warning >&2", expected: { ok: true, exitCode: 0, stderr: "warning", stdoutOmitted: true, truncated: false } },
      { command: "printf failure-context; printf diagnostic >&2; exit 7", expected: { ok: false, exitCode: 7, stdout: "failure-context", stderr: "diagnostic", stdoutOmitted: false, truncated: false } },
    ];
    for (const { command, expected } of cases) {
      const response = await f.call(code, { command });
      expect(response.isError, response.content[0].text).not.toBe(true);
      expect(f.value(response)).toEqual(expected);
      expect(response.content[0].text.length).toBeLessThan(300);
    }
    for (const exit of [0, 7]) {
      const response = await f.call(code, { command: `i=0; while [ $i -lt 400 ]; do printf 'noise-' >&2; i=$((i+1)); done; exit ${exit}` });
      expect(response.isError, response.content[0].text).not.toBe(true);
      expect(f.value(response)).toMatchObject({ ok: exit === 0, exitCode: exit, stdoutOmitted: false, truncated: true });
      expect(f.value(response).stderr.length).toBe(1200);
    }
    const timed = await f.call(code.replace("timeoutMs:120000", "timeoutMs:5"), { command: "sleep 60" });
    expect(timed.isError).toBe(true);
    wire.approve = false;
    expect((await f.call(code, { command: "printf must-be-denied" })).isError).toBe(true);
  });

  it("verifies snapshot-bound atomic edits without accepting replacement-text decoys", async () => {
    const f = await fixture(); wire.approve = true;
    const source = fs.readFileSync(new URL("../skills/fabric-exec/references/recipes.md", import.meta.url), "utf8");
    const code = source.match(/```ts\n(\/\/ Recipe: snapshot-bound same-file edits[\s\S]*?)\n```/)![1]!;
    const target = path.join(f.projects[0]!, "same.txt");
    const original = "first=old\nsecond=old\ndecoy:first=new\n";
    const payloads = { path: "same.txt", oldFirst: "first=old", newFirst: "first=new", oldSecond: "second=old", newSecond: "second=new", intervening: original + "external change\n" };
    fs.writeFileSync(target, original);
    const between = code.replace("const change = await local.edit", "await local.write({path,content:payloads.intervening,overwrite:true}); const change = await local.edit");
    const conflict = await f.call(between, payloads);
    expect(conflict.isError).toBe(true);
    expect(conflict.content[0].text).toContain("expectedSha256 conflict");
    // Stale input rejects before either replacement; external changes survive.
    expect(fs.readFileSync(target, "utf8")).toBe(payloads.intervening);
    fs.writeFileSync(target, original);
    const after = code.replace("const r = await local.read", "await local.write({path,content:payloads.intervening,overwrite:true}); const r = await local.read");
    const stale = await f.call(after, payloads);
    expect(stale.isError).toBe(true);
    expect(stale.content[0].text).toContain("File changed after edit");
    fs.writeFileSync(target, original);
    const missing = await f.call(code, { ...payloads, oldSecond: "absent" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("exact anchor was not found");
    expect(fs.readFileSync(target, "utf8")).toBe(original);
    const deletion = await f.call(code, { ...payloads, newFirst: "" });
    expect(deletion.isError, deletion.content[0].text).not.toBe(true);
    expect(f.value(deletion)).toMatchObject({ verified: true });
    expect(fs.readFileSync(target, "utf8")).toBe("\nsecond=new\ndecoy:first=new\n");
  });

  it("explains how to recover from bare CLI empty roots without granting access", async () => {
    const f = await fixture(0);
    expect((await f.call('return await local.list({path:".",limit:100});')).isError).toBe(true);
    for (const action of ["status", "list"]) {
      const response = await f.call(`return await fabric.workspace({action:"${action}"});`);
      expect(response.isError).not.toBe(true);
      expect(f.value(response)).toMatchObject({ status: "unbound", context: "explicitly-empty", recovery: {
        command: 'KIRO_FABRIC_LAUNCH_WORKSPACE="$(pwd -P)" kiro-cli --v3 --agent kiro-fabric',
        instruction: expect.stringContaining("Do not execute it inside fabric_exec"),
      } });
    }
    expect((await f.call('return await local.read({path:"fixture.txt"});')).isError).toBe(true);
    expect(wire.forms).toHaveLength(0);
  });
  it.each([[0, false, "project"], [1, false, undefined], [0, true, undefined]] as const)("does not suggest empty-root recovery for bound or unavailable context (%s, %s, %s)", async (count, unavailable, launch) => {
    const f = await fixture(count, unavailable, launch);
    expect(f.value(await f.call('return await fabric.workspace({action:"status"});'))).not.toHaveProperty("recovery");
  });
  it("automatically reads the launch project without roots or approval", async () => {
    const f = await fixture(0, false, "project");
    const response = await f.call('return await local.read({path:"fixture.txt"})');
    expect(response.isError).not.toBe(true);
    expect(f.value(response)).toMatchObject({ text: "source:project-a\n" });
    expect(wire.forms).toHaveLength(0);
  });
  it("prefers client roots over a different authorized launch directory", async () => {
    const f = await fixture(1, false, "project");
    f.snapshot({ status: "verified", roots: [{ uri: pathToFileURL(f.projects[1]!).href }], revision: 2, observedAt: Date.now() });
    const response = await f.call('return await local.read({path:"fixture.txt"})');
    expect(response.isError).not.toBe(true);
    expect(f.value(response)).toMatchObject({ text: "source:project-b\n" });
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
    for (const topic of ["skill", "guide", "recipes", "workflow"]) {
      const page = await f.call(`return await fabric.help({topic:${JSON.stringify(topic)},limit:120})`);
      expect(page.isError, page.content[0].text).not.toBe(true);
      expect(f.value(page)).toMatchObject({ topic, truncated: true, nextOffset: 120 });
    }
    expect(wire.forms).toHaveLength(0);
    const badPath = await f.call('return await tools.call({ref:"fabric.help",args:{topic:"workflow",path:"/etc/passwd"}})');
    expect(badPath.isError).toBe(true);
    const info = await f.call("return await fabric.info()"); expect(info.isError).not.toBe(true);
    const status = await f.call('return await fabric.workspace({action:"status"})'); expect(f.value(status).status).toBe("unbound");
    for (const code of ['return await local.read({path:"private.txt"})', 'return await tools.call({ref:"local.read",args:{path:"private.txt"}})', 'return await state.get({key:"x"})', 'return await local.shell({command:"printf forbidden"})']) {
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

  it("charges manual attachment against the execution approval budget", async () => {
    const blocked = await fixture(0, false, undefined, undefined, { write: "allow", maxApprovalRequests: 0 });
    const denied = await blocked.call('return await fabric.workspace({action:"attach",path:payloads.root})', { root: blocked.projects[0]! });
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toContain("approval request quota exceeded");
    // No dialog is opened once the budget rejects the prompt.
    expect(wire.forms).toHaveLength(0);

    const allowed = await fixture(0, false, undefined, undefined, { write: "allow" });
    wire.approve = true;
    const approved = await allowed.call('return await fabric.workspace({action:"attach",path:payloads.root})', { root: allowed.projects[0]! });
    expect(approved.isError).not.toBe(true);
    expect(approved.content[0].text).toContain('"committed":true');
    expect(wire.forms[0]).toContain(allowed.projects[0]);
  });

  it("honors the prompt budget for the direct fabric_workspace tool too", async () => {
    const blocked = await fixture(0, false, undefined, undefined, { write: "allow", maxApprovalRequests: 0 });
    const denied = await blocked.tool("fabric_workspace", { action: "attach", path: blocked.projects[0]! });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain("maxApprovalRequests");
    expect(wire.forms).toHaveLength(0);

    const allowed = await fixture(0, false, undefined, undefined, { write: "allow" });
    wire.approve = true;
    const approved = await allowed.tool("fabric_workspace", { action: "attach", path: allowed.projects[0]! });
    expect(approved.isError).not.toBe(true);
    expect(wire.forms[0]).toContain(allowed.projects[0]);
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

  it.each([true, false])("default shell works while direct writes still need approval (elicitation=%s)", async (elicitation) => {
    const f = await fixture(); wire.elicitation = elicitation;
    const read = await f.call('return await local.read({path:"fixture.txt"})');
    expect(f.value(read).text).toBe("source:project-a\n");
    const write = await f.call('return await local.write({path:"denied.txt",content:"must not exist"})');
    expect(write.isError).toBe(true);
    expect(fs.existsSync(path.join(f.projects[0]!, "denied.txt"))).toBe(false);
    const edit = await f.call('return await local.edit({path:"fixture.txt",oldText:"source",newText:"changed"})');
    expect(edit.isError).toBe(true); expect(fs.readFileSync(path.join(f.projects[0]!, "fixture.txt"), "utf8")).toContain("source:");
    const shell = await f.call('return await local.shell({command:"printf altered > fixture.txt",settle:true})');
    expect(shell.isError, shell.content[0].text).not.toBe(true);
    expect(f.value(shell)).toMatchObject({ ok: true, exitCode: 0 });
    expect(fs.readFileSync(path.join(f.projects[0]!, "fixture.txt"), "utf8")).toBe("altered");
    expect(wire.forms).toHaveLength(elicitation ? 2 : 0);
    expect(wire.forms.join("\n")).not.toContain("printf altered");
  });

  it.each([["ask", true], ["ask", false], ["deny", true], ["deny", false]] as const)("explicit execute=%s remains restrictive (elicitation=%s)", async (execute, elicitation) => {
    const f = await fixture(1, false, undefined, execute); wire.elicitation = elicitation;
    const response = await f.call('return await local.shell({command:"printf altered > fixture.txt",settle:true})');
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("denied");
    expect(fs.readFileSync(path.join(f.projects[0]!, "fixture.txt"), "utf8")).toBe("source:project-a\n");
    expect(wire.forms).toHaveLength(execute === "ask" && elicitation ? 1 : 0);
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
    expect(wire.forms).toHaveLength(1);
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
    expect(wire.forms).toHaveLength(1);
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
