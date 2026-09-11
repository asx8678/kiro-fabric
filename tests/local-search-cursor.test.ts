import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { LocalPaths } from "../src/providers/local-path.js";
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(budget = 20000) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cursor-"))); roots.push(base);
  const root = path.join(base, "src"); fs.mkdirSync(root);
  const registry = new ActionRegistry(); registry.register(new LocalCodingProvider({ root, lockRoot: path.join(base, "locks"), maxResultChars: budget }));
  const call = async (name: string, args: Record<string, unknown>) => await registry.invoke(`local.${name}`, args, { cwd: root, audits: [], maxResultChars: budget, approve: async () => {} }) as { paths?: string[]; matches?: { path: string; line: number; text: string }[]; nextCursor?: string; truncated: boolean };
  return { root, call };
}
it("collects late matches and preserves default compatibility", async () => {
  const f = fixture(); fs.writeFileSync(path.join(f.root, "a"), "hit\nhit\n"); fs.writeFileSync(path.join(f.root, "z"), "late hit\n");
  const args = { pattern: "hit", paginate: true, limit: 1 };
  const got = []; let cursor: string | undefined;
  do { const page = await f.call("grep", { ...args, ...(cursor ? { cursor } : {}) }); got.push(...page.matches!); cursor = page.nextCursor; } while (cursor);
  expect(got.map(m => [m.path, m.line])).toEqual([["a", 1], ["a", 2], ["z", 1]]);
  expect(await f.call("find", { pattern: "**/*" })).toEqual({ scope: { path: ".", glob: "**/*", hidden: false, ignoreFiles: true }, paths: ["a", "z"], truncated: false });
});
it("rejects forged, mismatched, consumed and foreign cursors and invalid limits", async () => {
  const f = fixture(), other = fixture(); for (const name of ["a", "b"]) fs.writeFileSync(path.join(f.root, name), "x");
  const args = { pattern: "**/*", paginate: true, limit: 1 }; const page = await f.call("find", args);
  await expect(f.call("find", { ...args, cursor: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/cursor/);
  await expect(f.call("find", { ...args, pattern: "a", cursor: page.nextCursor })).rejects.toThrow(/mismatch/);
  await expect(other.call("find", { ...args, cursor: page.nextCursor })).rejects.toThrow(/cursor/);
  await expect(f.call("find", { ...args, limit: 1001 })).rejects.toThrow();
  await f.call("find", { ...args, cursor: page.nextCursor });
  await expect(f.call("find", { ...args, cursor: page.nextCursor })).rejects.toThrow(/cursor/);
});
it.each(["add", "delete", "content", "ttl"])("rejects %s drift/expiry", async mode => {
  const f = fixture(); for (const name of ["a", "b"]) fs.writeFileSync(path.join(f.root, name), "x");
  const args = { pattern: "**/*", paginate: true, limit: 1 }; const page = await f.call("find", args);
  if (mode === "add") fs.writeFileSync(path.join(f.root, "c"), "x");
  if (mode === "delete") fs.unlinkSync(path.join(f.root, "b"));
  if (mode === "content") fs.writeFileSync(path.join(f.root, "b"), "y");
  if (mode === "ttl") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60001);
  await expect(f.call("find", { ...args, cursor: page.nextCursor })).rejects.toThrow(/drift|expired/);
});
it.each(["content", "add"])("rejects %s drift during resumed snapshot validation", async mode => {
  const f = fixture(); for (const name of ["a", "b"]) fs.writeFileSync(path.join(f.root, name), "x");
  const args = { pattern: "**/*", paginate: true, limit: 1 }; const first = await f.call("find", args);
  const read = LocalPaths.prototype.read;
  vi.spyOn(LocalPaths.prototype, "read").mockImplementation(function(this: LocalPaths, file: string) {
    const result = read.call(this, file);
    if (path.basename(file) === "b") fs.writeFileSync(path.join(f.root, mode === "add" ? "c" : "a"), "drift");
    return result;
  });
  await expect(f.call("find", { ...args, cursor: first.nextCursor })).rejects.toThrow(/drift|conflict/);
});
it("bounds cached snapshots and rejects oversized and unsafe snapshot files", async () => {
  const f = fixture(); for (const name of ["a", "b"]) fs.writeFileSync(path.join(f.root, name), "x");
  const args = { pattern: "**/*", paginate: true, limit: 1 };
  for (let i = 0; i < 8; i++) await f.call("find", args);
  await expect(f.call("find", args)).rejects.toThrow(/cache limit/);
  const other = fixture(); fs.writeFileSync(path.join(other.root, "big"), Buffer.alloc(2 * 1024 * 1024 + 1));
  await expect(other.call("find", args)).rejects.toThrow();
  fs.unlinkSync(path.join(other.root, "big")); fs.writeFileSync(path.join(other.root, "a"), "x"); fs.linkSync(path.join(other.root, "a"), path.join(other.root, "b"));
  await expect(other.call("find", args)).rejects.toThrow();
});
it("output-budget pages advance without gaps or duplicates", async () => {
  const f = fixture(400); const names = Array.from({ length: 12 }, (_, i) => `${String(i).padStart(2, "0")}-${"x".repeat(70)}`);
  for (const name of names) fs.writeFileSync(path.join(f.root, name), "x");
  const got: string[] = []; let cursor: string | undefined;
  do { const page = await f.call("find", { pattern: "**/*", paginate: true, ...(cursor ? { cursor } : {}) }); expect(JSON.stringify(page).length).toBeLessThanOrEqual(400); expect(page.paths!.length).toBeGreaterThan(0); got.push(...page.paths!); cursor = page.nextCursor; } while (cursor);
  expect(got).toEqual(names);
});
