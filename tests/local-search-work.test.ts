import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { FabricDeadline } from "../src/runtime/deadline.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-search-work-"))); roots.push(base);
  const root = path.join(base, "workspace"); fs.mkdirSync(root); const registry = new ActionRegistry();
  registry.register(new LocalCodingProvider({ root, lockRoot: path.join(base, "locks") }));
  const call = (name: string, args: Record<string, unknown>, deadline?: FabricDeadline) => registry.invoke(`local.${name}`, args, { cwd: root, audits: [], maxResultChars: 20000, approve: async () => {}, ...(deadline ? { deadline } : {}) });
  return { root, call };
}
it("a narrow glob remains useful above 10000 files without including ignored or hidden files", async () => {
  const f = fixture(); fs.mkdirSync(path.join(f.root, ".git"));
  for (let index = 0; index < 10001; index++) fs.writeFileSync(path.join(f.root, `f${index}.txt`), "irrelevant");
  fs.writeFileSync(path.join(f.root, "selected.ts"), "needle\n"); fs.writeFileSync(path.join(f.root, ".hidden.ts"), "needle");
  fs.writeFileSync(path.join(f.root, ".gitignore"), "ignored.ts\n"); fs.writeFileSync(path.join(f.root, "ignored.ts"), "needle");
  expect(await f.call("find", { pattern: "*.ts", limit: 1 })).toEqual({ paths: ["selected.ts"], truncated: false });
  expect(await f.call("grep", { pattern: "needle", glob: "*.ts", limit: 1 })).toEqual({ matches: [{ path: "selected.ts", line: 1, text: "needle" }], truncated: false });
  await expect(f.call("grep", { pattern: "needle", limit: 1 })).rejects.toThrow(/narrow path or glob/);
});
it("caps only eligible glob intersection, not ignored glob matches", async () => {
  const f = fixture(); fs.mkdirSync(path.join(f.root, ".git")); fs.mkdirSync(path.join(f.root, "ignored"));
  fs.writeFileSync(path.join(f.root, ".gitignore"), "ignored/\n");
  for (let index = 0; index < 10001; index++) fs.writeFileSync(path.join(f.root, "ignored", `f${index}.ts`), "needle");
  fs.writeFileSync(path.join(f.root, "selected.ts"), "needle\n");
  expect(await f.call("find", { pattern: "*.ts", limit: 1 })).toEqual({ paths: ["selected.ts"], truncated: false });
});

it("limit 1 stops expensive snapshots before exhausting aggregate bytes and discloses remaining work", async () => {
  const f = fixture(); const text = "needle\n" + "x".repeat(2 * 1024 * 1024 - 7);
  for (let index = 0; index < 18; index++) fs.writeFileSync(path.join(f.root, `${String(index).padStart(2, "0")}.txt`), text);
  const open = vi.spyOn(fs, "openSync");
  expect(await f.call("grep", { pattern: "needle", limit: 1 })).toEqual({ matches: [{ path: "00.txt", line: 1, text: "needle" }], truncated: true });
  expect(open.mock.calls.filter(([target]) => String(target).endsWith(".txt"))).toHaveLength(2);
  await expect(f.call("grep", { pattern: "not-found", limit: 1 })).rejects.toThrow(/aggregate search work limit; narrow path or glob/);
});
it("does not relax alias validation in unsearched candidates", async () => {
  const f = fixture(); fs.writeFileSync(path.join(f.root, "a"), "needle"); fs.writeFileSync(path.join(f.root, "z"), "other"); fs.linkSync(path.join(f.root, "z"), path.join(f.root, "zz"));
  await expect(f.call("grep", { pattern: "needle", limit: 1 })).rejects.toThrow(/hardlink/);
});
it("terminates a nonresponsive rg under the shared search deadline", async () => {
  const tool = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-slow-rg-")); roots.push(tool);
  fs.writeFileSync(path.join(tool, "rg"), '#!/bin/sh\ncase "$*" in *--version*) printf "ripgrep 99.0\\n"; exit 0;; esac\nwhile :; do :; done\n', { mode: 0o700 });
  vi.stubEnv("PATH", tool); const f = fixture();
  await expect(f.call("find", { pattern: "*" }, new FabricDeadline(100, 100))).rejects.toThrow(/rg failed|deadline|timed out/i);
});
