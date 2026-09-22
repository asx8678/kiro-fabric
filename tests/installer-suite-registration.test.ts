import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { installerSuiteFiles, requireNativeInstallerShell, runInstallerTests } from "../scripts/test-installer.mjs";

describe("executable installer/native acceptance registry", () => {
  it("registers every orchestration seam and only existing unique tests", () => {
    const files = installerSuiteFiles();
    expect(new Set(files).size).toBe(files.length);
    for (const name of ["installer-configuration-backup", "installer-home", "installer-home-preparation", "installer-shell-integration", "installer-cli-contract", "install-manager-start", "install-manager-lifecycle", "launch-profile", "agent-launch-context", "managed-installation-lifecycle", "installer-directory-identity", "source-frontend-acceptance", "installer-smoke-acceptance", "qualification-failure-acceptance"]) expect(files).toContain(`tests/${name}.test.ts`);
    for (const file of files) expect(fs.existsSync(file), file).toBe(true);
    expect(installerSuiteFiles("contracts")).not.toContain("tests/installed-independence.test.ts");
    expect(installerSuiteFiles("bundle")).toContain("tests/installer-smoke-bundle-acceptance.test.ts");
    expect(installerSuiteFiles("bundle")).toContain("tests/fovea/historical-manager-migration.test.ts");
    expect(installerSuiteFiles("contracts")).not.toContain("tests/fovea/historical-manager-migration.test.ts");
  });
  it("lists the exact executable selection and forwards nonzero test exits", () => {
    const list = spawnSync(process.execPath, ["scripts/test-installer.mjs", "list", "contracts"], { encoding: "utf8", timeout: 10000 });
    expect(list.status, list.stderr).toBe(0); expect(list.stdout.trim().split("\n")).toEqual(installerSuiteFiles("contracts"));
    const run = vi.fn((_command: string, _argv: string[]) => ({ status: 19 }));
    expect(runInstallerTests(["run", "contracts"], { run })).toBe(19);
    expect(run.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["run", ...installerSuiteFiles("contracts")]));
    expect(() => installerSuiteFiles("typo")).toThrow();
    expect(() => runInstallerTests(["run", "contracts", "--passWithNoTests"], { run })).toThrow(/Usage/);
  });
  it("requires the real macOS zsh regression rather than permitting a missing-shell skip", () => {
    expect(() => requireNativeInstallerShell("darwin", () => false)).toThrow(/requires executable zsh/);
    expect(() => requireNativeInstallerShell("darwin", file => file === "/bin/zsh")).not.toThrow();
    expect(() => requireNativeInstallerShell("linux", () => false)).not.toThrow();
    const native = fs.readFileSync(new URL("./installer-native-zsh-acceptance.test.ts", import.meta.url), "utf8");
    expect(native).toContain('"-d", "-ic"');
  });
});
