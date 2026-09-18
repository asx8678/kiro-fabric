import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebProvider, browserHarnessEnvironment, resolveBrowserHarnessExecutable, verifyBrowserHarnessExecutable } from "../src/providers/web-provider.js";
import { assertPublicWebInput } from "../src/providers/web-privacy.js";
import { createKiroRuntime, type KiroRuntime } from "../src/kiro/runtime.js";
import { DEFAULT_FABRIC_CONFIG, loadFabricConfig, normalizeFabricConfig } from "../src/config.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";
import { FabricDeadline } from "../src/runtime/deadline.js";
import type { FabricExecutionApprover } from "../src/execution-service.js";

const roots: string[] = [], runtimes: KiroRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const search = { source: "google", query: "facts", results: [{ title: "Primary source", url: "https://example.com/", snippet: "Evidence" }] };
const page = { url: "https://example.com/", finalUrl: "https://example.com/source", title: "Source", text: "Verified text", chars: 13, truncated: false, selector: "article, main, [role=main]" };
function fixture(body = `console.log(JSON.stringify(process.argv[2].includes('google.com/search?') ? ${JSON.stringify(search)} : ${JSON.stringify(page)}));`) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-web-"))); roots.push(root);
  const command = path.join(root, "browser harness.mjs"), calls = path.join(root, "calls");
  fs.writeFileSync(command, `#!${process.execPath}\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n');\n${body}\n`, { mode: 0o700 });
  return { root, command, calls, provider: new WebProvider({ executablePath: command }) };
}
function runtimeFixture(web: Record<string, unknown> = {}) {
  const f = fixture();
  const runtime = createKiroRuntime({ cwd: f.root, configFile: path.join(f.root, "config.json"), mcpConfigPath: path.join(f.root, "mcp.json"), artifactsRoot: path.join(f.root, "artifacts"),
    config: normalizeFabricConfig({ web: { enabled: true, command: f.command, ...web }, mcp: { enabled: false }, executor: { timeoutMs: 10000 } }),
  }); runtimes.push(runtime);
  const approve: FabricExecutionApprover = { approve: async () => {}, prepareApproval: () => ({ decision: "allow" }) };
  const run = (code: string, approver = approve) => runtime.service.execute({ code, approver, workspaceBound: false });
  return { ...f, runtime, run };
}

describe("browser-backed web provider", () => {
  it("is opt-in even when global network policy allows calls", () => {
    expect(DEFAULT_FABRIC_CONFIG.web.enabled).toBe(false);
    expect(normalizeFabricConfig({ approvals: { network: "allow" } }).web.enabled).toBe(false);
  });
  it.each([
    "password=synthetic-only", "service access_token: synthetic-only",
    "https://example.com/?token=synthetic-only", "https://example.com/?X-Amz-Signature=dummy",
    "https://example.com/?%74oken=", "https://example.com/#access_token=synthetic-only",
    "notes api_key%253Dsynthetic-only", "-----BEGIN PRIVATE KEY----- synthetic",
    "service Bearer synthetic-only", "error ghp_abcdefghijklmnopqrstuvwx",
    "AKIAABCDEFGHIJKLMNOP", "customer person@example.com", "notes ＰＡＳＳＷＯＲＤ=synthetic-only",
  ])("rejects recognized sensitive inputs before any CLI effect: %s", async input => {
    const f = fixture();
    await expect(f.provider.invoke("search", { query: input }, { cwd: f.root })).rejects.toThrow("possible sensitive information");
    if (input.startsWith("https:")) await expect(f.provider.invoke("open", { url: input }, { cwd: f.root })).rejects.toThrow("possible sensitive information");
    expect(fs.existsSync(f.calls)).toBe(false);
  });
  it("rejects deeply nested percent-encoding disguises at every decoded layer", () => {
    for (const encoding of ["%253D", "%25253D", "%2525253D", "%252525253D"]) {
      expect(() => assertPublicWebInput(`notes api_key${encoding}synthetic-only`)).toThrow("possible sensitive information");
    }
    expect(() => assertPublicWebInput("notes synthetic-only")).not.toThrow();
  });

  it("retains useful public queries without claiming to recognize all confidential prose", () => {
    for (const query of ["OAuth token refresh documentation", "password reset documentation", "TypeScript release notes", "Unannounced internal project name"])
      expect(() => assertPublicWebInput(query)).not.toThrow();
  });
  it("withholds raw error diagnostics even when they contain a secret", async () => {
    const sentinel = "SYNTHETIC_PRIVATE_ERROR_123";
    const f = fixture(`console.error(${JSON.stringify(sentinel)}); process.exit(1);`);
    try { await f.provider.invoke("search", { query: "public docs" }, { cwd: f.root }); throw new Error("expected failure"); }
    catch (error) { expect(String(error)).toContain("Raw diagnostics withheld"); expect(String(error)).not.toContain(sentinel); }
  });

  it("discovers without launching code, pins executable identity, and ignores relative PATH entries", async () => {
    const f = fixture();
    expect(fs.existsSync(f.calls)).toBe(false);
    expect((await f.provider.list()).map(d => [d.name, d.risk])).toEqual([["search", "network"], ["open", "network"]]);
    const descriptions = await f.provider.list(); descriptions[0]!.description = "tampered";
    expect((await f.provider.describe("search"))!.description).not.toBe("tampered");
    expect(await f.provider.describe("eval")).toBeUndefined();
    expect(() => resolveBrowserHarnessExecutable("./browser-harness-js")).toThrow("absolute");
    vi.stubEnv("PATH", "." + path.delimiter + f.root);
    expect(resolveBrowserHarnessExecutable(path.basename(f.command)).path).toBe(f.command);
    const pinned = resolveBrowserHarnessExecutable(f.command);
    fs.renameSync(f.command, f.command + ".old"); fs.copyFileSync(f.command + ".old", f.command);
    expect(() => verifyBrowserHarnessExecutable(pinned)).toThrow("identity or trust changed");
    await expect(f.provider.invoke("search", { query: "facts" }, { cwd: f.root })).rejects.toThrow("identity or trust changed");
    expect(fs.existsSync(f.calls)).toBe(false);
  });
  it("rejects writable executables and excludes credentials/loader hooks from the child environment", () => {
    const f = fixture(); fs.chmodSync(f.command, 0o777);
    expect(() => resolveBrowserHarnessExecutable(f.command)).toThrow("trust changed");
    vi.stubEnv("NODE_OPTIONS", "--import=evil"); vi.stubEnv("BASH_ENV", "evil"); vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret"); vi.stubEnv("CDP_RECORD", "0");
    expect(browserHarnessEnvironment()).toMatchObject({ CDP_RECORD: "0" });
    for (const key of ["NODE_OPTIONS", "BASH_ENV", "AWS_SECRET_ACCESS_KEY"]) expect(browserHarnessEnvironment()[key]).toBeUndefined();
  });
  it("validates and normalizes before browser effects, preserving query as data", async () => {
    const f = fixture();
    expect(f.provider.prepareArguments("search", { query: "  Ｆacts  " })).toEqual({ query: "Facts", limit: 5 });
    for (const args of [{ query: " " }, { query: "x", limit: 11 }, { query: "x", limit: 1.5 }, { query: "x".repeat(501) }]) expect(() => f.provider.prepareArguments("search", args)).toThrow();
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "https://user:pass@example.com", "relative"]) expect(() => f.provider.prepareArguments("open", { url })).toThrow();
    for (const args of [{ maxChars: 0 }, { settleMs: -1 }, { selector: "\0" }, { wait: "invalid" }]) expect(() => f.provider.prepareArguments("open", { url: "https://example.com", ...args })).toThrow();
    expect(fs.existsSync(f.calls)).toBe(false);
    const query = 'facts " ` ${process.exit(1)} \\ ; $(touch nope)\n';
    expect(await f.provider.invoke("search", { query }, { cwd: f.root })).toMatchObject({ query: query.trim(), results: search.results });
    const [argv] = fs.readFileSync(f.calls, "utf8").trim().split("\n").map(s => JSON.parse(s));
    expect(argv).toHaveLength(1); expect(argv[0]).toContain(encodeURIComponent(query.trim()));
    const result = await f.provider.invoke("open", { url: "https://example.com", maxChars: 8 }, { cwd: f.root });
    expect(result).toMatchObject({ url: "https://example.com/", text: "Verified", truncated: true, chars: 13 });
  });
  it.each([
    ['console.log("not JSON")', "invalid JSON"],
    ['console.log("{}")', "invalid results"],
    ['console.log("[]")', "invalid result"],
    ['console.error("Cannot connect to Chromium"); process.exit(1)', "Raw diagnostics withheld"],
    ['process.stdout.write("x".repeat(1_000_000))', "output exceeded"],
  ])("fails explicitly for malformed/failed/bounded CLI output: %s", async (body, message) => {
    const f = fixture(body);
    await expect(f.provider.invoke("search", { query: "facts" }, { cwd: f.root })).rejects.toThrow(message);
  });
  it("settles a hung CLI on timeout and cancellation, and never launches after an expired deadline", async () => {
    const f = fixture("setInterval(() => {}, 1000)");
    const provider = new WebProvider({ executablePath: f.command, searchTimeoutMs: 100 });
    await expect(provider.invoke("search", { query: "facts" }, { cwd: f.root })).rejects.toThrow("timed out");
    const signal = AbortSignal.timeout(100);
    await expect(f.provider.invoke("search", { query: "facts" }, { cwd: f.root, signal })).rejects.toThrow("cancelled");
    // The child is killed on timeout and may not reach its own startup write;
    // absence of the capture file is itself evidence that nothing launched.
    const captures = () => fs.existsSync(f.calls) ? fs.readFileSync(f.calls, "utf8") : "";
    const before = captures();
    let now = 0; const deadline = new FabricDeadline(10, 10, () => now); now = 20;
    await expect(f.provider.invoke("search", { query: "facts" }, { cwd: f.root, deadline })).rejects.toThrow("timed out");
    expect(captures()).toBe(before);
  });
  it("scales browser cleanup headroom so a valid 1000ms timeout still has a usable budget", async () => {
    const f = fixture();
    // Inspect the generated budget through a real subprocess without charging
    // Node cold-start latency against the 1000ms behavior under test.
    const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
    fs.writeFileSync(f.command, `#!/bin/sh\nprintf '%s' "$1" > ${quote(f.calls)}\nprintf '%s\\n' ${quote(JSON.stringify(search))}\n`);
    const budgets = async (searchTimeoutMs: number): Promise<number[]> => {
      const provider = new WebProvider({ executablePath: f.command, searchTimeoutMs });
      await provider.invoke("search", { query: "facts" }, { cwd: f.root });
      const code = fs.readFileSync(f.calls, "utf8");
      return [...code.matchAll(/timeoutMs: (\d+)/g)].map(match => Number(match[1]));
    };
    const minimum = await budgets(1_000);
    expect(minimum.length).toBeGreaterThanOrEqual(3);
    // A fixed 1000ms cleanup reserve previously left 1ms for connect, navigation
    // and extraction on the documented 1000ms minimum.
    expect(Math.min(...minimum)).toBeGreaterThanOrEqual(500);
    expect(Math.min(...(await budgets(30_000)))).toBeGreaterThanOrEqual(29_000);
  });
  it("loads web configuration without rewriting user consent or legacy files", () => {
    const f = fixture(), file = path.join(f.root, "config.json");
    const bytes = JSON.stringify({ web: { command: f.command, searchTimeoutMs: 1234 }, approvals: { network: "deny" } });
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    expect(loadFabricConfig(file).web).toEqual({ ...DEFAULT_FABRIC_CONFIG.web, command: f.command, searchTimeoutMs: 1234 });
    expect(loadFabricConfig(file).approvals.network).toBe("deny"); expect(fs.readFileSync(file, "utf8")).toBe(bytes);
    for (const web of [{ enabled: "yes" }, { searchTimeoutMs: 0 }, { command: "" }, { unknown: true }]) {
      fs.writeFileSync(file, JSON.stringify({ web })); expect(() => loadFabricConfig(file)).toThrow();
    }
    expect(normalizeFabricConfig({ web: { enabled: false } }).web.enabled).toBe(false);
  });
});

describe("checked web runtime", () => {
  it("registers search/open in discovery and executes typed search-to-source reading without a workspace", async () => {
    const f = runtimeFixture();
    expect((await f.runtime.registry.list()).filter(d => d.provider === "web").map(d => d.ref)).toEqual(["web.open", "web.search"]);
    expect(f.runtime.providers().find(p => p.name === "web")?.available).toBe(true);
    const result = await f.run('const s = await web.search({query:"facts",limit:2}); const first=s.results[0]; if (!first) return s; return {search:s,source:await web.open({url:first.url,maxChars:1000})};');
    expect(result.success, result.error).toBe(true); expect(result.value).toEqual({ search, source: page });
    const generic = await f.run('return await tools.call({ref:"web.search",args:{query:"facts"}});');
    expect(generic.success, generic.error).toBe(true); expect(generic.value).toEqual(search);
    for (const code of ['return await web.search({query:"q"});', 'return await web.open({url:"https://example.com",wait:"load",settleMs:5,maxChars:100});']) expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors).toEqual([]);
    expect(typeCheckFabricCode('return await web.search({code:"evil"});', fabricGuestDeclarations).errors.length).toBeGreaterThan(0);
  });
  it("denies both facades before spawning and rejects generic unknown fields before approval", async () => {
    const f = runtimeFixture();
    const prepareApproval = vi.fn(() => ({ decision: "deny" as const, reason: "network denied" }));
    const deny: FabricExecutionApprover = { approve: async () => { throw new Error("denied"); }, prepareApproval };
    for (const code of ['return await web.search({query:"facts"});', 'return await web.open({url:"https://example.com"});', 'return await tools.call({ref:"web.search",args:{query:"facts"}});']) {
      const result = await f.run(code, deny); expect(result.success).toBe(false); expect(result.error).toContain("denied");
    }
    expect(prepareApproval.mock.calls.length).toBe(3);
    expect((await f.run('return await tools.call({ref:"web.search",args:{query:"facts",code:"evil"}});', deny)).success).toBe(false);
    expect(prepareApproval.mock.calls.length).toBe(3); expect(fs.existsSync(f.calls)).toBe(false);
  });
  it.each([{ enabled: false }, { command: "/no-such-fabric-web/browser-harness-js" }])("reports unavailable without breaking other providers: %j", async web => {
    const f = runtimeFixture(web);
    expect(f.runtime.providers().find(p => p.name === "web")).toMatchObject({ available: false, reason: expect.any(String) });
    expect((await f.run('return await tools.providers();')).success).toBe(true);
    expect((await f.run('return await web.search({query:"facts"});')).success).toBe(false);
    expect(fs.existsSync(f.calls)).toBe(false);
  });
});
