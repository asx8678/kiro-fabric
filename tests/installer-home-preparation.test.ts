import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { planInstallationPreparation, applyInstallationPermissions, preservePiFabricProfile } from "../scripts/installer-home-preparation.mjs";
import { createConfigurationBackup } from "../scripts/installer-configuration-backup.mjs";
import { installerSafety } from "../scripts/install-agent-user.mjs";
import { acquireInstallationLock } from "../scripts/installer-lock.mjs";
import { installCompleteGeneration, inspectCompleteInstallation } from "../scripts/managed-installation.mjs";
import { fixture } from "./bundle-fixture.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function setup(legacy = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "home-preparation-"))); roots.push(root); fs.chmodSync(root, 0o700);
  const home = path.join(root, "custom Kiro home ü"), agents = path.join(home, "agents"), old = path.join(home, ".kiro-fabric");
  fs.mkdirSync(home, { mode: 0o755 }); fs.chmodSync(home, 0o755);
  fs.mkdirSync(agents, { mode: 0o755 }); fs.chmodSync(agents, 0o755);
  const profile = path.join(agents, "kiro-fabric.json"), bytes = Buffer.from('{"name":"kiro-fabric","description":"old Pi Fabric"}\n');
  fs.writeFileSync(path.join(agents, "other.json"), "{}\n", { mode: 0o600 });
  if (legacy) {
    fs.mkdirSync(old, { mode: 0o755 });
    fs.writeFileSync(profile, bytes, { mode: 0o600 });
    fs.writeFileSync(path.join(old, "install.json"), JSON.stringify({ format: 1, owner: "kiro-fabric", scope: "user", profile: { path: "agents/kiro-fabric.json", installedSha256: installerSafety.hash(bytes) } }), { mode: 0o600 });
    fs.writeFileSync(path.join(old, "old-runtime"), "preserved", { mode: 0o600 });
  }
  return { root, home, agents, old, profile, bytes };
}
const mode = (file: string) => fs.statSync(file).mode & 0o777;

describe("installation home preparation", () => {
  it("plans without mutation, then makes only the home and agents private", () => {
    const f = setup(), plan = planInstallationPreparation(f.home);
    expect(mode(f.home)).toBe(0o755); expect(mode(f.agents)).toBe(0o755);
    expect(applyInstallationPermissions(plan).map((entry: { path: string }) => entry.path)).toEqual([f.home, f.agents]);
    expect(mode(f.home)).toBe(0o700); expect(mode(f.agents)).toBe(0o700);
    expect(mode(f.root)).toBe(0o700); expect(mode(path.join(f.agents, "other.json"))).toBe(0o600);
    expect(planInstallationPreparation(f.home).permissions).toEqual([]);
    expect(fs.existsSync(path.join(f.home, "kiro-fabric"))).toBe(false);
  });

  it.each(["writable", "symlink", "replaced after planning"])("rejects %s directories without changing the linked target", kind => {
    const f = setup(), plan = planInstallationPreparation(f.home), outside = path.join(f.root, "outside");
    fs.mkdirSync(outside, { mode: 0o755 }); fs.chmodSync(outside, 0o755);
    if (kind === "writable") fs.chmodSync(f.agents, 0o777);
    else {
      fs.renameSync(f.agents, path.join(f.home, "original-agents"));
      fs.symlinkSync(outside, f.agents);
    }
    expect(() => kind === "replaced after planning" ? applyInstallationPermissions(plan) : planInstallationPreparation(f.home)).toThrow(/unsafe|symlink/i);
    expect(mode(outside)).toBe(0o755);
  });

  it("requires explicit migration and matching legacy ownership before changing anything", () => {
    const f = setup(true);
    expect(() => planInstallationPreparation(f.home)).toThrow(/--migrate-pi-fabric/);
    expect(mode(f.home)).toBe(0o755); expect(fs.readFileSync(f.profile)).toEqual(f.bytes);
    fs.appendFileSync(f.profile, "changed");
    expect(() => planInstallationPreparation(f.home, { migratePiFabric: true })).toThrow(/Modified/);
    expect(mode(f.home)).toBe(0o755);
  });

  it("preserves an unowned profile even with migration enabled", () => {
    const f = setup(); fs.writeFileSync(f.profile, f.bytes, { mode: 0o600 });
    expect(() => planInstallationPreparation(f.home, { migratePiFabric: true })).toThrow(/Unowned/);
    expect(fs.readFileSync(f.profile)).toEqual(f.bytes);
  });

  it("keeps the old profile active when the incoming bundle cannot be verified", () => {
    const f = setup(true), bin = path.join(f.root, "bin");
    fs.mkdirSync(bin, { mode: 0o700 });
    fs.writeFileSync(path.join(bin, "kiro-cli"), '#!/bin/sh\nif [ "$1" = --version ]; then printf "kiro-cli 2.21.2\\n"; else printf "%s\\n" --path; fi\n', { mode: 0o700 });
    const manager = new URL("../scripts/install-manager.mjs", import.meta.url).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import {runManager} from ${JSON.stringify(manager)}; process.exitCode = await runManager(['install','--kiro-home',process.argv[1],'--migrate-pi-fabric','--yes','--non-interactive','--json'], {context:{kind:'bootstrap'},sourceBundle:process.argv[2]});`, f.home, path.join(f.root, "missing-bundle")], {
      cwd: f.root, env: { HOME: f.root, PATH: bin, LANG: "C", LC_ALL: "C" }, encoding: "utf8", timeout: 10000,
    });
    expect(result.status, result.stdout + result.stderr).toBe(5);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).legacyProfileBackup).toBeUndefined();
    expect(fs.readFileSync(f.profile)).toEqual(f.bytes);
  });

  it("backs up the old profile and permits complete activation while preserving other configuration", async () => {
    const f = setup(true), plan = planInstallationPreparation(f.home, { migratePiFabric: true });
    applyInstallationPermissions(plan);
    const backup = createConfigurationBackup(f.home, { command: "install" });
    const saved = preservePiFabricProfile(f.home, plan.legacy, backup);
    expect(fs.readFileSync(saved)).toEqual(f.bytes); expect(mode(saved)).toBe(0o600);
    expect(fs.readFileSync(path.join(backup!.path, "agents/kiro-fabric.json"))).toEqual(f.bytes);
    expect(fs.existsSync(f.profile)).toBe(false);
    const bundle = await fixture(); roots.push(bundle);
    await installCompleteGeneration(bundle, { kiroHome: f.home, provenance: "source", validateCandidate: async () => {} });
    expect((await inspectCompleteInstallation(f.home)).status).toBe("active");
    expect(planInstallationPreparation(f.home, { migratePiFabric: true }).legacy).toBeUndefined();
    expect(fs.readFileSync(path.join(f.old, "old-runtime"), "utf8")).toBe("preserved");
    expect(fs.readFileSync(path.join(f.agents, "other.json"), "utf8")).toBe("{}\n");
    expect(fs.readFileSync(saved)).toEqual(f.bytes);
  });

  it.each(["no backup", "changed profile", "pending transaction", "busy lock"])("preserves the old profile when migration encounters %s", kind => {
    const f = setup(true), plan = planInstallationPreparation(f.home, { migratePiFabric: true });
    applyInstallationPermissions(plan);
    const backup = createConfigurationBackup(f.home, { command: "install" }), base = path.join(f.home, "kiro-fabric");
    let release: (() => void) | undefined;
    if (kind === "changed profile") fs.appendFileSync(f.profile, "changed");
    if (kind === "pending transaction") fs.mkdirSync(path.join(base, ".transactions"), { mode: 0o700 });
    if (kind === "busy lock") release = acquireInstallationLock(base);
    const before = fs.readFileSync(f.profile);
    try { expect(() => preservePiFabricProfile(f.home, plan.legacy, kind === "no backup" ? null : backup)).toThrow(); }
    finally { release?.(); }
    expect(fs.readFileSync(f.profile)).toEqual(before);
  });
});
