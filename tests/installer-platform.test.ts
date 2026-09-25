import { describe, expect, it } from "vitest";
import { detectInstallerPlatform, compareVersions } from "../scripts/installer-platform.mjs";
describe("installer platform identity", () => {
  it.each(["4.18.0-553.el8.x86_64", "6.12.25+rpt-rpi-2712", "6.12.0+", "6.6.87.2-microsoft-standard-WSL2", "4.18+local"])("admits Linux LOCALVERSION %s without losing its diagnostic identity", osVersion => {
    for (const arch of ["x64", "arm64"]) expect(detectInstallerPlatform({ platform: "linux", arch, glibc: "2.28", osVersion })).toMatchObject({ target: `linux-${arch}`, osVersion });
  });
  it.each(["4.17.99+local", "3.10.0-1160.el7.x86_64"])("does not let a suffix bypass the kernel floor: %s", osVersion => {
    expect(() => detectInstallerPlatform({ platform: "linux", arch: "arm64", glibc: "2.36", osVersion })).toThrow(/kernel >=4.18/);
  });
  it.each(["", "6", "6.12.", "6.12..0", "6.12abc", "6.12.0 vendor"])("rejects malformed kernel evidence %s", osVersion => {
    expect(() => detectInstallerPlatform({ platform: "linux", arch: "arm64", glibc: "2.36", osVersion })).toThrow(/kernel version/);
  });
  it("does not relax the general version comparator for kernel suffixes", () => {
    expect(() => compareVersions("24.20.0+vendor", "24.0.0")).toThrow(/Unsupported/);
  });
  it.each([["x86_64","x64"],["aarch64","arm64"],["x64","x64"],["arm64","arm64"]])("normalizes %s through public detection", (input, expected) => expect(detectInstallerPlatform({ platform: "linux", arch: input, glibc: "2.39", osVersion: "6.8.0" }).target).toBe(`linux-${expected}`));
  it.each(["x64","arm64"])("detects Linux %s and rejects musl", arch => {
    expect(detectInstallerPlatform({ platform: "linux", arch, glibc: "2.39", osVersion: "6.8.0" }).target).toBe(`linux-${arch}`);
    expect(() => detectInstallerPlatform({ platform: "linux", arch, glibc: null, osVersion: "6.8.0" })).toThrow(/musl/);
    expect(() => detectInstallerPlatform({ platform: "linux", arch, glibc: "2.27", osVersion: "6.8.0" })).toThrow(/2.28/);
  });
  it.each(["x64","arm64"])("detects Darwin %s", arch => {
    expect(detectInstallerPlatform({ platform: "darwin", arch, rosetta: false, osVersion: "14.0" }).target).toBe(`darwin-${arch}`);
  });
  it("selects native Apple Silicon under Rosetta and rejects unsupported systems", () => {
    expect(detectInstallerPlatform({ platform: "darwin", arch: "x64", rosetta: true, osVersion: "14.0" })).toMatchObject({ target: "darwin-arm64", rosetta: true, processArch: "x64" });
    expect(() => detectInstallerPlatform({ platform: "win32", arch: "x64" })).toThrow(/Unsupported/);
    expect(() => detectInstallerPlatform({ platform: "linux", arch: "ia32" })).toThrow(/Unsupported/);
    expect(() => detectInstallerPlatform({ platform: "darwin", arch: "arm64", osVersion: "13.4", rosetta: false })).toThrow(/13.5/);
    expect(compareVersions("24.20.0", "24.9.0")).toBe(1);
  });
});
