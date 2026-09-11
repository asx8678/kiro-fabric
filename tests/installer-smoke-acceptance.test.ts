import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

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
