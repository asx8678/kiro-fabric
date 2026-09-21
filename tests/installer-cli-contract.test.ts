import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MANAGER_COMMANDS, MANAGER_OPTIONS, managerHelp, parseManagerArguments } from "../scripts/installer-cli-contract.mjs";
import { installCompleteGeneration } from "../scripts/managed-installation.mjs";
import { createConfigurationBackup } from "../scripts/installer-configuration-backup.mjs";
import { runManager } from "../scripts/install-manager.mjs";
import { fixture as bundleFixture } from "./bundle-fixture.js";

const manager = fileURLToPath(new URL("../scripts/install-manager.mjs", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cli-contract-"))); roots.push(root); fs.chmodSync(root, 0o700);
  const home = path.join(root, "home"), kiroHome = path.join(home, ".kiro"); fs.mkdirSync(home, { mode: 0o700 });
  const env = { HOME: home, KIRO_HOME: kiroHome, PATH: "/no-executables", TMPDIR: root, LANG: "C", LC_ALL: "C" };
  return { root, home, kiroHome, env, run: (args: string[]) => spawnSync(process.execPath, [manager, ...args, "--kiro-home", kiroHome], { env, cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 }) };
}
function snapshot(root: string) {
  if (!fs.existsSync(root)) return null;
  const entries: unknown[] = [], queue = [root];
  while (queue.length) {
    const current = queue.shift()!;
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name), stat = fs.lstatSync(file);
      entries.push([path.relative(root, file), stat.mode, stat.mtimeMs, stat.isDirectory() ? null : stat.isSymbolicLink() ? fs.readlinkSync(file) : fs.readFileSync(file).toString("base64")]);
      if (stat.isDirectory() && !stat.isSymbolicLink()) queue.push(file);
    }
  }
  return entries;
}
function jsonResult(result: ReturnType<typeof spawnSync>) {
  expect(result.error).toBeUndefined(); expect(String(result.stderr)).toBe("");
  expect(String(result.stdout).trim().split("\n")).toHaveLength(1);
  const value = JSON.parse(String(result.stdout)); expect(value.exitCode).toBe(result.status); return value;
}

describe("central installer CLI behavior", () => {
  it("generates help from every registration and enforces each command's option allowlist", () => {
    const help = managerHelp(undefined);
    expect(Object.keys(help.commands)).toEqual(["install", "update", "doctor", "rollback", "uninstall", "start", "restore", "recover"]);
    for (const [command, spec] of Object.entries(MANAGER_COMMANDS)) {
      expect(parseManagerArguments([command, "--help"]).command).toBe(command);
      expect(managerHelp(command).commands[command]).toEqual(spec);
      for (const [name, option] of Object.entries(MANAGER_OPTIONS)) {
        if (!spec.options.includes(name)) expect(() => parseManagerArguments([command, "--help", option.flag, ...(option.value ? ["/fixture"] : [])])).toThrow();
      }
    }
    expect(help.commands.restore).toMatchObject({ confirmation: "yes", backup: false, kiro: "none" });
    expect(help.commands.recover).toMatchObject({ confirmation: "yes", backup: false, kiro: "none" });
    expect(help.options.backup?.description).toContain("managed controls");
  });
  it("captures help and parse failures through the same internal single-result boundary", async () => {
    const results: any[] = [], internal = { present: (result: any) => { results.push(result); } };
    expect(await runManager(["restore", "--json"], internal)).toBe(2);
    expect(await runManager(["--help", "--json"], internal)).toBe(0);
    expect(results.map(result => result.outcome)).toEqual(["usage", "help"]);
  });
  it("shows human and JSON help without checking clients or creating homes", () => {
    const f = fixture();
    expect(jsonResult(f.run(["--help", "--json"]))).toMatchObject({ outcome: "help", exitCode: 0 });
    const human = f.run(["restore", "--help"]);
    expect(human.status).toBe(0); expect(human.stdout).toContain("--backup PATH --yes"); expect(human.stderr).toBe("");
    expect(fs.existsSync(f.kiroHome)).toBe(false);
  });
  it.each([[], ["--non-interactive"], ["--json"], ["--json", "--non-interactive"], ["--dry-run", "--json"]].map(flags => [flags]))("rejects restore without --yes at EOF before prompting or touching files: %j", flags => {
    const f = fixture(); fs.mkdirSync(f.kiroHome, { mode: 0o700 }); fs.writeFileSync(path.join(f.kiroHome, "settings.json"), "keep", { mode: 0o600 });
    const before = snapshot(f.home), result = f.run(["restore", "--backup", path.join(f.root, "missing-backup"), ...flags]);
    expect(result.status, String(result.stdout) + String(result.stderr)).toBe(2);
    if (flags.includes("--json")) expect(jsonResult(result)).toMatchObject({ outcome: "usage", committed: false });
    else { expect(result.stdout).toBe(""); expect(result.stderr).toContain("--yes"); }
    expect(result.stderr).not.toContain("Continue?"); expect(snapshot(f.home)).toEqual(before);
  });
  it("requires a backup with restore consent, and rejects unsafe or duplicate doctor roots", () => {
    for (const args of [["restore", "--yes"], ["doctor", "--source-root", "relative"], ["doctor", "--source-root", "/a", "--source-root", "/b"], ["recover", "--yes", "--from-archive", "/a"]]) expect(() => parseManagerArguments(args)).toThrow();
  });
  it("restores an actual immutable backup at EOF with --yes and no Kiro client", () => {
    const f = fixture(); fs.mkdirSync(f.kiroHome, { mode: 0o700 });
    const file = path.join(f.kiroHome, "settings.json"); fs.writeFileSync(file, "saved", { mode: 0o600 });
    const backup = createConfigurationBackup(f.kiroHome, { command: "install" })!; fs.writeFileSync(file, "changed");
    const conflict = jsonResult(f.run(["restore", "--backup", backup.path, "--yes", "--json"]));
    expect(conflict).toMatchObject({ outcome: "failed", exitCode: 5 }); expect(conflict.error).toContain("target already exists"); expect(fs.readFileSync(file, "utf8")).toBe("changed");
    fs.unlinkSync(file); // Simulate a lost fixture file; restore never overwrites existing data.
    const restored = jsonResult(f.run(["restore", "--backup", backup.path, "--yes", "--json"]));
    expect(restored, JSON.stringify(restored)).toMatchObject({ outcome: "restored", restored: 1, dataPreserved: true });
    expect(fs.readFileSync(file, "utf8")).toBe("saved");
  });
  it("previews explicit scope without Kiro, trust lookup, backups, chmod or startup-content disclosure", () => {
    const f = fixture(); fs.mkdirSync(f.kiroHome, { mode: 0o755 }); fs.chmodSync(f.kiroHome, 0o755);
    fs.writeFileSync(path.join(f.home, ".bashrc"), "secret fixture startup value\n", { mode: 0o600 });
    const before = snapshot(f.home), result = spawnSync(process.execPath, [manager, "install", "--dry-run", "--json", "--kiro-home", f.kiroHome], { env: { ...f.env, SHELL: "/bin/bash" }, cwd: f.root, encoding: "utf8", timeout: 10000 });
    const output = jsonResult(result);
    expect(output).toMatchObject({ outcome: "planned", readOnly: true, committed: false, plan: { target: { identity: "unknown until execution" }, permissions: [{ path: f.kiroHome, previousMode: "755", mode: "700" }], shell: { status: "planned" } } });
    expect(result.stdout).not.toContain("secret fixture startup value"); expect(snapshot(f.home)).toEqual(before);
  });
  it("refuses unavailable purge without pretending transaction recovery is required", async () => {
    const f = fixture(), bundle = await bundleFixture(); roots.push(bundle);
    await installCompleteGeneration(bundle, { kiroHome: f.kiroHome, provenance: "source", validateCandidate: async () => {} });
    const before = snapshot(f.home), result = jsonResult(f.run(["uninstall", "--purge-data", "--yes", "--non-interactive", "--no-shell-integration", "--json"]));
    expect(result).toMatchObject({ exitCode: 4, outcome: "prerequisite", recoveryRequired: false, dataPreserved: true, committed: false });
    expect(snapshot(f.home)).toEqual(before);
  });
  it("recover is offline, idempotent and does not create an absent installation", () => {
    const f = fixture();
    for (let attempt = 0; attempt < 2; attempt++) expect(jsonResult(f.run(["recover", "--yes", "--json"]))).toMatchObject({ outcome: "noop", recovered: false, committed: false, recoveryRequired: false });
    expect(fs.existsSync(f.kiroHome)).toBe(false);
  });
  it("replays a verified pending transaction offline without creating a new backup or requiring Kiro", async () => {
    const f = fixture(), bundle = await bundleFixture(); roots.push(bundle);
    await expect(installCompleteGeneration(bundle, { kiroHome: f.kiroHome, provenance: "source", validateCandidate: async () => {}, onPhase: (phase: string) => { if (phase === "journal-synced") throw new Error("fixture interrupted activation"); } })).rejects.toThrow("fixture interrupted activation");
    expect(fs.existsSync(path.join(f.kiroHome, "kiro-fabric/.transactions/active.json"))).toBe(true);
    const recovered = jsonResult(f.run(["recover", "--yes", "--json"]));
    expect(recovered, JSON.stringify(recovered)).toMatchObject({ outcome: "recovered", recovered: true, recoveryRequired: false, dataPreserved: true });
    expect(fs.existsSync(path.join(f.kiroHome, "kiro-fabric/backups"))).toBe(false);
    expect(jsonResult(f.run(["recover", "--yes", "--json"]))).toMatchObject({ outcome: "noop", recovered: false });
  });
  it.each([false, true])("forwards source-home exclusions to real backup and discloses later failure (sourceRoot supplied=%s)", supplied => {
    const f = fixture(), bin = path.join(f.root, "bin"); fs.mkdirSync(bin, { mode: 0o700 }); fs.mkdirSync(f.kiroHome, { mode: 0o755 }); fs.chmodSync(f.kiroHome, 0o755);
    fs.writeFileSync(path.join(bin, "kiro-cli"), '#!/bin/sh\nif [ "$1" = --version ]; then printf "kiro-cli 2.21.1\\n"; else printf "%s\\n" --path; fi\n', { mode: 0o700 });
    fs.mkdirSync(path.join(f.kiroHome, "node_modules"), { mode: 0o700 });
    const oversized = path.join(f.kiroHome, "node_modules/developer-cache"), fd = fs.openSync(oversized, "wx", 0o600); fs.ftruncateSync(fd, 65 * 1024 * 1024); fs.closeSync(fd);
    fs.writeFileSync(path.join(f.kiroHome, "settings.json"), "keep configuration", { mode: 0o600 });
    const script = `import {runManager} from ${JSON.stringify(new URL("../scripts/install-manager.mjs", import.meta.url).href)}; process.exitCode=await runManager(['install','--kiro-home',process.argv[1],'--yes','--non-interactive','--no-shell-integration','--json'],{context:{kind:'bootstrap'},sourceBundle:process.argv[2],${supplied ? "sourceRoot:process.argv[1]" : ""}});`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, f.kiroHome, path.join(f.root, "missing-bundle")], { cwd: f.root, env: { ...f.env, PATH: bin }, encoding: "utf8", timeout: 10000 });
    const output = jsonResult(result);
    expect(output).toMatchObject({ exitCode: 5, committed: false, homePreparation: { permissions: [{ path: f.kiroHome, previousMode: "755", mode: "700" }] } });
    if (supplied) {
      expect(output.configurationBackup).toMatchObject({ sourceRoot: f.kiroHome, excludes: expect.arrayContaining(["node_modules"]) });
      expect(fs.readFileSync(path.join(output.configurationBackup.path, "settings.json"), "utf8")).toBe("keep configuration");
      expect(fs.existsSync(path.join(output.configurationBackup.path, "node_modules"))).toBe(false);
    } else { expect(output.error).toContain("backup bound"); expect(output.configurationBackup).toBeUndefined(); }
    expect(fs.statSync(oversized).size).toBe(65 * 1024 * 1024); expect(fs.readFileSync(path.join(f.kiroHome, "settings.json"), "utf8")).toBe("keep configuration");
  });
  it("recover refuses foreign evidence and retains its exact bytes", () => {
    const f = fixture(), transactions = path.join(f.kiroHome, "kiro-fabric", ".transactions"); fs.mkdirSync(transactions, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(transactions, "foreign.json"), "unknown evidence", { mode: 0o600 });
    const before = snapshot(f.home), result = jsonResult(f.run(["recover", "--yes", "--json"]));
    expect(result).toMatchObject({ outcome: "recovery-required", exitCode: 7, committed: false }); expect(snapshot(f.home)).toEqual(before);
  });
  it("directs a source update to an explicitly selected checkout before client execution or backup", async () => {
    const f = fixture(), bundle = await bundleFixture(); roots.push(bundle);
    await installCompleteGeneration(bundle, { kiroHome: f.kiroHome, provenance: "source", validateCandidate: async () => {} });
    const before = snapshot(f.home), result = jsonResult(f.run(["update", "--yes", "--json"]));
    expect(result).toMatchObject({ outcome: "prerequisite", exitCode: 4 }); expect(result.error).toContain("Source installation"); expect(result.error).toContain("--source"); expect(snapshot(f.home)).toEqual(before);
  });
  it.each([false, true])("discloses committed backend truth after a late failure (JSON=%s)", async json => {
    const f = fixture(), bundle = await bundleFixture(); roots.push(bundle);
    await installCompleteGeneration(bundle, { kiroHome: f.kiroHome, provenance: "source", validateCandidate: async () => {} });
    const script = `import {runManager} from ${JSON.stringify(new URL("../scripts/install-manager.mjs", import.meta.url).href)}; process.exitCode=await runManager(['uninstall','--kiro-home',process.argv[1],'--yes','--non-interactive','--no-shell-integration',...process.argv.slice(2)],{context:{kind:'bootstrap'},afterOperation(){throw Error('fixture finalization failed')}});`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, f.kiroHome, ...(json ? ["--json"] : [])], { env: f.env, cwd: f.root, encoding: "utf8", timeout: 15000 });
    expect(result.status).toBe(7);
    if (json) expect(jsonResult(result)).toMatchObject({ committed: true, recoveryRequired: true, operationCompleted: true, outcome: "committed-cleanup-required", configurationBackup: { path: expect.any(String) } });
    else { expect(result.stdout).toBe(""); expect(result.stderr).toContain("Activation committed: yes"); expect(result.stderr).toContain("Recovery required: yes"); expect(result.stderr).toContain("Prior configuration backup:"); }
    expect(JSON.parse(fs.readFileSync(path.join(f.kiroHome, "kiro-fabric/install-owner.json"), "utf8")).status).toBe("retired");
    expect(fs.existsSync(path.join(f.kiroHome, "kiro-fabric/data"))).toBe(true);
  });
});
