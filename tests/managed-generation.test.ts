import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { resolveSearchExecutable, verifySearchExecutable, type ManagedSearchExecutable } from "../src/providers/local-executable.js";
import { inferManagedGeneration, managedInstallationBase, validateManagedAdmission } from "../src/kiro/managed-generation.js";

it("admits retained generations, rejects retirement/data redirection and uncommitted journals", () => {
  const expected = fixture(); const base = path.join(expected.generationRoot, "kiro-fabric");
  const retained = "a".repeat(64), current = "b".repeat(64), manifestSha256 = "c".repeat(64);
  const generation = path.join(base, "runtime", retained), data = path.join(base, "data");
  fs.mkdirSync(generation, { recursive: true, mode: 0o700 }); fs.mkdirSync(data, { mode: 0o700 });
  const owner = { owner: "kiro-fabric-agent-user-install", schemaVersion: 3, status: "active", installationId: "fixture", kiroHome: expected.generationRoot, dataRoot: data, currentRuntime: current, previousRuntime: null,
    runtimeGenerations: [{ name: retained, manifestSha256 }, { name: current, manifestSha256 }], profileSha256: null, launcherSha256: "d".repeat(64), releaseStateSha256: null, transactionId: "e".repeat(32) };
  const ownerFile = path.join(base, "install-owner.json");
  const writeOwner = () => fs.writeFileSync(ownerFile, JSON.stringify(owner), { mode: 0o600 }); writeOwner();
  expect(() => validateManagedAdmission(generation, data, manifestSha256)).not.toThrow();
  expect(() => validateManagedAdmission(generation, expected.generationRoot, manifestSha256)).toThrow(/binding/);
  expect(() => validateManagedAdmission(generation, data, "f".repeat(64))).toThrow(/retained/);
  owner.status = "retired"; writeOwner(); expect(() => validateManagedAdmission(generation, data, manifestSha256)).toThrow(/retired/);
  owner.status = "active"; writeOwner();
  fs.mkdirSync(path.join(base, ".transactions"), { mode: 0o700 });
  const journalFile = path.join(base, ".transactions", "active.json");
  const journal = { schemaVersion: 1, transactionId: owner.transactionId, beforeOwnerSha256: null, afterOwnerSha256: createHash("sha256").update(fs.readFileSync(ownerFile)).digest("hex") };
  fs.writeFileSync(journalFile, JSON.stringify(journal), { mode: 0o600 });
  expect(() => validateManagedAdmission(generation, data, manifestSha256)).not.toThrow();
  journal.transactionId = "0".repeat(32); fs.writeFileSync(journalFile, JSON.stringify(journal));
  expect(() => validateManagedAdmission(generation, data, manifestSha256)).toThrow(/recovery/);
  fs.unlinkSync(journalFile); fs.writeFileSync(ownerFile, JSON.stringify({ ...owner, schemaVersion: 99 }));
  expect(() => validateManagedAdmission(generation, data, manifestSha256)).toThrow(/ownership/);
});
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
function fixture(): ManagedSearchExecutable {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "managed-generation-"))); roots.push(root);
  vi.stubEnv("HOME", root); vi.stubEnv("KIRO_HOME", path.join(root, ".kiro"));
  fs.mkdirSync(path.join(root, "tools"), { mode: 0o700 });
  const target = path.join(root, "tools", "rg");
  fs.writeFileSync(target, '#!/bin/sh\nprintf "ripgrep 15.1.0\\n"\n', { mode: 0o700 });
  return { generationRoot: root, path: target, mode: 0o700, version: "ripgrep 15.1.0", sha256: createHash("sha256").update(fs.readFileSync(target)).digest("hex") };
}
it("uses explicit managed rg with no PATH and rehashes before later use", () => {
  const expected = fixture(); vi.stubEnv("PATH", "");
  const executable = resolveSearchExecutable(expected);
  expect(executable.path).toBe(expected.path);
  fs.appendFileSync(expected.path, "# same inode corruption\n");
  expect(() => verifySearchExecutable(executable)).toThrow(/hash/);
});
it("accepts the pinned upstream revision banner without accepting another release", () => {
  const expected = fixture();
  fs.writeFileSync(expected.path, '#!/bin/sh\nprintf "ripgrep 15.1.0 (rev 4649aa9700)\\n"\n');
  expected.sha256 = createHash("sha256").update(fs.readFileSync(expected.path)).digest("hex");
  expect(resolveSearchExecutable(expected).version).toBe("ripgrep 15.1.0 (rev 4649aa9700)");
  expect(() => resolveSearchExecutable({ ...expected, version: "ripgrep 15.1.1" })).toThrow(/version/);
});
it.each([0o600, 0o750, 0o770, 0o4700])("rejects managed mode %i", mode => {
  const expected = fixture(); fs.chmodSync(expected.path, mode);
  expect(() => resolveSearchExecutable(expected)).toThrow(/mode/);
});
it("never falls back for a missing managed rg", () => {
  const expected = fixture(); fs.unlinkSync(expected.path);
  expect(() => resolveSearchExecutable(expected)).toThrow();
});
it("rejects containment, expected version, and symlink substitutions", () => {
  const expected = fixture();
  expect(() => resolveSearchExecutable({ ...expected, path: process.execPath })).toThrow(/containment/);
  expect(() => resolveSearchExecutable({ ...expected, version: "ripgrep 99.0.0" })).toThrow(/version/);
  fs.renameSync(expected.path, expected.path + "-old"); fs.symlinkSync(expected.path + "-old", expected.path);
  expect(() => resolveSearchExecutable(expected)).toThrow(/containment/);
});
it("infers complete candidate even with all managed environment fields missing", () => {
  const expected = fixture(); fs.mkdirSync(path.join(expected.generationRoot, "app"), { mode: 0o700 });
  fs.writeFileSync(path.join(expected.generationRoot, "bundle-manifest.json"), "{}");
  expect(inferManagedGeneration(path.join(expected.generationRoot, "app"), {})).toEqual({ bundleRoot: expected.generationRoot, expectedNode: path.join(expected.generationRoot, "tools", "node"), rg: expected.path });
  expect(() => inferManagedGeneration(path.join(expected.generationRoot, "app"), { KIRO_FABRIC_RG: "/foreign/rg" })).toThrow(/environment/);
});
it("recognizes installed generation ownership layout independently of selected data", () => {
  const expected = fixture(); const generation = path.join(expected.generationRoot, "kiro-fabric", "runtime", "a".repeat(64));
  fs.mkdirSync(path.join(generation, "app"), { recursive: true, mode: 0o700 });
  expect(inferManagedGeneration(path.join(generation, "app"), {})?.bundleRoot).toBe(generation);
  expect(managedInstallationBase(generation)).toBe(path.join(expected.generationRoot, "kiro-fabric"));
  expect(inferManagedGeneration(expected.generationRoot, {})).toBeUndefined();
});
