import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { installUserAgent } from "../scripts/install-agent-user.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
const snapshot = (root: string): unknown => {
  const stats = fs.lstatSync(root);
  return [stats.mode, stats.mtimeMs, stats.ctimeMs, stats.isSymbolicLink() ? fs.readlinkSync(root) :
    stats.isDirectory() ? fs.readdirSync(root).sort().map(name => [name, snapshot(path.join(root, name))]) : fs.readFileSync(root).toString("base64")];
};
const fixture = (installed = true) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-doctor-")));
  roots.push(root);
  fs.chmodSync(root, 0o700);
  const home = path.join(root, "home"), workspace = path.join(root, "workspace"), bin = path.join(root, "bin");
  for (const dir of [home, workspace, bin]) fs.mkdirSync(dir, { mode: 0o700 });
  const kiroHome = path.join(home, ".kiro");
  const env = { HOME: home, KIRO_HOME: kiroHome, PATH: bin, SECRET_SENTINEL: "never-disclose", RIPGREP_CONFIG_PATH: "/do-not-read" };
  // Fail unless the probe strips inherited config/secrets and uses exactly version-only args.
  fs.writeFileSync(path.join(bin, "rg"), '#!/bin/sh\n[ -z "$HOME$KIRO_HOME$SECRET_SENTINEL$RIPGREP_CONFIG_PATH" ] || exit 9\n[ "$1" = --no-config ] && [ "$2" = --version ] && [ "$#" = 2 ] || exit 8\nprintf "ripgrep 14.1.0\\n"\n', { mode: 0o700 });
  fs.writeFileSync(path.join(bin, "kiro-cli"), '#!/bin/sh\nexit 99\n', { mode: 0o700 });
  const installation = installed ? installUserAgent(path.resolve(".tmp/kiro-fabric-agent"), env, home, { workspaceRoot: workspace }) : undefined;
  const run = (args: string[] = [], overrides = {}) => {
    const before = snapshot(root);
    const result = spawnSync(process.execPath, [path.resolve("scripts/install-agent-user.mjs"), "--doctor", ...args], {
      env: { ...env, ...overrides }, cwd: workspace, encoding: "utf8", timeout: 15000,
    });
    expect(snapshot(root)).toEqual(before);
    expect(result.error).toBeUndefined();
    expect(result.stdout.length).toBeLessThan(8192);
    expect(result.stdout).not.toContain("never-disclose");
    return result;
  };
  return { root, home, kiroHome, bin, installation, run };
};
const diagnostic = (result: ReturnType<ReturnType<typeof fixture>["run"]>, id: string) =>
  JSON.parse(result.stdout).checks.find((entry: { id: string }) => entry.id === id);

describe("read-only Agent doctor", () => {
  it("read-only inspection accepts the full generation bound while a new update still rejects", () => {
    const source = fs.readFileSync(path.resolve("scripts/install-agent-user.mjs"), "utf8");
    const body = source.slice(source.indexOf("const inspectTarget ="), source.indexOf("const acquireLock ="));
    const record = { manifest: { runtimeGenerations: Array.from({ length: 256 }, (_, i) => ({ name: `generation-${i}` })) } };
    let validated = 0;
    const inspect = runInNewContext(`${body}; inspectTarget`, {
      path, MAX_RUNTIME_GENERATIONS: 256, lstat: () => undefined, readManifest: () => record,
      assertSafeDirectory: () => {}, assertInstallationUnmodified: () => { validated++; },
      assertNoUnownedRuntimeGenerations: () => {}, assertUnownedTargetsAbsent: () => {},
    }) as (home: string, paths: Record<string, string>, generation?: string) => unknown;
    const paths = { base: "/base", profile: "/profile", runtime: "/runtime", skills: "/skills", data: "/data" };
    expect(inspect("/home", paths)).toBe(record); expect(validated).toBe(1);
    expect(() => inspect("/home", paths, "new-generation")).toThrow(/update bound/);
    expect(source).toContain("inspectTarget(kiroHome, targets)");
  });

  it("validates an existing staged-package installation without writes or launching Kiro/runtime", () => {
    const f = fixture();
    const result = f.run();
    expect(result.status).toBe(0);
    for (const id of ["node", "rg", "kiro-cli", "kiro-home", "installation"]) expect(diagnostic(result, id).status).toBe("PASS");
    expect(diagnostic(result, "node").message).toContain(process.version);
    expect(diagnostic(result, "rg-version").message).toBe("ripgrep 14.1.0");
    expect(diagnostic(result, "live-session")).toMatchObject({ status: "WARNING" });
    expect(diagnostic(result, "live-session").message).toContain("return await fabric.info()");
    expect(result.stderr).toBe("");
  });
  it("fails missing rg and missing installation without creating KIRO_HOME", () => {
    const f = fixture(false);
    fs.unlinkSync(path.join(f.bin, "rg"));
    const result = f.run();
    expect(result.status).toBe(1);
    expect(diagnostic(result, "rg").status).toBe("FAIL");
    expect(diagnostic(result, "installation").status).toBe("FAIL");
    expect(fs.existsSync(f.kiroHome)).toBe(false);
  });
  it("rejects unsafe rg without executing or repairing it", () => {
    const f = fixture(false);
    fs.chmodSync(path.join(f.bin, "rg"), 0o777);
    const result = f.run();
    expect(result.status).toBe(1);
    expect(diagnostic(result, "rg").status).toBe("FAIL");
  });
  it("does not search relative PATH entries and requires Kiro CLI availability", () => {
    const result = fixture(false).run([], { PATH: ".:" });
    expect(diagnostic(result, "rg").status).toBe("FAIL");
    expect(diagnostic(result, "kiro-cli").status).toBe("FAIL");
  });
  it.each(["broad", "writable", "symlink"])("rejects %s KIRO_HOME without repair", kind => {
    const f = fixture(false);
    let target = f.home;
    if (kind === "writable") { fs.mkdirSync(f.kiroHome, { mode: 0o700 }); fs.chmodSync(f.kiroHome, 0o777); target = f.kiroHome; }
    if (kind === "symlink") { fs.symlinkSync(f.home, f.kiroHome); target = f.kiroHome; }
    const result = f.run([], { KIRO_HOME: target });
    expect(result.status).toBe(1);
    expect(diagnostic(result, "kiro-home").status).toBe("FAIL");
  });
  it.each(["missing", "modified", "unsafe", "runtime"])("rejects %s installed payload", kind => {
    const f = fixture();
    const profile = f.installation!.profile;
    if (kind === "missing") fs.unlinkSync(profile);
    if (kind === "modified") fs.appendFileSync(profile, " ");
    if (kind === "unsafe") fs.chmodSync(profile, 0o666);
    if (kind === "runtime") fs.writeFileSync(path.join(f.installation!.runtime, "unexpected"), "changed");
    const result = f.run();
    expect(result.status).toBe(1);
    expect(diagnostic(result, "installation").status).toBe("FAIL");
  });
  it("checks MCP metadata only, never parsing or printing its contents", () => {
    const f = fixture();
    const config = path.join(f.installation!.data, "fabric", "config");
    fs.mkdirSync(config, { recursive: true, mode: 0o700 });
    const file = path.join(config, "mcp.json");
    fs.writeFileSync(file, "never-disclose invalid JSON", { mode: 0o600 });
    expect(diagnostic(f.run(), "mcp-file-presence").status).toBe("PASS");
    for (const mode of [0o644, 0o666]) {
      fs.chmodSync(file, mode);
      expect(diagnostic(f.run(), "mcp-file-safety").status).toBe("FAIL");
    }
  });
  it.each([["--uninstall"], ["--purge-data"], ["--migrate-power-data", "/unused"], ["/unused-package"]])("rejects incompatible arguments %j", (...args) => {
    const result = fixture(false).run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--doctor cannot be combined");
    expect(result.stdout).toBe("");
  });
});
