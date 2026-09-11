import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import type { LocalReadManyResult, LocalReadWindow, LocalReadResult } from "../src/providers/local-contract.js";
import { schemaValidationMessage } from "../src/schema-validation.js";

const fixtures: { base: string; provider: LocalCodingProvider }[] = [];
afterEach(async () => {
  for (const { base, provider } of fixtures.splice(0)) {
    await provider.close(); fs.rmSync(base, { recursive: true, force: true });
  }
});
function fixture(budget = 20000, maxReadManyChars?: number) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-read-many-")));
  const root = path.join(base, "workspace"); fs.mkdirSync(root);
  const provider = new LocalCodingProvider({ root, lockRoot: path.join(base, "locks"), maxResultChars: budget, ...(maxReadManyChars === undefined ? {} : { maxReadManyChars }) });
  const registry = new ActionRegistry(); registry.register(provider);
  fixtures.push({ base, provider });
  const context = {
      cwd: "/untrusted-cwd", audits: [], maxResultChars: budget,
      approve: async (action: { risk: string }) => { expect(action.risk).toBe("read"); },
  };
  const call = async (windows: LocalReadWindow[], maxChars?: number) => {
    const result = await registry.invoke("local.readMany", { windows, ...(maxChars === undefined ? {} : { maxChars }) }, context) as LocalReadManyResult;
    expect(schemaValidationMessage((await provider.describe("readMany"))!.outputSchema!, { ...result })).toBeUndefined();
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(Math.min(maxChars ?? 32000, budget, maxReadManyChars ?? 40000));
    return result;
  };
  return { root, base, call, read: (file: string) => registry.invoke("local.read", { path: file, limit: 2000 }, context) as Promise<LocalReadResult> };
}

describe("bounded numbered source batches", () => {
  it("exposes a hash-bound unread tail even when the default requested window is complete", async () => {
    const f = fixture();
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(f.root, "large"), lines.join("\n") + "\n");
    const first = await f.call([{ path: "large" }]);
    expect(first).toMatchObject({ complete: true, remaining: [], unreadTails: [
      { path: "large", offset: 201, limit: 300, expectedSha256: first.files[0]!.sha256 },
    ] });
    const tail = await f.call(first.unreadTails);
    expect(tail).toMatchObject({ complete: true, remaining: [], unreadTails: [] });
    expect([...first.files, ...tail.files].map(f => f.source).join("\n")).toBe(lines.map((line, i) => `${i + 1}: ${line}`).join("\n"));
    const whole = await f.call([{ path: "large", limit: 2000 }]);
    expect(whole).toMatchObject({ complete: true, unreadTails: [] });
    expect(whole.files[0]!.source).toBe([...first.files, ...tail.files].map(f => f.source).join("\n"));
    fs.appendFileSync(path.join(f.root, "large"), "changed\n");
    await expect(f.call(first.unreadTails)).rejects.toThrow("source changed");
  });

  it("summarizes suffixes once per snapshot without mistaking empty or out-of-order windows for EOF", async () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.root, "large"), "line\n".repeat(2400));
    const partial = await f.call([{ path: "large", offset: 101, limit: 10 }, { path: "large", limit: 5 }, { path: "large", offset: 9999 }]);
    expect(partial.unreadTails).toEqual([{ path: "large", offset: 111, limit: 2000, expectedSha256: partial.files[0]!.sha256 }]);
    // This suffix summary deliberately makes no claim about the unrequested gap.
    const atEnd = await f.call([{ path: "large", offset: 2400 }, { path: "large", limit: 5 }]);
    expect(atEnd.unreadTails).toEqual([]);
  });

  it("delivers a related source batch in one default call instead of two at the former 16000 cap", async () => {
    const f = fixture(2_000_000);
    const lines = Array.from({ length: 220 }, (_, i) => `route(${i}, { target: "worker-${i}", retry: false, description: "${"configuration ".repeat(4)}" });`);
    fs.writeFileSync(path.join(f.root, "routes"), lines.join("\n") + "\n");
    fs.writeFileSync(path.join(f.root, "caller"), "dispatch(request, routes);\n");
    const windows = [{ path: "routes", limit: 2000 }, { path: "caller" }];
    const full = await f.call(windows);
    expect(full.complete).toBe(true);
    expect(JSON.stringify(full).length).toBeGreaterThan(20000);
    expect(full.files.map(file => file.source).join("\n")).toBe(lines.map((line, i) => `${i + 1}: ${line}`).join("\n") + "\n1: dispatch(request, routes);");
    const first = await f.call(windows, 16000);
    expect(first.complete).toBe(false);
    const second = await f.call(first.remaining, 16000);
    expect(second.complete).toBe(true);
    expect([...first.files, ...second.files].map(file => file.source).join("\n")).toBe(full.files.map(file => file.source).join("\n"));
    const single = await f.read("routes");
    expect(JSON.stringify(single).length).toBeLessThanOrEqual(20000);
    expect(single.truncated).toBe(true);
  });

  it("permits an explicit 40000 batch while keeping the default and smaller runtime caps", async () => {
    for (const [nested, visible] of [[2_000_000, 40000], [19000, 40000], [2_000_000, 8000]] as const) {
      const f = fixture(nested, visible);
      fs.writeFileSync(path.join(f.root, "large"), 'unicode 🛰 "quoted" \\ '.repeat(3).concat("\n").repeat(460));
      const defaultPage = await f.call([{ path: "large", limit: 2000 }]);
      const largePage = await f.call([{ path: "large", limit: 2000 }], 40000);
      if (nested > 40000 && visible === 40000) {
        expect(defaultPage.complete).toBe(false);
        expect(largePage.complete).toBe(true);
        expect(JSON.stringify(largePage).length).toBeGreaterThan(32000);
      } else {
        expect(largePage.complete).toBe(false);
        expect(largePage.files[0]!.nextOffset).toBe(defaultPage.files[0]!.nextOffset);
      }
    }
  });

  it("preserves requested ranges, indentation, CRLF, Unicode and empty/EOF evidence", async () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.root, "rules"), "first\r\n\r\n  café 🛰\r\nlast");
    fs.writeFileSync(path.join(f.root, "empty"), "");
    const result = await f.call([{ path: "rules", offset: 2, limit: 2 }, { path: "rules", offset: 4 }, { path: "empty" }, { path: "rules", offset: 99 }]);
    expect(result).toMatchObject({ complete: true, remaining: [], files: [
      { path: "rules", startLine: 2, endLine: 3, totalLines: 4, source: "2: \n3:   café 🛰", truncated: true, nextOffset: 4 },
      { path: "rules", startLine: 4, endLine: 4, source: "4: last", truncated: false },
      { path: "empty", startLine: 1, endLine: null, totalLines: 0, source: "", truncated: false },
      { path: "rules", startLine: 99, endLine: null, totalLines: 4, source: "", truncated: false },
    ] });
    expect(result.files[0]!.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.files[1]!.sha256).toBe(result.files[0]!.sha256);
  });

  it("recovers every line across aggregate-budget pages without gaps or duplicates", async () => {
    const f = fixture(1800);
    const lines = Array.from({ length: 260 }, (_, i) => i === 239 ? "TAIL DEFECT" : `row ${i} "quoted" \\ café ${"x".repeat(30)}`);
    fs.writeFileSync(path.join(f.root, "long"), lines.join("\n") + "\n");
    fs.writeFileSync(path.join(f.root, "other"), "second file\n");
    let windows: LocalReadWindow[] = [{ path: "long", limit: 2000 }, { path: "other" }];
    const source: string[] = [];
    let count = 0;
    while (windows.length) {
      expect(count++).toBeLessThan(100);
      const result = await f.call(windows, 1600);
      for (const file of result.files) source.push(file.source);
      expect(result.complete).toBe(result.remaining.length === 0);
      if (result.remaining[0]?.path === "long") expect(result.remaining[0].expectedSha256).toMatch(/^[a-f0-9]{64}$/u);
      windows = result.remaining;
    }
    expect(count).toBeGreaterThan(1);
    expect(source.join("\n")).toBe(lines.map((line, i) => `${i + 1}: ${line}`).join("\n") + "\n1: second file");
  });

  it("rejects changed-source continuations and does not read past an explicit range", async () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.root, "long"), "test line\n".repeat(250));
    const first = await f.call([{ path: "long", offset: 40, limit: 150 }], 1000);
    expect(first.complete).toBe(false);
    fs.appendFileSync(path.join(f.root, "long"), "changed\n");
    await expect(f.call(first.remaining, 1000)).rejects.toThrow("source changed");
    const range = await f.call([{ path: "long", offset: 40, limit: 3 }]);
    expect(range).toMatchObject({ complete: true, remaining: [], files: [{ startLine: 40, endLine: 42, totalLines: 251, nextOffset: 43, truncated: true }] });
  });

  it("fails on invalid batches, unsafe paths and an oversized first line instead of looping", async () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.root, "huge"), "x".repeat(4000));
    fs.writeFileSync(path.join(f.base, "outside"), "private");
    fs.symlinkSync(path.join(f.base, "outside"), path.join(f.root, "link"));
    for (const windows of [[], Array.from({ length: 33 }, () => ({ path: "huge" })), [{ path: "../outside" }], [{ path: "link" }], [{ path: "huge", expectedSha256: "invalid" }]]) {
      await expect(f.call(windows)).rejects.toThrow();
    }
    await expect(f.call([{ path: "huge" }], 1000)).rejects.toThrow("single line");
    await expect(f.call([{ path: "huge" }], 40001)).rejects.toThrow();
  });
});
