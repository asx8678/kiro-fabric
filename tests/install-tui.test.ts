import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { removeFixtureSync } from "./fixture-cleanup.mjs";

const roots: string[] = [];
const tui = path.resolve("scripts/install-tui.mjs");
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
const fixture = (): string => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-tui-test-")));
  roots.push(root);
  return root;
};
interface Run { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }
const runTui = (root: string, args: string[], setup = "", environment: NodeJS.ProcessEnv = {}): Promise<Run> => {
  // Exercise the actual CLI, but force its Node-version preflight to refuse
  // before any pnpm, Kiro client or installer subprocess can be started.
  const code = `import fs from "node:fs";
import path from "node:path";
Object.defineProperty(process.versions, "node", { value: "0.0.0" });
process.argv = [process.execPath, ${JSON.stringify(tui)}, ...${JSON.stringify(args)}];
${setup}
await import(${JSON.stringify(pathToFileURL(tui).href)});`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", code], {
      env: { ...process.env, TMPDIR: root, NO_COLOR: "1", ...environment },
      stdio: ["ignore", "pipe", "pipe"], timeout: 15_000,
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
};
const logs = (root: string): string[] => fs.readdirSync(root)
  .filter(name => name.startsWith("fabric-fovea-install-"))
  .map(name => path.join(root, name, "installer.log"));
const assertRefusedPreflight = (run: Run): void => {
  expect(run.signal, run.stderr).toBeNull();
  expect(run.status, run.stderr).toBe(4);
  expect(run.stderr).toContain("Pre-installation checks");
  expect(run.stderr).not.toContain("Delegating to:");
};
const assertPrivateLog = (file: string): void => {
  const directory = fs.lstatSync(path.dirname(file)), stat = fs.lstatSync(file);
  expect(directory.isDirectory()).toBe(true);
  expect(directory.isSymbolicLink()).toBe(false);
  expect(stat.isFile()).toBe(true);
  expect(stat.isSymbolicLink()).toBe(false);
  expect(stat.nlink).toBe(1);
  if (process.platform !== "win32") {
    expect(directory.mode & 0o7777).toBe(0o700);
    expect(stat.mode & 0o7777).toBe(0o600);
    expect(directory.uid).toBe(process.getuid!());
    expect(stat.uid).toBe(process.getuid!());
  }
  expect(fs.readFileSync(file, "utf8")).toContain("Pre-installation checks");
};

describe("installer TUI CLI and private logging", () => {
  it.each(["default", "environment", "explicit"])("shows and delegates the same %s home with versioned, skill-preserving upgrade consent", async selection => {
    const root = fixture(), home = path.join(root, "home"), bin = path.join(root, "bin");
    for (const directory of [home, bin]) fs.mkdirSync(directory, { mode: 0o700 });
    const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
    const scripts = {
      pnpm: `printf '%s\\n' '${pkg.packageManager.slice(5)}'`,
      "kiro-cli": "printf 'kiro-cli 2.21.1\\n'",
      // Capture the real delegated argv, never execute the actual installer.
      bash: "printf 'DELEGATED_ARG:%s\\n' \"$@\"",
    };
    for (const [name, script] of Object.entries(scripts)) fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${script}\n`, { mode: 0o700 });
    const envHome = path.join(home, ".kiro-fabric"), explicitHome = path.join(home, "a long custom installation directory that must not be clipped", ".kiro");
    const expected = selection === "explicit" ? explicitHome : selection === "environment" ? envHome : path.join(home, ".kiro");
    const result = await runTui(root, ["--yes", "--no-shell-integration", ...(selection === "explicit" ? ["--kiro-home", explicitHome, "--migrate-pi-fabric"] : [])],
      `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(process.versions.node)} });`,
      { HOME: home, KIRO_HOME: selection === "default" ? undefined : envHome, PATH: bin });
    expect(result.signal, result.stderr).toBeNull(); expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(`Kiro Fabric v${pkg.version} + Fovea`);
    expect(result.stderr).toContain(`Kiro home: ${expected}`);
    expect(result.stderr).toContain(path.join(expected, "agents/kiro-fabric.json"));
    expect(result.stderr).toContain(path.join(expected, "kiro-fabric/runtime/<generation>/resources"));
    expect(result.stderr).toContain("Keep existing user skills");
    expect(result.stderr).toContain("Keep old runtimes for existing sessions and rollback");
    const delegated = result.stdout.split("\n").filter(line => line.startsWith("DELEGATED_ARG:")).map(line => line.slice("DELEGATED_ARG:".length));
    expect(delegated).toEqual([path.resolve("install.sh"), "--source", "--kiro-home", expected, "--migrate-pi-fabric", "--yes", "--no-shell-integration"]);
    expect(fs.existsSync(expected)).toBe(false);
  });

  it.each(["--yes", "-y"])("accepts %s and reports the log even when preflight fails", async flag => {
    const root = fixture(), run = await runTui(root, [flag]);
    assertRefusedPreflight(run);
    const files = logs(root);
    expect(files).toHaveLength(1);
    assertPrivateLog(files[0]!);
    expect(run.stderr).toContain(`Installation log: ${files[0]}`);
  });

  it("keeps help read-only and advertises both confirmation spellings", async () => {
    const root = fixture(), run = await runTui(root, ["--help"]);
    expect(run.signal).toBeNull();
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("-y, --yes");
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it.each(["symlink", "permissive file", "directory"])("does not open or modify a legacy log that is a %s", async kind => {
    const root = fixture(), legacy = path.join(root, "fabric-fovea-install.log");
    const victim = path.join(root, "victim.txt");
    fs.writeFileSync(victim, "KEEP\n", { mode: 0o600 });
    if (kind === "symlink") fs.symlinkSync(victim, legacy);
    else if (kind === "directory") fs.mkdirSync(legacy, { mode: 0o700 });
    else { fs.writeFileSync(legacy, "OLD\n"); fs.chmodSync(legacy, 0o644); }
    const run = await runTui(root, ["--yes"]);
    assertRefusedPreflight(run);
    expect(fs.readFileSync(victim, "utf8")).toBe("KEEP\n");
    if (kind === "symlink") expect(fs.lstatSync(legacy).isSymbolicLink()).toBe(true);
    else if (kind === "directory") expect(fs.readdirSync(legacy)).toEqual([]);
    else {
      expect(fs.readFileSync(legacy, "utf8")).toBe("OLD\n");
      expect(fs.statSync(legacy).mode & 0o777).toBe(0o644);
    }
    const files = logs(root);
    expect(files).toHaveLength(1);
    assertPrivateLog(files[0]!);
  });

  it("isolates simultaneous invocations in distinct private logs", async () => {
    const root = fixture();
    const runs = await Promise.all([runTui(root, ["--yes"]), runTui(root, ["-y"])]);
    for (const run of runs) assertRefusedPreflight(run);
    const files = logs(root);
    expect(files).toHaveLength(2);
    for (const file of files) {
      assertPrivateLog(file);
      expect(runs.filter(run => run.stderr.includes(file))).toHaveLength(1);
      expect(fs.readFileSync(file, "utf8").match(/Pre-installation checks/g)).toHaveLength(1);
    }
  });

  it.each(["symlink", "directory", "permissive", "hardlink"])("refuses a %s at the fresh log boundary before writing", async kind => {
    const root = fixture(), victim = path.join(root, "victim.txt");
    fs.writeFileSync(victim, "KEEP\n", { mode: 0o600 });
    const setup = `const open = fs.openSync;
fs.openSync = (file, flags, mode) => {
  if (typeof file !== "string" || path.basename(file) !== "installer.log") return open(file, flags, mode);
  const kind = ${JSON.stringify(kind)};
  if (kind === "symlink") fs.symlinkSync(${JSON.stringify(victim)}, file);
  if (kind === "directory") fs.mkdirSync(file);
  const fd = open(file, flags, mode);
  if (kind === "permissive") fs.fchmodSync(fd, 0o644);
  if (kind === "hardlink") fs.linkSync(file, ${JSON.stringify(path.join(root, "alias.log"))});
  return fd;
};`;
    const run = await runTui(root, ["--yes"], setup);
    expect(run.signal, run.stderr).toBeNull();
    expect(run.status, run.stderr).toBe(1);
    expect(run.stderr).not.toContain("Pre-installation checks");
    expect(fs.readFileSync(victim, "utf8")).toBe("KEEP\n");
    if (kind === "permissive" || kind === "hardlink") {
      expect(logs(root)).toHaveLength(1);
      expect(fs.readFileSync(logs(root)[0]!, "utf8")).toBe("");
    }
  });
});
