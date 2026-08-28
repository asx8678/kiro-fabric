// PR 6 uninstall tests. Installer calls use the fake non-billable Kiro
// binary; uninstall itself never invokes kiro-cli.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installKiroProfile, KiroInstallError } from "../src/kiro/install.js";
import { kiroProfilePath } from "../src/kiro/profile.js";
import {
  planKiroProfileUninstall,
  uninstallKiroProfile,
} from "../src/kiro/uninstall.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const fakeKiro = join(repoRoot, "tests", "fixtures", "kiro", "fake-kiro.mjs");
const mcpEntry = join(repoRoot, "dist", "kiro", "mcp-entry.js");

let base: string;
const roots: string[] = [];
let wrapperPath: string;

const project = (name: string): string => {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const installWithFake = (root: string, extra: Parameters<typeof installKiroProfile>[0] = {}) =>
  installKiroProfile({
    projectRoot: root,
    kiroBinary: wrapperPath,
    mcpEntryPath: mcpEntry,
    skipRuntimeClosure: true,
    ...extra,
  });

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "kiro-fabric-uninstall-test-"));
  roots.push(base);
  wrapperPath = join(base, "fake-kiro");
  writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeKiro)} "$@"\n`,
    { mode: 0o755 },
  );
  chmodSync(wrapperPath, 0o755);
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("uninstallKiroProfile", () => {

  it("restores a forced foreign skill and preserves unrelated siblings", async () => {
    const dir = project("skill-restore");
    const managed = join(dir, ".kiro", "skills", "fabric-review", "SKILL.md");
    const sibling = join(dir, ".kiro", "skills", "my-skill", "SKILL.md");
    mkdirSync(dirname(managed), { recursive: true });
    mkdirSync(dirname(sibling), { recursive: true });
    writeFileSync(managed, "original foreign review\n");
    writeFileSync(sibling, "unrelated sibling\n");

    await installWithFake(dir, { skipRuntimeClosure: false, force: true });
    expect(readFileSync(managed, "utf8")).not.toBe("original foreign review\n");
    const result = uninstallKiroProfile({ projectRoot: dir });
    expect(result.action).toBe("remove");
    expect(readFileSync(managed, "utf8")).toBe("original foreign review\n");
    expect(readFileSync(sibling, "utf8")).toBe("unrelated sibling\n");
  });

  it("refuses all uninstall mutations when an owned skill is modified", async () => {
    const dir = project("skill-drift");
    const installed = await installWithFake(dir, { skipRuntimeClosure: false });
    const skill = join(dir, ".kiro", "skills", "fabric-workflow", "SKILL.md");
    const profileBefore = readFileSync(installed.profilePath, "utf8");
    writeFileSync(skill, "modified after install\n");
    expect(() => uninstallKiroProfile({ projectRoot: dir })).toThrow(/managed skill changed/);
    expect(readFileSync(installed.profilePath, "utf8")).toBe(profileBefore);
    expect(existsSync(installed.manifestPath)).toBe(true);
  });

  it("removes a freshly installed managed profile and manifest", async () => {
    const dir = project("fresh");
    const installed = await installWithFake(dir);
    const result = uninstallKiroProfile({ projectRoot: dir });
    expect(result.action).toBe("remove");
    expect(result.changed).toBe(true);
    expect(existsSync(installed.profilePath)).toBe(false);
    expect(existsSync(installed.manifestPath)).toBe(false);
    expect(existsSync(join(dir, ".kiro"))).toBe(false);
  });

  it("is an idempotent no-op on a second uninstall", async () => {
    const dir = project("twice");
    await installWithFake(dir);
    uninstallKiroProfile({ projectRoot: dir });
    const second = uninstallKiroProfile({ projectRoot: dir });
    expect(second.action).toBe("noop");
    expect(second.changed).toBe(false);
  });

  it("does not touch an independent profile when no manifest exists", () => {
    const dir = project("independent");
    mkdirSync(dirname(kiroProfilePath(dir)), { recursive: true });
    writeFileSync(kiroProfilePath(dir), JSON.stringify({ name: "kiro-fabric", custom: true }));
    const result = uninstallKiroProfile({ projectRoot: dir });
    expect(result.action).toBe("noop");
    expect(JSON.parse(readFileSync(kiroProfilePath(dir), "utf8")).custom).toBe(true);
  });

  it("restores exact original bytes after a forced install", async () => {
    const dir = project("restore");
    mkdirSync(dirname(kiroProfilePath(dir)), { recursive: true });
    const original = JSON.stringify({ name: "custom", old: true }, null, 2);
    writeFileSync(kiroProfilePath(dir), original);
    await installWithFake(dir, { force: true });
    const result = uninstallKiroProfile({ projectRoot: dir });
    expect(result.action).toBe("restore");
    expect(readFileSync(kiroProfilePath(dir), "utf8")).toBe(original);
    expect(existsSync(join(dir, ".kiro", ".kiro-fabric", "install.json"))).toBe(false);
  });

  it("restores the original custom content after force + managed update", async () => {
    const dir = project("lineage");
    mkdirSync(dirname(kiroProfilePath(dir)), { recursive: true });
    const original = JSON.stringify({ name: "custom", keep: 1 });
    writeFileSync(kiroProfilePath(dir), original);
    await installWithFake(dir, { force: true });
    const otherNode = join(base, "node-alt");
    writeFileSync(otherNode, "", { mode: 0o755 });
    await installWithFake(dir, { nodePath: otherNode });
    const result = uninstallKiroProfile({ projectRoot: dir });
    expect(result.action).toBe("restore");
    expect(readFileSync(kiroProfilePath(dir), "utf8")).toBe(original);
  });

  it("removes a create-then-updated profile without inventing a backup", async () => {
    const dir = project("update-remove");
    await installWithFake(dir);
    const otherNode = join(base, "node-alt-2");
    writeFileSync(otherNode, "", { mode: 0o755 });
    await installWithFake(dir, { nodePath: otherNode });
    const result = uninstallKiroProfile({ projectRoot: dir });
    expect(result.action).toBe("remove");
    expect(existsSync(kiroProfilePath(dir))).toBe(false);
  });

  it("refuses a user-modified managed profile and leaves files unchanged", async () => {
    const dir = project("drift");
    const installed = await installWithFake(dir);
    const drifted = JSON.parse(readFileSync(installed.profilePath, "utf8"));
    drifted.prompt = "user edit";
    writeFileSync(installed.profilePath, JSON.stringify(drifted, null, 2));
    expect(() => uninstallKiroProfile({ projectRoot: dir })).toThrow(KiroInstallError);
    expect(() => uninstallKiroProfile({ projectRoot: dir })).toThrow(/ownership|changed/);
    expect(existsSync(installed.manifestPath)).toBe(true);
    expect(JSON.parse(readFileSync(installed.profilePath, "utf8")).prompt).toBe("user edit");
  });

  it("cleans a stale manifest when the profile is already gone", async () => {
    const dir = project("stale");
    const installed = await installWithFake(dir);
    rmSync(installed.profilePath);
    const result = uninstallKiroProfile({ projectRoot: dir });
    expect(result.action).toBe("remove");
    expect(existsSync(installed.manifestPath)).toBe(false);
  });

  it("restores a missing profile from the verified backup", async () => {
    const dir = project("missing-restore");
    mkdirSync(dirname(kiroProfilePath(dir)), { recursive: true });
    const original = JSON.stringify({ name: "custom" });
    writeFileSync(kiroProfilePath(dir), original);
    const installed = await installWithFake(dir, { force: true });
    rmSync(installed.profilePath);
    const result = uninstallKiroProfile({ projectRoot: dir });
    expect(result.action).toBe("restore");
    expect(readFileSync(kiroProfilePath(dir), "utf8")).toBe(original);
  });

  it("refuses a .kiro-fabric symlink without writing outside the project", async () => {
    const dir = project("meta-link");
    const outside = project("outside-meta");
    writeFileSync(join(outside, "sentinel"), "safe");
    mkdirSync(join(dir, ".kiro"), { recursive: true });
    symlinkSync(outside, join(dir, ".kiro", ".kiro-fabric"));
    expect(() => planKiroProfileUninstall({ projectRoot: dir })).toThrow(/symlink/);
    expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("safe");
  });

  it("leaves sibling profiles and orphaned backups in place", async () => {
    const dir = project("siblings");
    await installWithFake(dir);
    writeFileSync(join(dir, ".kiro", "agents", "other.json"), JSON.stringify({ name: "other" }));
    const orphan = join(dir, ".kiro", ".kiro-fabric", "backups", `${"a".repeat(64)}.json`);
    mkdirSync(dirname(orphan), { recursive: true });
    writeFileSync(orphan, "{}");
    uninstallKiroProfile({ projectRoot: dir });
    expect(JSON.parse(readFileSync(join(dir, ".kiro", "agents", "other.json"), "utf8")).name).toBe(
      "other",
    );
    expect(existsSync(orphan)).toBe(true);
  });

  it("dry-run reports restore without writing", async () => {
    const dir = project("dry");
    mkdirSync(dirname(kiroProfilePath(dir)), { recursive: true });
    const original = JSON.stringify({ name: "custom" });
    writeFileSync(kiroProfilePath(dir), original);
    const installed = await installWithFake(dir, { force: true });
    const beforeProfile = readFileSync(installed.profilePath, "utf8");
    const beforeManifest = readFileSync(installed.manifestPath, "utf8");
    const result = uninstallKiroProfile({ projectRoot: dir, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.action).toBe("restore");
    expect(result.changed).toBe(false);
    expect(readFileSync(installed.profilePath, "utf8")).toBe(beforeProfile);
    expect(readFileSync(installed.manifestPath, "utf8")).toBe(beforeManifest);
  });

  it("does not invoke kiro-cli", async () => {
    const dir = project("no-kiro");
    await installWithFake(dir);
    const missing = join(base, "missing-kiro");
    const result = uninstallKiroProfile({ projectRoot: dir });
    expect(result.action).toBe("remove");
    expect(existsSync(missing)).toBe(false);
  });
});

describe("uninstall CLI", () => {
  const cliEntry = join(repoRoot, "dist", "kiro", "cli-entry.js");

  it("prints JSON remove output and a second run is noop", async () => {
    const dir = project("cli-remove");
    await installWithFake(dir);
    const first = await execFileAsync(process.execPath, [
      cliEntry,
      "uninstall",
      "kiro",
      "--project-root",
      dir,
      "--json",
    ]);
    expect(JSON.parse(first.stdout).action).toBe("remove");
    const second = await execFileAsync(process.execPath, [
      cliEntry,
      "uninstall",
      "kiro",
      "--project-root",
      dir,
      "--json",
    ]);
    expect(JSON.parse(second.stdout).action).toBe("noop");
  });

  it("rejects --force as a usage error", async () => {
    await expect(
      execFileAsync(process.execPath, [
        cliEntry,
        "uninstall",
        "kiro",
        "--force",
      ]),
    ).rejects.toMatchObject({ code: 2 });
  });

  it("emits a structured ownership error for drifted content", async () => {
    const dir = project("cli-drift");
    const installed = await installWithFake(dir);
    writeFileSync(installed.profilePath, JSON.stringify({ name: "edited" }));
    await expect(
      execFileAsync(process.execPath, [
        cliEntry,
        "uninstall",
        "kiro",
        "--project-root",
        dir,
        "--json",
      ]),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"code": "ownership"'),
    });
  });
});
