import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  USER_POWER_NAME,
  installPowerPackage,
  resolveKiroHome,
  resolveUserPowerRoot,
  shouldInstallUserPower,
} from "../scripts/power-user-install.mjs";

const temps: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kiro-fabric-user-power-"));
  temps.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of temps.splice(0)) {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("user-global Power install", () => {
  it("defaults to ~/.kiro/powers/kiro-fabric", () => {
    const home = scratch();
    expect(resolveKiroHome({}, home)).toBe(join(home, ".kiro"));
    expect(resolveUserPowerRoot({}, home)).toBe(join(home, ".kiro", "powers", USER_POWER_NAME));
  });

  it("honors KIRO_HOME", () => {
    const home = scratch();
    expect(resolveUserPowerRoot({ KIRO_HOME: home }, scratch()))
      .toBe(join(home, "powers", USER_POWER_NAME));
  });

  it("refuses a Kiro home that is a file or symlink", () => {
    const dir = scratch();
    const file = join(dir, "not-a-dir");
    writeFileSync(file, "nope\n");
    expect(() => resolveKiroHome({ KIRO_HOME: file })).toThrow(/not a directory/);
    const link = join(dir, "link-home");
    symlinkSync(dir, link);
    expect(() => resolveKiroHome({ KIRO_HOME: link })).toThrow(/symlink/);
  });

  it("copies the staged package into the user Power root and replaces it", () => {
    const staging = scratch();
    writeFileSync(join(staging, "plugin.json"), JSON.stringify({ name: "kiro-fabric" }));
    const dest = join(scratch(), "powers", USER_POWER_NAME);
    expect(installPowerPackage(staging, dest)).toBe(dest);
    expect(JSON.parse(readFileSync(join(dest, "plugin.json"), "utf8"))).toEqual({ name: "kiro-fabric" });
    writeFileSync(join(staging, "plugin.json"), JSON.stringify({ name: "kiro-fabric", version: "next" }));
    installPowerPackage(staging, dest);
    expect(JSON.parse(readFileSync(join(dest, "plugin.json"), "utf8"))).toEqual({
      name: "kiro-fabric",
      version: "next",
    });
  });

  it("refuses a destination symlink", () => {
    const staging = scratch();
    const parent = scratch();
    const dest = join(parent, "powers", USER_POWER_NAME);
    mkdirSync(join(parent, "powers"));
    symlinkSync(staging, dest);
    expect(() => installPowerPackage(staging, dest)).toThrow(/symlink/);
    expect(lstatSync(dest).isSymbolicLink()).toBe(true);
  });

  it("skips user install only when KIRO_FABRIC_SKIP_USER_POWER_INSTALL=1", () => {
    expect(shouldInstallUserPower({})).toBe(true);
    expect(shouldInstallUserPower({ KIRO_FABRIC_SKIP_USER_POWER_INSTALL: "0" })).toBe(true);
    expect(shouldInstallUserPower({ KIRO_FABRIC_SKIP_USER_POWER_INSTALL: "1" })).toBe(false);
  });
});
