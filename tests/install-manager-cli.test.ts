import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkKiro, managerErrorResult, parseManagerArguments, selectedHome, shellQuote } from "../scripts/install-manager.mjs";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe("installed manager command contract", () => {
  it("preserves commit truth and classifies structured failures without substring matches", () => {
    expect(managerErrorResult(Object.assign(new Error("EIO: fsync failed"), { committed: true, recoveryRequired: true }))).toMatchObject({ committed: true, exitCode: 7, outcome: "committed-cleanup-required" });
    expect(managerErrorResult(Object.assign(new Error("blocked"), { recoveryRequired: true }))).toMatchObject({ committed: false, exitCode: 7, outcome: "recovery-required" });
    for (const code of ["offline", "rate-limited", "no-release", "trust-root blocked"]) expect(managerErrorResult(Object.assign(new Error("production release blocked"), { code }))).toMatchObject({ committed: false, exitCode: 8, outcome: "discovery-unavailable" });
    expect(managerErrorResult(new Error("Production release trust root unavailable: distribution blocked"))).toMatchObject({ exitCode: 8 });
    expect(managerErrorResult(new Error("modified file /fixture/blocked"))).toMatchObject({ exitCode: 5 });
    expect(managerErrorResult(Object.assign(new Error("invalid signed content"), { code: "invalid-release" }))).toMatchObject({ exitCode: 5 });
    expect(managerErrorResult(Object.assign(new Error("busy"), { code: "INSTALL_LOCK_BUSY" }))).toMatchObject({ exitCode: 6 });
    expect(managerErrorResult(Object.assign(new Error("unsupported pristine startup"), { code: "INSTALL_LOCK_UNSUPPORTED" }))).toMatchObject({ exitCode: 4 });
    expect(managerErrorResult(Object.assign(new Error("unsupported stale-lock recovery"), { code: "INSTALL_LOCK_UNSUPPORTED", recoveryRequired: true }))).toMatchObject({ exitCode: 7, outcome: "recovery-required", dataPreserved: true });
  });
  it.each(["install", "update", "doctor", "rollback", "uninstall", "start"])("registers %s", command => expect(parseManagerArguments([command]).command).toBe(command));
  it.each([["doctor", "--yes"], ["doctor", "--from-archive", "/fixture"], ["update", "--purge-data"], ["update", "--from-archive", "/fixture", "--version", "1.0.0"], ["install", "--source"], ["doctor", "--json", "--json"], ["start", "--json"], ["install", "--version", "main"], ["doctor", "--kiro-home"], ["install", "update"]])("rejects invalid options %j", (...argv) => expect(() => parseManagerArguments(argv)).toThrow());
  it("accepts deliberate purge and signed offline selection without disabling trust", () => {
    expect(parseManagerArguments(["install", "--migrate-pi-fabric"]).migratePiFabric).toBe(true);
    for (const command of ["update", "doctor", "start", "uninstall"]) expect(() => parseManagerArguments([command, "--migrate-pi-fabric"])).toThrow();
    expect(parseManagerArguments(["uninstall", "--purge-data", "--yes", "--non-interactive", "--json"])).toMatchObject({ command: "uninstall", purgeData: true, yes: true, nonInteractive: true, json: true });
    expect(parseManagerArguments(["update", "--from-archive", "/a b/包.tar.gz", "--yes"])).toMatchObject({ archive: "/a b/包.tar.gz" });
    expect(() => parseManagerArguments(["install", "--disable-signature-verification"])).toThrow();
  });
  it.each(["none", "kiro-cli", "kiro-cli-chat"])("checks sibling subcommands with hard-link alias for %s without inheriting caller home or arbitrary environment", linked => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "manager-kiro-help-"))); roots.push(root); fs.chmodSync(root, 0o700);
    const bin = path.join(root, "client bin"); fs.mkdirSync(bin, { mode: 0o700 });
    fs.writeFileSync(path.join(bin, "kiro-cli"), '#!/bin/sh\nif [ "$1" = --version ]; then printf "kiro-cli 2.21.1\\n"; else exec kiro-cli-chat "$@"; fi\n', { mode: 0o700 });
    fs.writeFileSync(path.join(bin, "kiro-cli-chat"), '#!/bin/sh\n[ -z "${FORBIDDEN_HELP_ENV:-}" ] || exit 90\n[ "$KIRO_HOME" = "$HOME/.kiro" ] || exit 91\nprintf "%s\\n" --path\n', { mode: 0o700 });
    if (linked !== "none") {
      fs.linkSync(path.join(bin, linked), path.join(root, "client-alias"));
      expect(fs.statSync(path.join(bin, linked)).nlink).toBe(2);
    }
    expect(checkKiro({ PATH: bin, HOME: "/caller/home", KIRO_HOME: "/caller/kiro", FORBIDDEN_HELP_ENV: "must-not-leak" })).toMatchObject({ executable: path.join(bin, "kiro-cli"), version: "2.21.1", authentication: "NOT TESTED" });
  });
  it.each(["sibling", "hard-linked sibling", "directory"])("refuses unsafe Kiro %s before executing helper code", kind => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "manager-kiro-trust-"))); roots.push(root); fs.chmodSync(root, 0o700);
    const bin = path.join(root, "bin"), marker = path.join(root, "executed"); fs.mkdirSync(bin, { mode: 0o700 });
    fs.writeFileSync(path.join(bin, "kiro-cli"), '#!/bin/sh\nif [ "$1" = --version ]; then printf "kiro-cli 2.21.1\\n"; else exec kiro-cli-chat "$@"; fi\n', { mode: 0o700 });
    const sibling = path.join(bin, "kiro-cli-chat");
    fs.writeFileSync(sibling, `#!/bin/sh\nprintf executed > ${shellQuote(marker)}\nprintf '%s\\n' --path\n`, { mode: 0o700 });
    if (kind === "hard-linked sibling") fs.linkSync(sibling, path.join(root, "client-alias"));
    fs.chmodSync(kind === "directory" ? bin : sibling, 0o777);
    expect(() => checkKiro({ PATH: bin })).toThrow(/Unsafe/);
    if (kind !== "directory") {
      expect(() => checkKiro({ PATH: bin })).toThrow(sibling);
      expect(() => checkKiro({ PATH: bin })).toThrow(/group-writable.*world-writable/);
    }
    expect(fs.existsSync(marker)).toBe(false);
  });
  it("reports a broken sibling link before executing Kiro", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "manager-kiro-broken-"))); roots.push(root); fs.chmodSync(root, 0o700);
    const marker = path.join(root, "executed"), sibling = path.join(root, "kiro-cli-chat");
    fs.writeFileSync(path.join(root, "kiro-cli"), `#!/bin/sh\nprintf executed > ${shellQuote(marker)}\n`, { mode: 0o700 });
    fs.symlinkSync(path.join(root, "missing-helper"), sibling);
    expect(() => checkKiro({ PATH: root })).toThrow(sibling);
    expect(() => checkKiro({ PATH: root })).toThrow(/ENOENT/);
    expect(fs.existsSync(marker)).toBe(false);
  });
  it("anchors installed management despite changed caller KIRO_HOME", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "manager-home-"))); roots.push(root); fs.chmodSync(root, 0o700);
    const home = path.join(root, "kiro"), other = path.join(root, "other"); fs.mkdirSync(home, { mode: 0o700 });
    const context = { kind: "installed", kiroHome: home };
    expect(selectedHome({}, context, { KIRO_HOME: other }, root)).toEqual({ path: home, source: "installed launcher" });
    expect(() => selectedHome({ kiroHome: other }, context, {}, root)).toThrow(/another Kiro home/);
  });
  it("quotes shell commands without eval or losing apostrophes", () => {
    expect(shellQuote("/a b/it's 空間 %#")).toBe("'/a b/it'\\''s 空間 %#'");
  });
});
