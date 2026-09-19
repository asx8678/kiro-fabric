import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess, { type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { smokeCandidate } from "../scripts/installer-smoke.mjs";
import { acceptanceBundle } from "./installer-acceptance-fixture.js";
import { assertInstallerSmokeResult, installerSmokeCode, installerSmokeInput } from "../scripts/installer-smoke-contract.mjs";

const sentinel = "fabric-smoke-fixture-acceptance";
const success = () => ({ read: { path: "probe.txt", text: `${sentinel}\n`, totalLines: 1, truncated: false }, search: { matches: [{ path: "probe.txt", line: 1, text: sentinel }], truncated: false } });
const frame = (value: unknown) => ({ result: { content: [{ type: "text", text: JSON.stringify(value) }] } });
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("independent installer read and search acceptance", () => {
  it("accepts the exact fixture JSON, with an explicitly checked TypeScript program", () => {
    expect(assertInstallerSmokeResult(frame(success()), sentinel)).toEqual({ read: "PASS", search: "PASS" });
    expect(typeCheckFabricCode(installerSmokeCode, fabricGuestDeclarations).errors).toEqual([]);
    expect(installerSmokeInput(sentinel)).toMatchObject({ payloads: { needle: sentinel }, resultFormat: "json" });
  });
  it.each([
    ["empty search", (v: any) => { v.search.matches = []; }],
    ["missing search", (v: any) => { delete v.search; }],
    ["wrong path", (v: any) => { v.search.matches[0].path = "elsewhere.txt"; }],
    ["wrong line", (v: any) => { v.search.matches[0].line = 2; }],
    ["wrong text", (v: any) => { v.search.matches[0].text += " incidental"; }],
    ["search error with matching text", (v: any) => { v.search.error = sentinel; }],
    ["empty read", (v: any) => { v.read.text = ""; }],
    ["wrong read path", (v: any) => { v.read.path = "elsewhere.txt"; }],
    ["incidental read sentinel", (v: any) => { v.read.text = `error: ${sentinel}`; }],
    ["read error", (v: any) => { v.read.isError = true; }],
    ["truncated read", (v: any) => { v.read.truncated = true; }],
    ["truncated search", (v: any) => { v.search.truncated = true; }],
    ["failed outer execution", (v: any) => { v.status = "failed"; v.error = sentinel; }],
  ] as const)("rejects %s even when the other result contains the sentinel", (_name, mutate) => {
    const value = success(); mutate(value);
    expect(JSON.stringify(value)).toContain(sentinel);
    expect(() => assertInstallerSmokeResult(frame(value), sentinel)).toThrow(/Candidate checked/);
  });
  it("rejects MCP/RPC errors, incidental metadata/logs and non-JSON responses", () => {
    for (const bad of [
      { ...frame(success()), error: { message: sentinel } },
      { result: { ...frame(success()).result, isError: true } },
      { result: { ...frame(success()).result, error: sentinel } },
      { result: { content: [{ type: "text", text: sentinel }] } },
      { result: { content: [{ type: "text", text: "{}" }], metadata: sentinel } },
      { result: { content: [{ type: "text", text: JSON.stringify(success()) + `\n\nFabric logs: ${sentinel}` }] } },
    ]) expect(() => assertInstallerSmokeResult(bad, sentinel)).toThrow();
  });
  it.each(["success", "empty-search", "extra-tool", "out-of-order"] as const)("checks independent fixture results over real stdio transport (%s)", async behavior => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "smoke-stdio-acceptance-"))); roots.push(root);
    const bundle = await acceptanceBundle(path.join(root, "bundle"), behavior);
    if (behavior === "success") expect(await smokeCandidate(bundle.root)).toEqual({ integrity: "PASS", privateTools: "PASS", backend: "PASS", authenticatedKiro: "NOT TESTED" });
    else await expect(smokeCandidate(bundle.root)).rejects.toThrow(behavior === "empty-search" ? /checked search/ : behavior === "extra-tool" ? /inventory mismatch/ : /out of order/);
  }, 60000);
  it("retries private-tool timeouts once and still rejects bad versions before backend startup", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "smoke-probe-retry-"))); roots.push(root);
    const bundle = await acceptanceBundle(path.join(root, "bundle"), "success"), nativeSpawn = childProcess.spawnSync;
    const counts = new Map<string, number>();
    let mode = "recovered";
    const spawn = vi.spyOn(childProcess, "spawn");
    vi.spyOn(childProcess, "spawnSync").mockImplementation(((file: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) => {
      if (![path.join(bundle.root, "tools/node"), path.join(bundle.root, "tools/rg")].includes(file)) return nativeSpawn(file, args, options);
      const count = (counts.get(file) ?? 0) + 1; counts.set(file, count);
      expect(options).toMatchObject({ timeout: 5000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] });
      const output = { pid: 0, output: [], stdout: "", stderr: "", signal: null };
      if (mode === "exit") return { ...output, status: 7 };
      if (count === 1 || mode === "timeout") return { ...output, status: null, error: Object.assign(new Error("fixture timeout"), { code: "ETIMEDOUT" }) };
      if (mode === "wrong-version") return { ...output, status: 0, stdout: "wrong version\n" };
      return nativeSpawn(file, args, options);
    }) as typeof childProcess.spawnSync);
    syncBuiltinESMExports();
    expect(await smokeCandidate(bundle.root)).toMatchObject({ privateTools: "PASS", backend: "PASS", authenticatedKiro: "NOT TESTED" });
    expect(counts.get(path.join(bundle.root, "tools/node"))).toBe(2);
    expect(counts.get(path.join(bundle.root, "tools/rg"))).toBe(2);
    for (mode of ["timeout", "wrong-version", "exit"]) {
      counts.clear(); spawn.mockClear();
      await expect(smokeCandidate(bundle.root)).rejects.toThrow("Candidate private node version/compatibility check failed");
      expect(counts.get(path.join(bundle.root, "tools/node"))).toBe(mode === "exit" ? 1 : 2);
      expect(counts.has(path.join(bundle.root, "tools/rg"))).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    }
  });
  it("accepts real structured local read and ripgrep results, not a serialized sentinel", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "installer-smoke-contract-"))); roots.push(root);
    const workspace = path.join(root, "workspace"); fs.mkdirSync(workspace, { mode: 0o700 });
    fs.writeFileSync(path.join(workspace, "probe.txt"), `${sentinel}\n`, { mode: 0o600 });
    const provider = new LocalCodingProvider({ root: workspace, lockRoot: path.join(root, "locks"), maxResultChars: 20000 });
    const registry = new ActionRegistry(); registry.register(provider);
    const context = { cwd: workspace, maxResultChars: 20000, audits: [], approve: async () => {} };
    try {
      const read = await registry.invoke("local.read", { path: "probe.txt", limit: 1 }, context);
      const search = await registry.invoke("local.grep", { pattern: sentinel, path: ".", literal: true, limit: 2 }, context);
      expect(assertInstallerSmokeResult(frame({ read, search }), sentinel)).toEqual({ read: "PASS", search: "PASS" });
      const missing = await registry.invoke("local.grep", { pattern: "definitely-absent", path: ".", literal: true }, context);
      expect(() => assertInstallerSmokeResult(frame({ read, search: missing }), sentinel)).toThrow(/checked search/);
    } finally { await provider.close(); }
  });
});
