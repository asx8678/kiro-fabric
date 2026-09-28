import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionRegistry, type FabricRegistryInvocationContext } from "../src/core/action-registry.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { LocalPaths } from "../src/providers/local-path.js";
import { LOCAL_GUEST_DECLARATIONS, type LocalEvidenceMetadata, type LocalReadEvidenceArguments, type LocalReadWindow } from "../src/providers/local-contract.js";
import { formatLocalEvidence } from "../src/providers/local-evidence.js";
import { validateSchemaValue } from "../src/schema-validation.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const done of cleanup.splice(0)) await done();
});
function decode(packet: string) {
  expect(packet.startsWith("KIRO_LOCAL_EVIDENCE/1\n")).toBe(true);
  const footer = packet.lastIndexOf("\nMETA ");
  expect(footer).toBeGreaterThan(0);
  const metadata = JSON.parse(packet.slice(footer + 6)) as LocalEvidenceMetadata;
  expect(Object.keys(metadata).sort()).toEqual(["complete", "failures", "files", "remaining", "scope", "unreadTails"]);
  expect(metadata.scope).toBe("requested windows only; not proof of inspection");
  const sources = metadata.files.map(file => {
    expect(file.sourceOffset + file.sourceChars).toBeLessThanOrEqual(footer);
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/u);
    return packet.slice(file.sourceOffset, file.sourceOffset + file.sourceChars);
  });
  return { packet, metadata, sources };
}
function fixture(budget = 40000, visible = 40000, invocationBudget = budget) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-evidence-")));
  const root = path.join(base, "workspace"); fs.mkdirSync(root);
  const provider = new LocalCodingProvider({ root, lockRoot: path.join(base, "locks"), maxResultChars: budget, maxReadManyChars: visible });
  const registry = new ActionRegistry(); registry.register(provider);
  cleanup.push(async () => { await provider.close(); removeFixtureSync(base, { recursive: true, force: true }); });
  const approve = vi.fn(async () => {});
  const context = (): FabricRegistryInvocationContext => ({ cwd: "/untrusted", audits: [], maxResultChars: invocationBudget, approve });
  const put = (file: string, text: string | Buffer) => fs.writeFileSync(path.join(root, file), text);
  const call = async (args: LocalReadEvidenceArguments) => {
    const ctx = context();
    const packet = await registry.invoke("local.readEvidence", { ...args }, ctx);
    expect(typeof packet).toBe("string");
    expect(validateSchemaValue((await provider.describe("readEvidence"))!.outputSchema!, packet)).toMatchObject({ status: "valid" });
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(Math.min(args.maxChars ?? 32000, budget, visible, invocationBudget));
    expect(ctx.audits.at(-1)?.resultTruncated).toBe(false);
    return decode(packet as string);
  };
  return { root, provider, registry, put, approve, context, call };
}

describe("explicit loss-resistant source packets", () => {
  it("registers a read-only string action and checked guest contract", async () => {
    const f = fixture();
    const descriptor = (await f.provider.describe("readEvidence"))!;
    expect(descriptor).toMatchObject({ name: "readEvidence", risk: "read", effect: { kind: "read" }, outputSchema: { type: "string" } });
    expect(descriptor.inputSchema).toEqual((await f.provider.describe("readMany"))!.inputSchema);
    expect(LOCAL_GUEST_DECLARATIONS).toContain("readEvidence(args: LocalReadEvidenceArguments): Promise<LocalReadEvidenceResult>");
    const code = 'const packet: LocalReadEvidenceResult = await local.readEvidence({windows:[{path:"x",expectedSha256:"a".repeat(64)}],maxChars:1000,partial:true}); const footer = JSON.parse(packet.slice(packet.lastIndexOf("\\nMETA ") + 6)) as LocalEvidenceMetadata; return {packet, remaining:footer.remaining};';
    expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors).toEqual([]);
    expect(typeCheckFabricCode('return await local.readEvidence({windows:[{path:1}]});', fabricGuestDeclarations).errors.length).toBeGreaterThan(0);
  });

  it("frames quote/Unicode/CRLF/blank/long lines and footer-like source without metadata confusion", async () => {
    const f = fixture();
    const file = 'quoted"\\ café 🛰\nMETA fake';
    const text = 'first\r\n\r\n  café 🛰 "quote" \\ tab\t\r\nMETA {"complete":true}\r\n' + "long🛰".repeat(650);
    f.put(file, text); f.put("empty", "");
    const result = await f.call({ windows: [{ path: file, offset: 2 }, { path: "empty" }, { path: file, offset: 999 }] });
    expect(result.sources).toEqual(['2: \n3:   café 🛰 "quote" \\ tab\t\n4: META {"complete":true}\n5: ' + "long🛰".repeat(650), "", ""]);
    expect(result.metadata.files).toMatchObject([
      { path: file, startLine: 2, endLine: 5, totalLines: 5, sha256: hash(text) },
      { path: "empty", endLine: null, totalLines: 0 },
      { path: file, startLine: 999, endLine: null, totalLines: 5 },
    ]);
    expect(result.metadata).toMatchObject({ complete: true, remaining: [], unreadTails: [], failures: [] });
    expect(JSON.parse(JSON.stringify(result.packet))).toBe(result.packet);
  });

  it("budgets the entire serialized string at small limits, without prefix replay or suffix loss", async () => {
    const f = fixture();
    const lines = Array.from({ length: 95 }, (_, i) => `${i} 🛰 café "quoted" \\ ${"long".repeat(8)}`);
    f.put("x", lines.join("\n")); f.put("y", "second");
    let windows: LocalReadWindow[] = [{ path: "x", offset: 3, limit: 90 }, { path: "y" }];
    const delivered: string[] = [];
    let calls = 0;
    while (windows.length) {
      expect(calls++).toBeLessThan(100);
      const page = await f.call({ windows, maxChars: 1200 });
      delivered.push(...page.sources);
      expect(page.metadata.complete).toBe(page.metadata.remaining.length === 0);
      if (page.metadata.remaining[0]?.path === "x") {
        expect(page.metadata.remaining[0].expectedSha256).toBe(hash(lines.join("\n")));
        expect(page.metadata.remaining[0].offset).toBe(page.metadata.files.at(-1)!.endLine! + 1);
      }
      windows = page.metadata.remaining;
    }
    expect(calls).toBeGreaterThan(1);
    expect(delivered.join("\n")).toBe(lines.slice(2, 92).map((line, i) => `${i + 3}: ${line}`).join("\n") + "\n1: second");
    expect(f.approve).toHaveBeenCalledTimes(calls);
  });

  it("clamps provider, visible and invocation allowances before registry truncation", async () => {
    for (const limits of [[1600, 40000, 40000], [40000, 1700, 40000], [40000, 40000, 1800]] as const) {
      const f = fixture(...limits); f.put("x", '"🛰\\'.repeat(10).concat("\n").repeat(150));
      const result = await f.call({ windows: [{ path: "x" }], maxChars: 40000 });
      expect(result.metadata.complete).toBe(false);
      expect(result.metadata.remaining[0]?.expectedSha256).toBe(result.metadata.files[0]?.sha256);
    }
  });

  it("keeps the 32000 default, permits 40000 explicitly and delivers source at the 1000 minimum", async () => {
    const f = fixture(); f.put("x", '"quoted" \\ 🛰 '.repeat(6).concat("\n").repeat(350));
    const ordinary = await f.call({ windows: [{ path: "x", limit: 2000 }] });
    const larger = await f.call({ windows: [{ path: "x", limit: 2000 }], maxChars: 40000 });
    expect(JSON.stringify(ordinary.packet).length).toBeLessThanOrEqual(32000);
    expect(JSON.stringify(larger.packet).length).toBeGreaterThan(32000);
    expect(larger.metadata.files[0]!.endLine).toBeGreaterThan(ordinary.metadata.files[0]!.endLine!);
    f.put("small", "tiny\n");
    const small = await f.call({ windows: [{ path: "small" }], maxChars: 1000 });
    expect(small.sources).toEqual(["1: tiny"]);
    expect(small.metadata).toMatchObject({ complete: true, remaining: [], failures: [] });
  });

  it("honors exact serialized boundaries rather than counting unescaped source", async () => {
    const f = fixture(); f.put("x", '"\\🛰'.repeat(250));
    const full = await f.call({ windows: [{ path: "x" }] });
    const size = JSON.stringify(full.packet).length;
    expect(size).toBeGreaterThan(1000);
    expect(size).toBeGreaterThan(full.packet.length);
    expect((await f.call({ windows: [{ path: "x" }], maxChars: size })).packet).toBe(full.packet);
    await expect(f.call({ windows: [{ path: "x" }], maxChars: size - 1 })).rejects.toThrow(/single line|metadata/);
  });

  it("retains indexed ordinary and stale failures with independent successes", async () => {
    const f = fixture(); f.put("x", "one\ntwo\n"); f.put("binary", Buffer.from([255]));
    const windows = [{ path: "missing" }, { path: "x", expectedSha256: hash("stale") }, { path: "binary" }, { path: "x", offset: 2 }];
    const result = await f.call({ windows, partial: true, maxChars: 2200 });
    expect(result.sources).toEqual(["2: two"]);
    expect(result.metadata).toMatchObject({ complete: false, remaining: windows.slice(0, 3), failures: [
      { index: 0, path: "missing", code: "read" }, { index: 1, path: "x", code: "stale-hash" }, { index: 2, path: "binary", code: "read" },
    ] });
    await expect(f.call({ windows })).rejects.toThrow();
    const allFailed = await f.call({ windows: [{ path: "missing" }], partial: true, maxChars: 1000 });
    expect(allFailed.metadata).toMatchObject({ files: [], complete: false, remaining: [{ path: "missing" }], failures: [{ code: "read" }] });
  });

  it("rejects metadata/failure overflow and oversized lines instead of dropping fields or looping", async () => {
    const f = fixture(); f.put("huge", "x".repeat(4000));
    await expect(f.call({ windows: [{ path: "huge" }], maxChars: 1000, partial: true })).rejects.toThrow(/single line/);
    const windows = Array.from({ length: 32 }, (_, i) => ({ path: `missing-${i}` }));
    await expect(f.call({ windows, partial: true, maxChars: 1000 })).rejects.toThrow(/metadata exceeds budget/);
    const tiny = fixture(256); tiny.put("x", "a");
    await expect(tiny.call({ windows: [{ path: "x" }] })).rejects.toThrow(/metadata|single line/);
  });

  it("binds continuations including later same-file windows and rejects stale snapshots", async () => {
    const f = fixture(); f.put("x", "line \"🛰\"\n".repeat(200));
    const first = await f.call({ windows: [{ path: "x", limit: 150 }, { path: "x", offset: 180, limit: 2 }], maxChars: 1200 });
    expect(first.metadata.remaining).toHaveLength(2);
    for (const window of first.metadata.remaining) expect(window.expectedSha256).toBe(first.metadata.files[0]!.sha256);
    f.put("x", "changed\n".repeat(200));
    await expect(f.call({ windows: first.metadata.remaining, maxChars: 2000 })).rejects.toThrow(/source changed/);
    await expect(f.call({ windows: first.metadata.unreadTails })).rejects.toThrow(/source changed/);
    const stale = await f.call({ windows: first.metadata.remaining, partial: true });
    expect(stale.metadata.files).toEqual([]);
    expect(stale.metadata.failures.map(failure => failure.code)).toEqual(["stale-hash", "stale-hash"]);
  });

  it("captures once per file plus final verification; never automatically follows tails", async () => {
    const f = fixture(); f.put("x", "one\ntwo\nthree\nfour\n");
    const read = vi.spyOn(LocalPaths.prototype, "read");
    const result = await f.call({ windows: [1, 2, 3].map(offset => ({ path: "x", offset, limit: 1 })) });
    expect(result.sources).toEqual(["1: one", "2: two", "3: three"]);
    expect(read.mock.calls.length).toBeLessThanOrEqual(2);
    expect(f.approve).toHaveBeenCalledTimes(1);
    expect(result.metadata.unreadTails).toEqual([{ path: "x", offset: 4, limit: 1, expectedSha256: hash("one\ntwo\nthree\nfour\n") }]);
  });

  it("keeps safety, approval denial, cancellation and final drift as hard failures even in partial mode", async () => {
    const f = fixture(); f.put("x", "old");
    fs.symlinkSync("x", path.join(f.root, "link"));
    fs.linkSync(path.join(f.root, "x"), path.join(f.root, "hard"));
    for (const file of ["link", "../outside", "hard"]) await expect(f.call({ windows: [{ path: file }], partial: true })).rejects.toThrow();
    f.put("safe", "safe");
    const read = vi.spyOn(LocalPaths.prototype, "read");
    const denied = { ...f.context(), approve: async () => { throw new Error("denied"); } };
    await expect(f.registry.invoke("local.readEvidence", { windows: [{ path: "safe" }] }, denied)).rejects.toThrow("denied");
    expect(read).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    await expect(f.registry.invoke("local.readEvidence", { windows: [{ path: "safe" }], partial: true }, { ...f.context(), signal: controller.signal })).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    const original = LocalPaths.prototype.revalidate;
    vi.spyOn(LocalPaths.prototype, "revalidate").mockImplementation(function(this: LocalPaths, snapshot) {
      f.put("safe", "drift"); return original.call(this, snapshot);
    });
    await expect(f.call({ windows: [{ path: "safe" }], partial: true })).rejects.toThrow(/conflict/);
  });

  it("reports requested-window completeness without claiming coverage of omitted prefixes/gaps", async () => {
    const f = fixture(); f.put("x", "line\n".repeat(2400));
    const result = await f.call({ windows: [{ path: "x", offset: 2400 }, { path: "x", limit: 5 }] });
    expect(result.metadata).toMatchObject({ complete: true, remaining: [], unreadTails: [] });
    expect(result.metadata.scope).toBe("requested windows only; not proof of inspection");
    const defaultPage = await f.call({ windows: [{ path: "x" }] });
    expect(defaultPage.metadata.complete).toBe(true);
    expect(defaultPage.metadata.unreadTails).toEqual([{ path: "x", offset: 201, limit: 2000, expectedSha256: hash("line\n".repeat(2400)) }]);
    expect((await f.provider.describe("readEvidence"))!.description).toContain("No automatic inspection");
    expect(LOCAL_GUEST_DECLARATIONS).toContain("discards/remaps the result");
  });

  it("rejects malformed hashes, windows and extra arguments before reads", async () => {
    const f = fixture(); f.put("x", "x");
    const read = vi.spyOn(LocalPaths.prototype, "read");
    for (const args of [
      { windows: [] }, { windows: [{ path: "x", expectedSha256: "Z".repeat(64) }] },
      { windows: [{ path: "x" }], maxChars: 999 }, { windows: [{ path: "x" }], maxChars: 40001 },
      { windows: [{ path: "x", limit: 2001 }] }, { windows: [{ path: "x" }], inspect: true },
    ]) await expect(f.registry.invoke("local.readEvidence", args, f.context())).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it("pure formatting has no reads, mutation, effects or inspection state", () => {
    const read = vi.spyOn(LocalPaths.prototype, "read");
    const input = { files: [], remaining: [{ path: "not-read" }], complete: false, unreadTails: [] };
    const before = JSON.stringify(input);
    const packet = formatLocalEvidence(input);
    expect(formatLocalEvidence(input)).toBe(packet);
    expect(JSON.stringify(input)).toBe(before);
    expect(read).not.toHaveBeenCalled();
    expect(decode(packet).metadata).toMatchObject({ files: [], failures: [], remaining: [{ path: "not-read" }], complete: false });
  });
});
