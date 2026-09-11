import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture as bundleFixture } from "./bundle-fixture.js";
import { canonical, createBundleManifest, sha256 } from "../scripts/bundle-contract.mjs";
import { detectInstallerPlatform } from "../scripts/installer-platform.mjs";
import { installCompleteGeneration, retireCompleteInstallation } from "../scripts/managed-installation.mjs";
import { INSTALLER_BANNER, presentManagerResult, runManager } from "../scripts/install-manager.mjs";

// Only backend execution is stubbed. Inspection, verification, backup and activation are real.
vi.mock("../scripts/installer-smoke.mjs", () => ({ smokeCandidate: vi.fn(async () => {}) }));
vi.mock("node:readline/promises", () => ({ createInterface: () => ({ question: async (prompt: string) => { process.stderr.write(prompt); return "n"; }, close: () => {} }) }));
import { smokeCandidate } from "../scripts/installer-smoke.mjs";
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

async function setup() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "installer-presentation-"))); roots.push(root); fs.chmodSync(root, 0o700);
  const home = path.join(root, "custom .kiro ü"), bin = path.join(root, "bin"); fs.mkdirSync(bin, { mode: 0o700 });
  fs.writeFileSync(path.join(bin, "kiro-cli"), '#!/bin/sh\nif [ "$1" = --version ]; then printf "kiro-cli 2.21.1\\n"; else printf "%s\\n" --path; fi\n', { mode: 0o700 });
  vi.stubEnv("HOME", root); vi.stubEnv("PATH", bin); vi.stubEnv("SHELL", "");
  const bundle = await bundleFixture(detectInstallerPlatform().target); roots.push(bundle);
  let stdout = "", stderr = "", result: any;
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => { stdout += String(chunk); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation(chunk => { stderr += String(chunk); return true; });
  return { root, home, bundle, get stdout() { return stdout; }, get stderr() { return stderr; }, get result() { return result; },
    run: (flags: string[] = [], command = "install", consent = true) => runManager([command, "--kiro-home", home, ...(consent ? ["--yes", "--non-interactive"] : []), "--no-shell-integration", ...flags], {
      context: { kind: "bootstrap" }, sourceBundle: bundle, present: (value: any, options: any) => { result = value; presentManagerResult(value, options); },
    }),
  };
}
async function reviseBundle(bundle: string, version: string) {
  const manifestPath = path.join(bundle, "bundle-manifest.json"), manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  fs.appendFileSync(path.join(bundle, "resources/steering/fabric.md"), "\nnew generation");
  const next = await createBundleManifest(bundle, { version, target: manifest.target, compatibility: manifest.compatibility, provenance: manifest.provenance, tools: manifest.tools });
  fs.writeFileSync(manifestPath, canonical(next) + "\n");
}

describe("installer presentation", () => {
  it("shows the overview before interactive confirmation and cancels without creating a home or backup", async () => {
    const f = await setup(), descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      expect(await f.run([], "install", false)).toBe(3);
      expect(f.stderr.split(INSTALLER_BANNER)).toHaveLength(2);
      expect(f.stderr).toContain("Continue? [Y/n]:");
      expect(f.stderr.indexOf("Will install")).toBeLessThan(f.stderr.indexOf("Continue?"));
      expect(f.stderr).toContain("Version determined after bundle verification");
      expect(f.stderr).not.toContain("Target version:");
      expect(f.result.outcome).toBe("cancelled");
      expect(fs.existsSync(f.home)).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(process.stdin, "isTTY", descriptor);
      else Reflect.deleteProperty(process.stdin, "isTTY");
    }
  });
  it("shows a fresh install overview with --yes and does not invent a backup", async () => {
    const f = await setup(); expect(await f.run()).toBe(0);
    expect(f.stderr.split(INSTALLER_BANNER)).toHaveLength(2);
    expect(f.stderr).toContain("Installed     Not installed (fresh installation)");
    expect(f.stderr).toContain("Will install  Fabric backend, private Node/ripgrep, manager, agent profile, skills and steering");
    expect(f.stderr).toContain("Target version: 1.0.0 (verified bundle)");
    expect(f.stderr).toContain("Private tools: Node 24.20.0, ripgrep 14.1.1");
    expect(f.stderr.indexOf("Target version:")).toBeLessThan(f.stderr.indexOf("Preparing installation"));
    expect(f.stderr).toContain("Configuration backup: not needed");
    expect(f.stderr).not.toContain("Prior configuration backup:");
    expect(f.stderr).not.toContain("Continue?");
    expect(f.result).toMatchObject({ configurationBackup: null, installationChange: { previous: { status: "absent", version: null }, target: { version: "1.0.0" }, action: "Install new version" } });
  });
  it.each([
    { target: "2.0.0", action: "Upgrade to newer version" },
    { target: "0.9.0", action: "Install older version (downgrade)" },
    { target: "1.0.0", action: "Replace same-version generation" },
    { target: null, action: "Already installed; no new generation needed" },
    { target: null, retired: true, action: "Reinstall retired installation" },
  ])("detects the verified current version and explains $action", async ({ target, retired, action }) => {
    const f = await setup();
    await installCompleteGeneration(f.bundle, { kiroHome: f.home, provenance: "source", validateCandidate: async () => {} });
    fs.writeFileSync(path.join(f.home, "settings.json"), "keep configuration", { mode: 0o600 });
    if (retired) await retireCompleteInstallation(f.home);
    if (target) await reviseBundle(f.bundle, target);
    expect(await f.run([], retired ? "install" : "update"), f.stderr).toBe(0);
    expect(f.result.installationChange).toMatchObject({ previous: { version: "1.0.0", status: retired ? "retired" : "active" }, target: { version: target ?? "1.0.0" }, action });
    expect(f.stderr).toContain(`Change: ${action}`);
    expect(f.stdout).toContain("Previously installed: 1.0.0");
    const backup = f.result.configurationBackup.path;
    expect(path.dirname(backup)).toBe(path.join(f.home, "kiro-fabric/backups"));
    expect(f.stderr).toContain(`Prior configuration backup: ${backup}`);
    expect(f.stderr.indexOf(`Prior configuration backup: ${backup}`)).toBeLessThan(f.stderr.indexOf("Target version:"));
    expect(fs.readFileSync(path.join(backup, "settings.json"), "utf8")).toBe("keep configuration");
    expect(fs.existsSync(path.join(backup, "backup-manifest.json"))).toBe(true);
    expect(f.stderr).toContain("Backup exclusions: kiro-fabric");
  });
  it("reports a verified legacy profile as version unknown and preserves it in the reported backup", async () => {
    const f = await setup(), profile = '{"name":"kiro-fabric","description":"old Pi Fabric"}\n';
    fs.mkdirSync(path.join(f.home, "agents"), { recursive: true, mode: 0o700 }); fs.mkdirSync(path.join(f.home, ".kiro-fabric"), { mode: 0o700 });
    fs.writeFileSync(path.join(f.home, "agents/kiro-fabric.json"), profile, { mode: 0o600 });
    fs.writeFileSync(path.join(f.home, ".kiro-fabric/install.json"), JSON.stringify({ format: 1, owner: "kiro-fabric", scope: "user", profile: { path: "agents/kiro-fabric.json", installedSha256: sha256(profile) } }), { mode: 0o600 });
    expect(await f.run(["--migrate-pi-fabric"]), f.stderr).toBe(0);
    expect(f.stderr).toContain("Legacy installation detected; version unknown");
    expect(f.result.installationChange.previous).toMatchObject({ status: "legacy", version: null });
    expect(fs.readFileSync(f.result.homePreparation.legacyProfileBackup, "utf8")).toBe(profile);
  });
  it.each([false, true])("retains the actual backup and target identity on a later failure (JSON=%s)", async json => {
    const f = await setup(); fs.mkdirSync(f.home, { mode: 0o700 }); fs.writeFileSync(path.join(f.home, "settings.json"), "saved", { mode: 0o600 });
    vi.mocked(smokeCandidate).mockRejectedValueOnce(new Error("fixture backend failure"));
    expect(await f.run(json ? ["--json"] : [])).toBe(7);
    expect(f.result).toMatchObject({ committed: false, configurationBackup: { path: expect.any(String) }, installationChange: { target: { version: "1.0.0" } } });
    expect(fs.readFileSync(path.join(f.result.configurationBackup.path, "settings.json"), "utf8")).toBe("saved");
    if (json) { expect(f.stderr).toBe(""); expect(f.stdout.trim().split("\n")).toHaveLength(1); expect(JSON.parse(f.stdout)).toEqual(f.result); }
    else expect(f.stderr).toContain(`Prior configuration backup: ${f.result.configurationBackup.path}`);
  });
  it("emits a single JSON success with previous and target versions and no banner", async () => {
    const f = await setup(); expect(await f.run(["--json"])).toBe(0);
    expect(f.stderr).toBe(""); expect(f.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(f.stdout).installationChange).toMatchObject({ previous: { version: null }, target: { version: "1.0.0" } });
  });
  it.each([false, true])("previews installed identity and planned backup root without creating a backup (JSON=%s)", async json => {
    const f = await setup(); await installCompleteGeneration(f.bundle, { kiroHome: f.home, provenance: "source", validateCandidate: async () => {} });
    const owner = fs.readFileSync(path.join(f.home, "kiro-fabric/install-owner.json"));
    expect(await f.run(["--dry-run", ...(json ? ["--json"] : [])])).toBe(0);
    expect(f.result).toMatchObject({ installation: { version: "1.0.0" }, plan: { configurationBackupRoot: path.join(f.home, "kiro-fabric/backups"), target: { identity: "unknown until execution" } } });
    expect(f.stderr).toBe(""); if (!json) expect(f.stdout).toContain("Installed: 1.0.0 (active)");
    expect(fs.existsSync(path.join(f.home, "kiro-fabric/backups"))).toBe(false);
    expect(fs.readFileSync(path.join(f.home, "kiro-fabric/install-owner.json"))).toEqual(owner);
  });
});
