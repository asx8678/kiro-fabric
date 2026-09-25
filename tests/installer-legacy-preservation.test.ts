import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installUserAgent, uninstallUserAgent, installerSafety as s } from "../scripts/install-agent-user.mjs";
import { validateAgentPackage, snapshotTree } from "../scripts/validate-agent-package.mjs";
import { stagePortableAgentPackage } from "../scripts/verification/w5-portable-package.mjs";
import { snapshotStagingScope, assertStagingScopeUnchanged } from "../scripts/verification/staging-preservation-snapshot.mjs";
import { installerSuiteFiles } from "../scripts/test-installer.mjs";

// Preserve every fixture. Block destructive regressions before effects, including
// swallowed cleanup errors. Narrow fixed-control lock/temp unlink and genuinely
// empty container removal remain real; no repository/data removal is mocked as success.
const roots: string[] = [];
let attempts: string[] = [], currentPackage: string, updatedPackage: string;
const temporary = () => { const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "legacy-preserve-"))); fs.chmodSync(root, 0o700); roots.push(root); return root; };
const write = (root: string, relative: string, text: string) => { const p = path.join(root, relative); fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); fs.writeFileSync(p, text, { flag: "wx", mode: 0o600 }); };
function repository(root: string, kind = "directory") {
  if (kind === "worktree") write(root, ".git", "gitdir: ../retained-metadata\n");
  else if (kind === "link") { fs.mkdirSync(root, { recursive: true, mode: 0o700 }); fs.symlinkSync("../retained-metadata", path.join(root, ".git")); }
  else { const base = kind === "bare" ? root : path.join(root, ".git"); write(base, "HEAD", "ref: refs/heads/main\n"); fs.mkdirSync(path.join(base, "objects"), { mode: 0o700 }); fs.mkdirSync(path.join(base, "refs"), { mode: 0o700 }); }
}
beforeAll(() => {
  const parent = temporary();
  currentPackage = stagePortableAgentPackage(process.cwd(), parent, "current").root;
  updatedPackage = stagePortableAgentPackage(process.cwd(), parent, "updated").root;
  const file = path.join(updatedPackage, "package.json"), pkg = JSON.parse(fs.readFileSync(file, "utf8")); pkg.version = "99.0.0";
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
});
beforeEach(() => {
  attempts = [];
  vi.spyOn(fs, "rmSync").mockImplementation(p => { attempts.push(`rm:${String(p)}`); throw new Error("blocked recursive cleanup"); });
  for (const name of ["unlinkSync", "rmdirSync"] as const) {
    const original = fs[name];
    vi.spyOn(fs, name).mockImplementation((p: fs.PathLike) => {
      if (/\/(?:\.installing-|\.uninstalling-)/.test(String(p)) || [".git", "install-owner.json", "kiro-fabric.json"].includes(path.basename(String(p)))) {
        attempts.push(`${name}:${String(p)}`); throw new Error("blocked evidence deletion");
      }
      if (name === "rmdirSync" && fs.readdirSync(p).length) { attempts.push(`nonempty:${String(p)}`); throw new Error("blocked nonempty removal"); }
      original(p);
    });
  }
});
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) console.warn(`[legacy preservation fixture] retained ${root}`); expect(attempts, "no swallowed deletion attempts").toEqual([]); });
const fixture = () => { const root = temporary(), home = path.join(root, "home"), workspace = path.join(root, "workspace"); fs.mkdirSync(home, { mode: 0o700 }); fs.mkdirSync(workspace, { mode: 0o700 }); return { root, home, workspace, kiroHome: path.join(home, ".kiro") }; };
type Fixture = ReturnType<typeof fixture>;
type Failure = Error & { committed: boolean; legacyGateRetained: boolean; recoveryRequired: boolean; retainedEvidence?: { path: string; status: string } };
const install = (f: Fixture, pkg = currentPackage, options: Record<string, unknown> = {}) => installUserAgent(pkg, { KIRO_HOME: f.kiroHome }, f.home, { workspaceRoot: f.workspace, ...options });
const uninstall = (f: Fixture, options: Record<string, unknown> = {}) => uninstallUserAgent({ KIRO_HOME: f.kiroHome }, f.home, { workspaceRoot: f.workspace, ...options });
function failureOf(action: () => unknown): Failure { try { action(); } catch (e) { expect(e).toBeInstanceOf(Error); return e as Failure; } throw new Error("expected failure"); }
function evidence(result: { retainedEvidence?: { path: string } }) { if (!result.retainedEvidence) throw new Error("missing recovery evidence"); expect(fs.lstatSync(result.retainedEvidence.path).isDirectory()).toBe(true); return result.retainedEvidence.path; }
const pending = (base: string, before: Set<string>) => {
  const names = fs.readdirSync(base).filter(n => n.startsWith(".installing-") && !before.has(n));
  expect(names).toHaveLength(1);
  const name = names[0];
  if (name === undefined) throw new Error("missing pending installation evidence");
  return path.join(base, name);
};

describe("maintained legacy installer evidence preservation", () => {
  it("retains preparation and previous payload backups on reinstall and update", () => {
    const f = fixture(), first = install(f), profile = fs.readFileSync(first.profile), skill = snapshotTree(path.join(first.root, "skills/fabric-exec"));
    expect(evidence(first)).toContain(".installing-");
    const second = install(f), retained = evidence(second);
    expect(fs.readFileSync(path.join(retained, "previous-profile"))).toEqual(profile);
    expect(snapshotTree(path.join(retained, "previous-skill"))).toEqual(skill);
    expect(snapshotTree(path.join(retained, "runtime"))).toEqual(snapshotTree(first.runtime));
    const third = install(f, updatedPackage);
    expect(evidence(third)).not.toBe(retained); expect(fs.existsSync(first.runtime)).toBe(true);
    expect(s.readLegacyInstallation(f.kiroHome)?.manifest.currentRuntime).toBe(third.packageDigest);
    expect(fs.readFileSync(path.join(retained, "previous-profile"))).toEqual(profile);
  });

  it.each([false, true].flatMap(update => ["runtime", "skill", "profile", "manifest"].map(phase => ({ update, phase }))))("preserves attempted repository payload and restores ownership: $update/$phase", ({ update, phase }) => {
    const f = fixture(), old = update ? install(f) : undefined;
    const oldManifest = old && fs.readFileSync(path.join(old.root, "install-owner.json"));
    const pkg = update ? updatedPackage : currentPackage, digest = validateAgentPackage(pkg).digest;
    const generation = path.join(f.kiroHome, "kiro-fabric/runtime", digest), original = new Error("injected " + phase); let reached = false;
    const error = failureOf(() => install(f, pkg, { onCommitStep: (step: string) => { if (step === phase) { reached = true; repository(path.join(generation, "attempted-project")); throw original; } } }));
    expect(reached).toBe(true); expect(error.cause).toBe(original); expect(error.committed).toBe(false); expect(error.legacyGateRetained).toBe(false);
    const retained = evidence(error);
    expect(fs.readFileSync(path.join(retained, "rollback-runtime/attempted-project/.git/HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
    expect(fs.existsSync(generation)).toBe(false);
    if (old) { expect(fs.readFileSync(path.join(old.root, "install-owner.json"))).toEqual(oldManifest); expect(s.readLegacyInstallation(f.kiroHome)?.manifest.currentRuntime).toBe(old.packageDigest); }
    else expect(s.readLegacyInstallation(f.kiroHome)).toBeUndefined();
    if (phase === "manifest") expect(fs.existsSync(path.join(retained, "rollback-manifest"))).toBe(true);
  });

  it("retains a repository-bearing partial prepared copy and its original error", () => {
    const f = fixture(), copy = fs.copyFileSync, original = new Error("injected copy failure"); let count = 0;
    vi.spyOn(fs, "copyFileSync").mockImplementation((source, destination, flags) => {
      const p = String(destination);
      if (p.includes("/.installing-") && p.includes("/runtime/")) {
        if (++count === 2) throw original;
        copy(source, destination, flags); repository(path.join(p.slice(0, p.indexOf("/runtime/") + 8), "partial-project")); return;
      }
      copy(source, destination, flags);
    });
    const error = failureOf(() => install(f)); expect(count).toBe(2); expect(error.cause).toBe(original);
    expect(fs.readFileSync(path.join(evidence(error), "runtime/partial-project/.git/HEAD"), "utf8")).toContain("refs/heads/main");
  });

  it.each(["directory", "worktree", "bare"])("retains failed migrated %s repositories and the untouched source", kind => {
    const f = fixture(), source = path.join(f.root, "power/fabric"); repository(path.join(source, "projects/example"), kind);
    const before = snapshotStagingScope(source), copied = snapshotTree(path.join(source, "projects")), original = new Error("migration stop"); let reached = false;
    const error = failureOf(() => install(f, currentPackage, { migratePowerData: source, onCommitStep: (step: string) => { if (step === "migration") { reached = true; throw original; } } }));
    expect(reached).toBe(true); expect(error.cause).toBe(original);
    expect(snapshotTree(path.join(evidence(error), "rollback-migration-projects"))).toEqual(copied);
    assertStagingScopeUnchanged(before, snapshotStagingScope(source), "migration source");
    expect(fs.existsSync(path.join(f.kiroHome, "kiro-fabric/data/fabric/projects"))).toBe(false);
  });

  it.each([false, true].flatMap(purge => ["directory", "worktree", "link", "bare"].map(kind => ({ purge, kind }))))("retains uninstall payload and data: $purge/$kind", ({ purge, kind }) => {
    const f = fixture(), installed = install(f), dataProject = path.join(installed.data, "fabric/projects/example"); repository(dataProject, kind);
    const marker = kind === "bare" ? "HEAD" : ".git", original = fs.lstatSync(path.join(dataProject, marker)), owner = fs.readFileSync(path.join(installed.root, "install-owner.json"));
    const result = uninstall(f, { purgeData: purge }), retained = evidence(result), actualProject = path.join(result.data, "fabric/projects/example");
    expect(result.dataPreserved).toBe(true); expect(result.dataQuarantined).toBe(purge);
    expect(fs.lstatSync(path.join(actualProject, marker)).ino).toBe(original.ino);
    expect(fs.readFileSync(path.join(retained, "manifest"))).toEqual(owner);
    expect(fs.existsSync(path.join(retained, "runtime-" + installed.packageDigest))).toBe(true);
    expect(fs.existsSync(path.join(retained, "skill/SKILL.md"))).toBe(true);
    expect(fs.existsSync(installed.profile)).toBe(false);
    expect(fs.existsSync(installed.data)).toBe(!purge);
  });

  it("restores uninstall payload and repository data while retaining the recovery manifest", () => {
    const f = fixture(), installed = install(f), project = path.join(installed.data, "fabric/projects/example"); repository(project);
    const original = new Error("uninstall stop"), owner = fs.readFileSync(path.join(installed.root, "install-owner.json")), inode = fs.lstatSync(path.join(project, ".git")).ino;
    const error = failureOf(() => uninstall(f, { purgeData: true, onCommitStep: () => { throw original; } }));
    expect(error.cause).toBe(original); expect(error.committed).toBe(false);
    expect(fs.readFileSync(path.join(evidence(error), "recovery-manifest.json"))).toEqual(owner);
    expect(fs.lstatSync(path.join(project, ".git")).ino).toBe(inode); expect(s.readLegacyInstallation(f.kiroHome)).toBeDefined();
  });

  it("reports post-commit failure without rolling back or erasing previous backups", () => {
    const f = fixture(); install(f); const original = new Error("committed hook stop");
    const error = failureOf(() => install(f, updatedPackage, { onCleanupStep: () => { throw original; } }));
    expect(error.committed).toBe(true); expect(error.legacyGateRetained).toBe(false);
    expect((error.cause as AggregateError).errors).toContain(original);
    expect(fs.existsSync(path.join(evidence(error), "previous-profile"))).toBe(true);
    expect(s.readLegacyInstallation(f.kiroHome)?.manifest.currentRuntime).toBe(validateAgentPackage(updatedPackage).digest);
  });

  it("refuses rollback quarantine collisions and retains the exclusion and both evidences", () => {
    const f = fixture(), installed = install(f), before = new Set(fs.readdirSync(installed.root)); let collision = "", snapshot: ReturnType<typeof snapshotStagingScope> | undefined;
    const error = failureOf(() => install(f, updatedPackage, { onCommitStep: (step: string) => { if (step === "profile") { collision = path.join(pending(installed.root, before), "rollback-profile"); repository(collision); snapshot = snapshotStagingScope(collision); throw new Error("rollback stop"); } } }));
    expect(error.message).toMatch(/rollback both failed/); expect(error.legacyGateRetained).toBe(true); expect(error.recoveryRequired).toBe(true);
    // The modern lock releases first; the legacy compatibility gate continues
    // excluding all writers while the uncertain rollback evidence is retained.
    expect(fs.existsSync(path.join(installed.root, ".install.lock"))).toBe(true);
    expect(fs.existsSync(path.join(installed.root, ".install-lock"))).toBe(false);
    expect(fs.existsSync(path.join(installed.root, "install-owner.json"))).toBe(false);
    expect(fs.existsSync(path.join(evidence(error), "unrecovered-manifest"))).toBe(true);
    expect(snapshot).toBeDefined(); assertStagingScopeUnchanged(snapshot!, snapshotStagingScope(collision), "collision evidence");
  });

  it("retains both sides of an uninstall rollback collision", () => {
    const f = fixture(), installed = install(f), profile = fs.readFileSync(installed.profile);
    const error = failureOf(() => uninstall(f, { onCommitStep: () => { fs.writeFileSync(installed.profile, "foreign collision", { flag: "wx", mode: 0o600 }); throw new Error("uninstall rollback stop"); } }));
    expect(error.legacyGateRetained).toBe(true); expect(error.committed).toBe(false);
    expect(fs.readFileSync(installed.profile, "utf8")).toBe("foreign collision"); expect(fs.readFileSync(path.join(evidence(error), "profile"))).toEqual(profile);
  });

  it("registers the maintained safety checks and leaves no recursive legacy cleanup call", () => {
    expect(installerSuiteFiles("contracts")).toContain("tests/installer-legacy-preservation.test.ts");
    expect(fs.readFileSync("scripts/install-agent-user.mjs", "utf8")).not.toMatch(/fs\.rmSync\(/);
  });
});
