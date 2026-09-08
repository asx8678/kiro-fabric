import { describe, expect, it } from "vitest";
import { detectInstallerPlatform, normalizeArchitecture, compareVersions } from "../scripts/installer-platform.mjs";
describe("installer platform identity", () => {
  it.each([["x86_64","x64"],["aarch64","arm64"],["x64","x64"],["arm64","arm64"]])("normalizes %s", (input, expected) => expect(normalizeArchitecture(input)).toBe(expected));
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
