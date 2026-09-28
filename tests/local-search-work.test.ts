import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { resolveSearchExecutable } from "../src/providers/local-executable.js";
import { afterEach, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { FabricDeadline } from "../src/runtime/deadline.js";

const roots: string[] = [];
const searchScope = (glob?: string) => ({ path: ".", ...(glob ? { glob } : {}), hidden: false, ignoreFiles: true });
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
// The production rg probe keeps its exact 2000ms bound; full-suite CPU load can
// cold-start a freshly copied binary past it. One ETIMEDOUT retry is harness
// resilience only; every assertion and the production deadline stay unchanged.
const resolveCold = <T>(probe: () => T): T => {
  try { return probe(); } catch (error) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ETIMEDOUT") throw error;
    return probe();
  }
};

it("retries a cold probe only once on ETIMEDOUT", () => {
  const timeout = Object.assign(new Error("cold start"), { code: "ETIMEDOUT" });
  const probe = vi.fn<() => string>().mockImplementationOnce(() => { throw timeout; }).mockReturnValue("ready");
  expect(resolveCold(probe)).toBe("ready");
  expect(probe).toHaveBeenCalledTimes(2);
});
it.each(["ETIMEDOUT", "EACCES"])("propagates a failed retry unchanged: %s", code => {
  const timeout = Object.assign(new Error("cold start"), { code: "ETIMEDOUT" });
  const failure = Object.assign(new Error("second failure"), { code });
  const probe = vi.fn<() => string>().mockImplementationOnce(() => { throw timeout; }).mockImplementation(() => { throw failure; });
  expect(() => resolveCold(probe)).toThrow(failure);
  expect(probe).toHaveBeenCalledTimes(2);
});
it("does not retry integrity failures or non-error throws", () => {
  for (const failure of [Object.assign(new Error("integrity"), { code: "EACCES" }), null]) {
    const probe = vi.fn(() => { throw failure; });
    try { resolveCold(probe); expect.fail("probe must throw"); } catch (error) { expect(error).toBe(failure); }
    expect(probe).toHaveBeenCalledTimes(1);
  }
});
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-search-work-"))); roots.push(base);
  const root = path.join(base, "workspace"); fs.mkdirSync(root); const registry = new ActionRegistry();
  registry.register(resolveCold(() => new LocalCodingProvider({ root, lockRoot: path.join(base, "locks") })));
  const call = (name: string, args: Record<string, unknown>, deadline?: FabricDeadline) => registry.invoke(`local.${name}`, args, { cwd: root, audits: [], maxResultChars: 20000, approve: async () => {}, ...(deadline ? { deadline } : {}) });
  return { root, call };
}
it.each([128, 600])("amortizes rg launches for %i tiny files", async count => {
  const target = resolveCold(() => resolveSearchExecutable()).path;
  const f = fixture();
  for (let i = 0; i < count; i++) fs.writeFileSync(path.join(f.root, `${String(i).padStart(4, "0")}.txt`), "ordinary content\n");
  const launches = vi.spyOn(childProcess, "execFile");
  syncBuiltinESMExports();
  expect(await f.call("grep", { pattern: "absent", limit: 1 })).toEqual({ scope: searchScope(), matches: [], truncated: false, scopeExhausted: true });
  expect(launches.mock.calls.filter(([file]) => file === target)).toHaveLength(1 + Math.ceil(count / 256));
});
it("discovers a hidden-aware all-files manifest with one rg launch", async () => {
  const f = fixture(); fs.mkdirSync(path.join(f.root, ".ci"));
  fs.writeFileSync(path.join(f.root, "root.txt"), "x");
  fs.writeFileSync(path.join(f.root, ".ci/job.yml"), "x");
  const launches = vi.spyOn(childProcess, "execFile"); syncBuiltinESMExports();
  expect(await f.call("find", { pattern: "**/*", hidden: true })).toEqual({
    paths: [".ci/job.yml", "root.txt"], truncated: false, scopeExhausted: true,
    scope: { path: ".", glob: "**/*", hidden: true, ignoreFiles: true },
  });
  expect(launches).toHaveBeenCalledTimes(1);
});

it("a narrow glob remains useful above 10000 files without including ignored or hidden files", async () => {
  const f = fixture(); fs.mkdirSync(path.join(f.root, ".git"));
  for (let index = 0; index < 10001; index++) fs.writeFileSync(path.join(f.root, `f${index}.txt`), "irrelevant");
  fs.writeFileSync(path.join(f.root, "selected.ts"), "needle\n"); fs.writeFileSync(path.join(f.root, ".hidden.ts"), "needle");
  fs.writeFileSync(path.join(f.root, ".gitignore"), "ignored.ts\n"); fs.writeFileSync(path.join(f.root, "ignored.ts"), "needle");
  expect(await f.call("find", { pattern: "*.ts", limit: 1 })).toEqual({ scope: searchScope("*.ts"), paths: ["selected.ts"], truncated: false, scopeExhausted: true });
  expect(await f.call("grep", { pattern: "needle", glob: "*.ts", limit: 1 })).toEqual({ scope: searchScope("*.ts"), matches: [{ path: "selected.ts", line: 1, text: "needle" }], truncated: false, scopeExhausted: true });
  await expect(f.call("grep", { pattern: "needle", limit: 1 })).rejects.toThrow(/narrow path or glob/);
});
it("caps only eligible glob intersection, not ignored glob matches", async () => {
  const f = fixture(); fs.mkdirSync(path.join(f.root, ".git")); fs.mkdirSync(path.join(f.root, "ignored"));
  fs.writeFileSync(path.join(f.root, ".gitignore"), "ignored/\n");
  for (let index = 0; index < 10001; index++) fs.writeFileSync(path.join(f.root, "ignored", `f${index}.ts`), "needle");
  fs.writeFileSync(path.join(f.root, "selected.ts"), "needle\n");
  expect(await f.call("find", { pattern: "*.ts", limit: 1 })).toEqual({ scope: searchScope("*.ts"), paths: ["selected.ts"], truncated: false, scopeExhausted: true });
});

it("limit 1 stops expensive snapshots before exhausting aggregate bytes and discloses remaining work", async () => {
  const f = fixture(); const text = "needle\n" + "x".repeat(2 * 1024 * 1024 - 7);
  for (let index = 0; index < 18; index++) fs.writeFileSync(path.join(f.root, `${String(index).padStart(2, "0")}.txt`), text);
  const open = vi.spyOn(fs, "openSync");
  expect(await f.call("grep", { pattern: "needle", limit: 1 })).toEqual({ scope: searchScope(), matches: [{ path: "00.txt", line: 1, text: "needle" }], truncated: true, scopeExhausted: false, truncationReasons: ["count"] });
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
