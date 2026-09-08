import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { resolveKiroHome } from "../scripts/install-agent-user.mjs";

const roots: string[] = [];
const fixture = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "installer-home-")));
  roots.push(root); fs.chmodSync(root, 0o700);
  const home = path.join(root, "home"); fs.mkdirSync(home, { mode: 0o700 });
  return { root, home };
};
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe("installer invocation roles and global home", () => {
  it("selects explicit CLI home over environment and preserves unusual printable names", () => {
    const { home } = fixture(); const selected = path.join(home, "Kiro 空間 % #");
    expect(resolveKiroHome({ KIRO_HOME: "" }, home, { kiroHome: selected })).toBe(selected);
    expect(resolveKiroHome({}, home)).toBe(path.join(home, ".kiro"));
    expect(fs.existsSync(selected)).toBe(false);
  });
  it("rejects present-empty, relative and control-bearing overrides without mutation", () => {
    const { home } = fixture();
    for (const value of ["", "relative", path.join(home, "bad\nname"), path.join(home, "bad\u001bname")]) {
      expect(() => resolveKiroHome({ KIRO_HOME: value }, home)).toThrow();
    }
    expect(fs.readdirSync(home)).toEqual([]);
  });
  it("allows safe explicit home when the unused default home does not yet exist", () => {
    const { root, home } = fixture();
    expect(resolveKiroHome({ KIRO_HOME: path.join(home, "selected") }, path.join(root, "missing-user-home"))).toBe(path.join(home, "selected"));
  });
  it("does not confuse HOME invocation cwd with workspace authority, while preserving explicit overlap rejection", () => {
    const { home } = fixture();
    const modulePath = path.resolve("scripts/install-agent-user.mjs");
    const script = `import {resolveKiroHome} from ${JSON.stringify(new URL(`file://${modulePath}`).href)}; process.stdout.write(resolveKiroHome({},process.env.HOME));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: home, env: { HOME: home, PATH: "/usr/bin:/bin" }, encoding: "utf8", timeout: 10000,
    });
    expect(result.status).toBe(0); expect(result.stdout).toBe(path.join(home, ".kiro"));
    expect(() => resolveKiroHome({}, home, { workspaceRoot: home })).toThrow(/overlap workspace/);
    expect(() => resolveKiroHome({}, home, { packageRoot: home })).toThrow(/overlap release package/);
  });
});
