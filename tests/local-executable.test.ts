import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resolveSearchExecutable, verifySearchExecutable, searchEnvironment } from "../src/providers/local-executable.js";

const roots: string[] = [];
const fixture = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-rg-")); roots.push(root); return root; };
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it("resolves real rg once and supplies no ambient credentials/configuration", () => {
  vi.stubEnv("KIRO_API_KEY", "secret"); vi.stubEnv("NODE_OPTIONS", "secret"); vi.stubEnv("RIPGREP_CONFIG_PATH", "secret");
  const executable = resolveSearchExecutable();
  expect(path.isAbsolute(executable.path)).toBe(true); expect(executable.version).toMatch(/^ripgrep /);
  expect(searchEnvironment()).toEqual({ LANG: "C.UTF-8", LC_ALL: "C" });
  expect(() => verifySearchExecutable(executable)).not.toThrow();
});
it("ignores empty/relative PATH components and fails before coding admission", () => {
  vi.stubEnv("PATH", `.:${fixture()}:`);
  expect(resolveSearchExecutable).toThrow(/ripgrep .*required.*not found/);
});
it("detects disappearance and replacement of the selected executable", () => {
  const root = fixture(); const target = path.join(root, "rg"); fs.writeFileSync(target, "x", { mode: 0o700 });
  const stat = fs.statSync(target); const executable = { path: target, version: "", dev: stat.dev, ino: stat.ino };
  fs.renameSync(target, path.join(root, "old"));
  expect(() => verifySearchExecutable(executable)).toThrow(/not found/);
  fs.writeFileSync(target, "replacement", { mode: 0o700 });
  expect(() => verifySearchExecutable(executable)).toThrow(/identity or trust changed/);
});
it.each([0o600, 0o720, 0o702])("rejects unsafe executable mode %i", (mode) => {
  const root = fixture(); fs.writeFileSync(path.join(root, "rg"), "x", { mode }); fs.chmodSync(path.join(root, "rg"), mode); vi.stubEnv("PATH", root);
  expect(resolveSearchExecutable).toThrow(/trust changed/);
});
it("bounds and validates executable version response", () => {
  const root = fixture(); fs.writeFileSync(path.join(root, "rg"), '#!/bin/sh\nprintf "not-ripgrep\\n"\n', { mode: 0o700 }); vi.stubEnv("PATH", root);
  expect(resolveSearchExecutable).toThrow(/prerequisite check failed/);
});
