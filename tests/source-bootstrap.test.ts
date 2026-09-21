import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("..", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "source-bootstrap-")));
  roots.push(root); fs.chmodSync(root, 0o700);
  const home = path.join(root, "home"), bin = path.join(root, "bin");
  for (const dir of [home, bin]) fs.mkdirSync(dir, { mode: 0o700 });
  return { root, home, bin, env: { HOME: home, KIRO_HOME: path.join(home, ".kiro"), TMPDIR: root, PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`, LANG: "C", LC_ALL: "C" } };
}
function executable(file: string, body: string) { fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o700 }); }

describe("explicit checkout source bootstrap", () => {
  it.each([
    [[], 2, "usage"],
    [["--source"], 2, "usage"],
    [["--source", "--yes", "--bogus"], 2, "usage"],
    [["--source", "--yes", "--version", "1.0.0"], 2, "usage"],
    [["--source", "--yes", "--enable-pull-hook", "--enable-pull-hook"], 2, "usage"],
    [["--source", "--yes"], 4, "prerequisite"],
  ] as const)("preserves source CLI error classification without prompting/building: %j", (args, status, outcome) => {
    const { root, home, bin, env } = fixture();
    const result = spawnSync(process.execPath, [path.join(repository, "scripts/source-install.mjs"), ...args, "--json"], { cwd: root, env: { ...env, PATH: bin }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 });
    expect(result.error).toBeUndefined(); expect(result.status, result.stdout + result.stderr).toBe(status);
    expect(result.stderr).toBe(""); expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ command: "install", outcome, exitCode: status }); expect(fs.readdirSync(home)).toEqual([]);
  });
  it("reports pinned pnpm absence as prerequisite, not source-build-failed", () => {
    const { root, home, bin, env } = fixture();
    // An actual cold source fixture, independent of the repository's warm cache.
    const source = path.join(root, "cold-source"); fs.mkdirSync(source, { mode: 0o700 });
    fs.cpSync(path.join(repository, "scripts"), path.join(source, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(source, "src")); fs.cpSync(path.join(repository, "src/installation"), path.join(source, "src/installation"), { recursive: true });
    for (const directory of ["skills", "resources"]) fs.cpSync(path.join(repository, directory), path.join(source, directory), { recursive: true });
    for (const file of ["package.json", "pnpm-lock.yaml", "agent-product.json", "build-toolchain.json", "tsconfig.json", "tsconfig.build.json", "install.sh"]) fs.copyFileSync(path.join(repository, file), path.join(source, file));
    executable(path.join(bin, "kiro-cli"), 'case "$*" in\n --version) printf "%s\\n" "kiro-cli 2.21.1" ;;\n "agent validate --help") printf "%s\\n" --path ;;\n *) exit 92 ;;\nesac');
    executable(path.join(bin, "pnpm"), 'printf "%s\\n" "0.0.0"');
    executable(path.join(bin, "git"), 'case "$*" in\n "rev-parse HEAD") printf "%s\\n" "1111111111111111111111111111111111111111" ;;\n "ls-files --cached --others --exclude-standard -z"|"status --porcelain -z") : ;;\n *) exit 90 ;;\nesac');
    const result = spawnSync(process.execPath, [path.join(source, "scripts/source-install.mjs"), "--source", "--yes", "--json"], { cwd: root, env: { ...env, PATH: bin }, encoding: "utf8", timeout: 10000 });
    expect(result.status, result.stdout + result.stderr).toBe(4); expect(result.stderr).toBe(""); expect(JSON.parse(result.stdout)).toMatchObject({ outcome: "prerequisite", error: expect.stringContaining("pnpm 11.20.0") }); expect(fs.readdirSync(home)).toEqual([]);
  });
  it("previews source build scope without invoking developer tools or writing an installed home", () => {
    const { root, home, bin, env } = fixture();
    const result = spawnSync(process.execPath, [path.join(repository, "scripts/source-install.mjs"), "--source", "--dry-run", "--json"], { cwd: root, env: { ...env, PATH: bin }, encoding: "utf8", timeout: 10000 });
    expect(result.status, result.stdout + result.stderr).toBe(0); expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ outcome: "planned", readOnly: true, plan: { sourceRoot: repository.replace(/\/$/, ""), target: { kind: "local-source" }, build: expect.stringContaining("not run") } }); expect(fs.readdirSync(home)).toEqual([]);
  });
  it("keeps blocked release and duplicate-source JSON output pure without mutation", () => {
    const { home, env } = fixture();
    for (const [args, status, outcome] of [
      [["--json"], 8, "discovery-unavailable"],
      [["--source", "--source", "--json"], 2, "usage"],
    ] as const) {
      const result = spawnSync("/bin/bash", [path.join(repository, "install.sh"), ...args], { env, encoding: "utf8", timeout: 10000 });
      expect(result.error).toBeUndefined(); expect(result.status).toBe(status);
      expect(JSON.parse(result.stdout)).toMatchObject({ command: "install", outcome, exitCode: status });
      expect(result.stdout.trim().split("\n")).toHaveLength(1);
      expect(result.stderr).toBe(""); expect(fs.readdirSync(home)).toEqual([]);
    }
  });

  it.each([false, true])("reaches frozen dependency installation without build dependencies (checkout is home: %s)", inHome => {
    const { root, home, bin, env } = fixture();
    // A small disposable source fixture, not another checkout or repository clone.
    const source = inHome ? env.KIRO_HOME : path.join(root, "source fixture"), record = path.join(root, "build-commands");
    fs.mkdirSync(source, { mode: 0o700 });
    fs.cpSync(path.join(repository, "scripts"), path.join(source, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(source, "src"), { mode: 0o700 });
    fs.cpSync(path.join(repository, "src", "installation"), path.join(source, "src", "installation"), { recursive: true });
    for (const directory of ["skills", "resources"]) fs.cpSync(path.join(repository, directory), path.join(source, directory), { recursive: true });
    for (const file of ["package.json", "pnpm-lock.yaml", "agent-product.json", "build-toolchain.json", "tsconfig.json", "tsconfig.build.json", "install.sh"]) fs.copyFileSync(path.join(repository, file), path.join(source, file));
    expect(fs.existsSync(path.join(source, "node_modules"))).toBe(false);
    // Controlled developer-tool fixtures prove ordering, not a successful real build.
    executable(path.join(bin, "git"), 'case "$*" in\n  "rev-parse HEAD") printf "%s\\n" "1111111111111111111111111111111111111111" ;;\n  "ls-files --cached --others --exclude-standard -z"|"status --porcelain -z") : ;;\n  *) exit 90 ;;\nesac');
    executable(path.join(bin, "pnpm"), 'case "$*" in\n  --version) printf "%s\\n" "11.20.0" ;;\n  "install --frozen-lockfile") printf "%s\\n" "frozen-install" >> "$SOURCE_BOOTSTRAP_RECORD" ;;\n  "run build") printf "%s\\n" "build" >> "$SOURCE_BOOTSTRAP_RECORD"; printf "%s\\n" "intentional fixture build stop" >&2; exit 72 ;;\n  *) exit 91 ;;\nesac');
    executable(path.join(bin, "kiro-cli"), 'case "$*" in\n  --version) printf "%s\\n" "kiro-cli 2.21.1" ;;\n  "agent validate --help") printf "%s\\n" --path ;;\n  *) exit 92 ;;\nesac');
    const result = spawnSync("/bin/bash", [path.join(source, "install.sh"), "--source", "--yes", "--non-interactive", "--json"], { cwd: home, env: { ...env, SOURCE_BOOTSTRAP_RECORD: record }, encoding: "utf8", timeout: 30000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(4);
    expect(JSON.parse(result.stdout)).toMatchObject({ outcome: "source-build-failed", error: expect.stringContaining("intentional fixture build stop") });
    expect(fs.readFileSync(record, "utf8")).toBe("frozen-install\nbuild\n");
    expect(fs.existsSync(env.KIRO_HOME)).toBe(inHome);
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});
