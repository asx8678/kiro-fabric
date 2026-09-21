import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { configurePullHook } from "../scripts/source-pull-hook.mjs";
import { resolveKiroHome } from "../scripts/install-agent-user.mjs";
import { trustedMacApplications } from "../scripts/install-manager.mjs";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
function fixture() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-pull-"))); roots.push(home);
  const root = path.join(home, ".kiro"); fs.mkdirSync(root, { mode: 0o700 });
  expect(spawnSync("git", ["init", root], { encoding: "utf8" }).status).toBe(0);
  for (const dir of [".git", ".git/hooks"]) fs.chmodSync(path.join(root, dir), 0o700);
  return { home, root };
}
describe("Kiro home source checkout", () => {
  it("allows only exact source equality without weakening package or workspace checks", () => {
    const { home, root } = fixture();
    fs.writeFileSync(path.join(root, "settings.json"), "private");
    expect(resolveKiroHome({}, home, { sourceRoot: root })).toBe(root);
    for (const options of [{ packageRoot: root }, { workspaceRoot: root }, { sourceRoot: home }]) expect(() => resolveKiroHome({}, home, options)).toThrow(/overlap/);
    const nested = path.join(root, "checkout"); fs.mkdirSync(nested);
    expect(() => resolveKiroHome({}, home, { sourceRoot: nested })).toThrow(/overlap/);
    expect(fs.readFileSync(path.join(root, "settings.json"), "utf8")).toBe("private");
  });
  it("installs an idempotent opt-in hook and propagates installer failure without deleting private data", () => {
    const { root } = fixture();
    const target = configurePullHook(root, root, false); expect(fs.existsSync(target)).toBe(false);
    configurePullHook(root, root, true); configurePullHook(root, root, true);
    const sentinel = path.join(root, "settings.json"); fs.writeFileSync(sentinel, "private");
    fs.writeFileSync(path.join(root, "install.sh"), '#!/bin/sh\nprintf "%s\\n" "$@" > invoked\nexit 0\n');
    let result = spawnSync(target, ["0"], { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(path.join(root, "invoked"), "utf8")).toBe(`--source\n--kiro-home\n${root}\n--yes\n--non-interactive\n`);
    fs.writeFileSync(path.join(root, "install.sh"), "exit 42\n");
    result = spawnSync(target, ["0"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(1); expect(result.stderr).toContain("UPDATE NOT ACTIVATED");
    expect(fs.readFileSync(sentinel, "utf8")).toBe("private");
  });
  it("preserves foreign hooks and custom hook configuration", () => {
    const { root } = fixture(); const target = path.join(root, ".git/hooks/post-merge");
    fs.writeFileSync(target, "foreign", { mode: 0o700 });
    expect(() => configurePullHook(root, root, true)).toThrow(/preserved/);
    expect(fs.readFileSync(target, "utf8")).toBe("foreign");
    fs.unlinkSync(target);
    expect(spawnSync("git", ["config", "core.hooksPath", "custom"], { cwd: root }).status).toBe(0);
    expect(() => configurePullHook(root, root, true)).toThrow(/core.hooksPath/);
    expect(fs.existsSync(target)).toBe(false);
  });
  it("limits the macOS exception to root:admin Applications with mode 775", () => {
    const stat = { uid: 0, gid: 80, mode: 0o40775 };
    expect(trustedMacApplications("/Applications", stat, "darwin")).toBe(true);
    for (const [directory, candidate, platform] of [
      ["/Applications", stat, "linux"], ["/Applications/Kiro CLI.app", stat, "darwin"],
      ["/Applications", { ...stat, gid: 20 }, "darwin"], ["/Applications", { ...stat, uid: 502 }, "darwin"],
      ["/Applications", { ...stat, mode: 0o40777 }, "darwin"],
    ] as const) expect(trustedMacApplications(directory, candidate, platform)).toBe(false);
  });
});
