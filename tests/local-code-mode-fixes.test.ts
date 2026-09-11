import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ActionRegistry, type FabricRegistryInvocationContext } from "../src/core/action-registry.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { LocalPaths } from "../src/providers/local-path.js";
import type { LocalReadManyResult, LocalGrepResult } from "../src/providers/local-contract.js";
import { schemaValidationMessage } from "../src/schema-validation.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const done of cleanup.splice(0)) await done(); });
function fixture(budget = 20000) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "local-fixes-")));
  const root = path.join(base, "src"); fs.mkdirSync(root);
  const provider = new LocalCodingProvider({ root, lockRoot: path.join(base, "locks"), maxResultChars: budget });
  const registry = new ActionRegistry(); registry.register(provider);
  cleanup.push(async () => { await provider.close(); fs.rmSync(base, { recursive: true, force: true }); });
  const put = (file: string, text: string) => fs.writeFileSync(path.join(root, file), text);
  const approve = vi.fn(async () => {});
  const call = (name: string, args: Record<string, unknown>, approval: FabricRegistryInvocationContext["approve"] = approve) => registry.invoke(`local.${name}`, args, { cwd: root, audits: [], maxResultChars: budget, approve: approval });
  return { root, provider, put, approve, call };
}
it("resolves every edit on the original snapshot and publishes one approved result", async () => {
  const f = fixture(); f.put("x", "alpha beta");
  await f.call("edit", { path: "x", expectedSha256: hash("alpha beta"), edits: [{ oldText: "alpha", newText: "beta" }, { oldText: "beta", newText: "gamma" }] });
  expect(fs.readFileSync(path.join(f.root, "x"), "utf8")).toBe("beta gamma");
  expect(f.approve).toHaveBeenCalledTimes(1);
});
it("late missing and overlapping anchors fail atomically before approval", async () => {
  const f = fixture(); f.put("x", "abcdef");
  for (const oldText of ["missing", "bc"]) {
    await expect(f.call("edit", { path: "x", edits: [{ oldText: "abc", newText: "Z" }, { oldText, newText: "Q" }] })).rejects.toThrow(/not found|overlap/);
    expect(fs.readFileSync(path.join(f.root, "x"), "utf8")).toBe("abcdef");
  }
  expect(f.approve).not.toHaveBeenCalled();
});
it("rejects stale hashes before approval and file drift during approval", async () => {
  const f = fixture(); f.put("x", "old");
  const args = { path: "x", expectedSha256: hash("old"), edits: [{ oldText: "old", newText: "new" }] };
  await expect(f.call("edit", { ...args, expectedSha256: hash("stale") })).rejects.toThrow(/conflict/);
  expect(f.approve).not.toHaveBeenCalled();
  await expect(f.call("edit", args, async () => { f.put("x", "drift"); })).rejects.toThrow(/conflict/);
  expect(fs.readFileSync(path.join(f.root, "x"), "utf8")).toBe("drift");
});
it("partial reads retain indexed missing-file and stale-hash failures plus successes", async () => {
  const f = fixture(); f.put("x", "one\ntwo\n");
  const windows = [{ path: "missing" }, { path: "x", expectedSha256: hash("stale") }, { path: "x", offset: 2 }];
  const result = await f.call("readMany", { windows, partial: true }) as LocalReadManyResult;
  expect(result).toMatchObject({ complete: false, remaining: windows.slice(0, 2), failures: [{ index: 0, code: "read" }, { index: 1, code: "stale-hash" }], files: [{ source: "2: two" }] });
  expect(schemaValidationMessage((await f.provider.describe("readMany"))!.outputSchema!, { ...result })).toBeUndefined();
  await expect(f.call("readMany", { windows })).rejects.toThrow();
});
it("same-file windows capture once plus one final identity/hash verification", async () => {
  const f = fixture(); f.put("x", "one\ntwo\nthree\n");
  const read = vi.spyOn(LocalPaths.prototype, "read");
  const result = await f.call("readMany", { windows: [1, 2, 3].map(offset => ({ path: "x", offset, limit: 1 })) }) as LocalReadManyResult;
  expect(result.files.map(file => file.source)).toEqual(["1: one", "2: two", "3: three"]);
  expect(read).toHaveBeenCalledTimes(2);
});
it("partial never swallows unsafe paths or final snapshot drift", async () => {
  const f = fixture(); f.put("x", "old"); fs.symlinkSync("x", path.join(f.root, "link"));
  for (const file of ["link", "../outside"]) await expect(f.call("readMany", { partial: true, windows: [{ path: "x" }, { path: file }] })).rejects.toThrow(/symlink|traversal/);
  const original = LocalPaths.prototype.revalidate;
  vi.spyOn(LocalPaths.prototype, "revalidate").mockImplementation(function(this: LocalPaths, snapshot) { f.put("x", "drift"); return original.call(this, snapshot); });
  await expect(f.call("readMany", { partial: true, windows: [{ path: "x" }] })).rejects.toThrow(/conflict/);
});
it("search reasons distinguish clipped text, count, output and oversized exclusions", async () => {
  const f = fixture(); f.put("a", "needle".repeat(100) + "\nneedle\n"); f.put("z", "x".repeat(2 * 1024 * 1024 + 1));
  const result = await f.call("grep", { pattern: "needle", limit: 1 }) as LocalGrepResult;
  expect(result.truncationReasons).toEqual(expect.arrayContaining(["match-text", "count", "oversized-files"]));
  const small = fixture(400); small.put("a", "needle".repeat(100));
  expect(await small.call("grep", { pattern: "needle" })).toMatchObject({ matches: [], truncationReasons: expect.arrayContaining(["output"]) });
});
