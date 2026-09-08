import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("..", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "source-bootstrap-")));
  roots.push(root); fs.chmodSync(root, 0o700);
  const home = path.join(root, "home"), bin = path.join(root, "bin");
  for (const dir of [home, bin]) fs.mkdirSync(dir, { mode: 0o700 });
  return { root, home, bin, env: { HOME: home, KIRO_HOME: path.join(home, ".kiro"), TMPDIR: root, PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`, LANG: "C", LC_ALL: "C" } };
}
function executable(file: string, body: string) { fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o700 }); }

describe("explicit checkout source bootstrap", () => {
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

  it("reaches frozen dependency installation before importing unavailable build dependencies", () => {
    const { root, home, bin, env } = fixture();
    // A small disposable source fixture, not another checkout or repository clone.
    const source = path.join(root, "source fixture"), record = path.join(root, "build-commands");
    fs.mkdirSync(source, { mode: 0o700 });
    fs.cpSync(path.join(repository, "scripts"), path.join(source, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(source, "src"), { mode: 0o700 });
    fs.cpSync(path.join(repository, "src", "installation"), path.join(source, "src", "installation"), { recursive: true });
    fs.copyFileSync(path.join(repository, "install.sh"), path.join(source, "install.sh"));
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
    expect(fs.existsSync(env.KIRO_HOME)).toBe(false);
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});
