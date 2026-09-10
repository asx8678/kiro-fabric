import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import type { LocalReadManyResult, LocalReadWindow } from "../src/providers/local-contract.js";
import { schemaValidationMessage } from "../src/schema-validation.js";

const fixtures: { base: string; provider: LocalCodingProvider }[] = [];
afterEach(async () => {
  for (const { base, provider } of fixtures.splice(0)) {
    await provider.close(); fs.rmSync(base, { recursive: true, force: true });
  }
});
function fixture(budget = 20000) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-read-many-")));
  const root = path.join(base, "workspace"); fs.mkdirSync(root);
  const provider = new LocalCodingProvider({ root, lockRoot: path.join(base, "locks"), maxResultChars: budget });
  const registry = new ActionRegistry(); registry.register(provider);
  fixtures.push({ base, provider });
  const call = async (windows: LocalReadWindow[], maxChars = 16000) => {
    const result = await registry.invoke("local.readMany", { windows, maxChars }, {
      cwd: "/untrusted-cwd", audits: [], maxResultChars: budget,
      approve: async action => { expect(action.risk).toBe("read"); },
    }) as LocalReadManyResult;
    expect(schemaValidationMessage((await provider.describe("readMany"))!.outputSchema!, { ...result })).toBeUndefined();
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(Math.min(maxChars, budget));
    return result;
  };
  return { root, base, call };
}

describe("bounded numbered source batches", () => {
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
  });
});
