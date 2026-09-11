import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fixture } from "./bundle-fixture.js";
import { installerSafety } from "../scripts/install-agent-user.mjs";
import { installCompleteGeneration, inspectCompleteInstallation, retireCompleteInstallation } from "../scripts/managed-installation.mjs";
import { shellQuote } from "../scripts/install-manager.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const manager = fileURLToPath(new URL("../scripts/install-manager.mjs", import.meta.url));

function setup() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "manager-start-")));
  roots.push(root); fs.chmodSync(root, 0o700);
  const home = path.join(root, "home"), kiroHome = path.join(home, ".kiro");
  const bin = path.join(root, "client bin"), project = path.join(root, "project % # ü");
  const calls = path.join(root, "client-calls"), launch = path.join(root, "launch-context");
  for (const directory of [home, bin, project]) fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(path.join(bin, "kiro-cli"), `#!/bin/sh
printf '%s\\n' "$*" >> ${shellQuote(calls)}
case "$*" in
  --version) printf 'kiro-cli 2.21.1\\n' ;;
  'agent validate --help') printf '%s\\n' --path ;;
  '--v3 --agent kiro-fabric'|'--v3 --agent kiro-fabric-review-'*|'--v3 --agent kiro-fabric-minimal-'*)
    printf '%s\\n' "$PWD" "$KIRO_HOME" "$KIRO_FABRIC_LAUNCH_WORKSPACE" > ${shellQuote(launch)}
    exit "$START_TEST_EXIT" ;;
  *) exit 91 ;;
esac
`, { mode: 0o700 });
  return {
    root, home, kiroHome, bin, project, calls, launch,
    async install() {
      const bundle = await fixture(); roots.push(bundle);
      return await installCompleteGeneration(bundle, { kiroHome, userHome: home, env: {}, provenance: "source", validateCandidate: async () => {} });
    },
    run(clientExit = 0, guidanceMode?: "standard" | "review" | "minimal") {
      return spawnSync(process.execPath, [manager, "start", "--kiro-home", kiroHome, ...(guidanceMode ? ["--guidance-mode", guidanceMode] : [])], {
        cwd: project, env: { HOME: home, KIRO_HOME: "/must-not-be-used", PATH: bin, TMPDIR: root, LANG: "C", LC_ALL: "C", KIRO_FABRIC_LAUNCH_WORKSPACE: "/must-be-overwritten", START_TEST_EXIT: String(clientExit) },
        encoding: "utf8", timeout: 15000, maxBuffer: 16384, stdio: ["ignore", "pipe", "pipe"],
      });
    },
  };
}

// Include inventory and mtimes so a rejected start cannot silently repair,
// remove recovery evidence, or initialize data while reporting a failure.
function snapshot(root: string): unknown {
  if (!fs.existsSync(root)) return null;
  return fs.readdirSync(root).sort().map(name => {
    const file = path.join(root, name), stat = fs.lstatSync(file);
    return { name, mode: stat.mode, mtime: stat.mtimeMs, value: stat.isDirectory() ? snapshot(file) : fs.readFileSync(file).toString("base64") };
  });
}
function expectRefused(f: ReturnType<typeof setup>, code: number, message: RegExp) {
  const before = snapshot(f.kiroHome);
  const result = f.run();
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(code);
  expect(result.stderr).toMatch(message);
  expect(result.stdout).toBe("");
  // Even help/version execution must wait until installation admission passes.
  expect(fs.existsSync(f.calls)).toBe(false);
  expect(fs.existsSync(f.launch)).toBe(false);
  expect(snapshot(f.kiroHome)).toEqual(before);
}

function legacy(f: ReturnType<typeof setup>, schema: number) {
  const p = installerSafety.paths(f.kiroHome), name = "b".repeat(64);
  const runtime = path.join(p.runtime, name), skill = path.join(p.skills, "fabric-exec");
  for (const directory of [path.dirname(p.profile), runtime, skill]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(p.profile, "legacy profile", { mode: 0o600 });
  fs.writeFileSync(path.join(skill, "SKILL.md"), "legacy skill", { mode: 0o600 });
  fs.writeFileSync(path.join(runtime, "main.js"), "legacy backend", { mode: 0o600 });
  const owner = { schemaVersion: 1, owner: "kiro-fabric-agent-user-install", packageDigest: name, runtime, profileSha256: installerSafety.hash("legacy profile"), skillSha256: installerSafety.hash("legacy skill") };
  fs.writeFileSync(p.manifest, JSON.stringify(owner) + "\n", { mode: 0o600 });
  if (schema === 2) {
    const evidence = installerSafety.readLegacyInstallation(f.kiroHome);
    if (!evidence?.legacy) throw new Error("Missing legacy fixture evidence");
    fs.writeFileSync(p.manifest, JSON.stringify({ schemaVersion: 2, owner: owner.owner, packageDigest: name, currentRuntime: name, previousRuntime: null, profileSha256: owner.profileSha256, skill: evidence.legacy.skillTree, runtimeGenerations: [{ name, tree: evidence.legacy.runtimeTree }] }) + "\n");
  }
}

describe("start installation admission", () => {
  it("requires an installed active generation without creating an absent home", async () => {
    const f = setup();
    expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe("absent");
    expectRefused(f, 4, /not installed.*install/i);
  });
  it.each([1, 2])("requires explicit migration of schema-%s legacy installations", async schema => {
    const f = setup(); legacy(f, schema);
    expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe("legacy");
    expectRefused(f, 4, /legacy.*migration/i);
  });
  it("refuses a verified retired installation", async () => {
    const f = setup(); await f.install(); await retireCompleteInstallation(f.kiroHome);
    expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe("retired");
    expectRefused(f, 4, /retired.*install/i);
  });
  it.each([
    [false, "active.json"], [true, "active.json"],
    [false, "candidate.json"], [true, "candidate.json"],
  ] as const)("preserves pending recovery evidence (installed=%s, %s)", async (installed, journal) => {
    const f = setup(); if (installed) await f.install();
    const directory = path.join(f.kiroHome, "kiro-fabric/.transactions");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(directory, journal), "{}\n", { mode: 0o600 });
    expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe("recovery-required");
    expectRefused(f, 7, /requires recovery.*preserved/i);
  });
  it("preserves foreign transaction evidence and its recovery exit code", async () => {
    const f = setup(); await f.install();
    fs.writeFileSync(path.join(f.kiroHome, "kiro-fabric/.transactions/unknown.json"), "foreign", { mode: 0o600 });
    expectRefused(f, 7, /foreign transaction material/i);
  });
  it.each(["profile", "resource"])("keeps integrity checks before client execution for a modified %s", async kind => {
    const f = setup(), installed = await f.install();
    const target = kind === "profile" ? installed.paths.profile : path.join(installed.paths.runtime, installed.digest, "resources/steering/fabric.md");
    fs.appendFileSync(target, "tampered");
    expectRefused(f, 5, /modified|inventory/i);
  });
  it.each(["review", "minimal"] as const)("launches explicit %s mode without replacing the managed default", async mode => {
    const f = setup(), installed = await f.install();
    const original = fs.readFileSync(installed.paths.profile);
    const result = f.run(0, mode);
    expect(result.error).toBeUndefined(); expect(result.status, result.stdout + result.stderr).toBe(0);
    const name = `kiro-fabric-${mode}-${installed.digest.slice(0, 12)}`;
    expect(fs.readFileSync(f.calls, "utf8")).toContain(`--v3 --agent ${name}`);
    const profile = JSON.parse(fs.readFileSync(path.join(f.kiroHome, "agents", `${name}.json`), "utf8"));
    expect(profile.name).toBe(name); expect(profile.tools).toEqual(["@fabric/fabric_exec"]);
    if (mode === "minimal") { expect(profile.resources).toEqual([]); expect(profile.hooks).toEqual([]); }
    expect(fs.readFileSync(installed.paths.profile)).toEqual(original);
    expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe("active");
  });

  it.each([0, 23])("launches only an active verified generation and forwards client exit %s", async exitCode => {
    const f = setup(); await f.install();
    expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe("active");
    const before = snapshot(f.kiroHome), result = f.run(exitCode);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(exitCode);
    expect(result.stderr).toBe("");
    expect(fs.readFileSync(f.calls, "utf8").trim().split("\n")).toEqual(["--version", "agent validate --help", "--v3 --agent kiro-fabric"]);
    expect(fs.readFileSync(f.launch, "utf8").trim().split("\n")).toEqual([f.project, f.kiroHome, fs.realpathSync(f.project)]);
    expect(snapshot(f.kiroHome)).toEqual(before);
  });
});
