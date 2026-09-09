import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  createConfigurationBackup,
  listConfigurationBackups,
  restoreConfigurationBackup,
} from "../scripts/installer-configuration-backup.mjs";

const backupOf = (kiroHome: string, command: string): NonNullable<ReturnType<typeof createConfigurationBackup>> => {
  const backup = createConfigurationBackup(kiroHome, { command });
  if (!backup) throw new Error("expected a configuration backup");
  return backup;
};

const roots: string[] = [];
const temporary = (): string => {
  const lexical = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-config-backup-"));
  const root = fs.realpathSync(lexical);
  fs.chmodSync(root, 0o700);
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const seedConfiguration = (kiroHome: string): void => {
  fs.mkdirSync(path.join(kiroHome, "settings"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(kiroHome, "settings", "global.json"), '{"theme":"dark"}\n', { mode: 0o600 });
  fs.mkdirSync(path.join(kiroHome, "agents"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(kiroHome, "agents", "foreign.json"), "{}\n", { mode: 0o600 });
  // Managed control: backed up for evidence but never rewritten by restore.
  fs.writeFileSync(path.join(kiroHome, "agents", "kiro-fabric.json"), "{}\n", { mode: 0o600 });
  fs.writeFileSync(path.join(kiroHome, "executable.sh"), "#!/bin/sh\n", { mode: 0o700 });
  fs.symlinkSync("settings/global.json", path.join(kiroHome, "current-settings"));
  // Managed tree must be excluded from the configuration backup.
  fs.mkdirSync(path.join(kiroHome, "kiro-fabric", "runtime"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(kiroHome, "kiro-fabric", "runtime", "payload"), "managed", { mode: 0o600 });
};

const treeDigest = (root: string, skipManaged = false): string => {
  const digest = createHash("sha256");
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (skipManaged && directory === root && entry.name === "kiro-fabric") continue;
      const target = path.join(directory, entry.name);
      digest.update(path.relative(root, target)).update("\0");
      if (entry.isDirectory()) visit(target);
      else if (entry.isSymbolicLink()) digest.update(fs.readlinkSync(target));
      else digest.update(fs.readFileSync(target));
    }
  };
  if (fs.existsSync(root)) visit(root);
  return digest.digest("hex");
};

describe("configuration backup", () => {
  it("captures configuration, excludes the managed tree, and preserves modes and symlinks", () => {
    const kiroHome = temporary();
    seedConfiguration(kiroHome);
    const before = treeDigest(kiroHome, true);
    const backup = backupOf(kiroHome, "install");
    expect(backup.files).toBe(4);
    expect(backup.symlinks).toBe(1);
    expect(backup.path.startsWith(path.join(kiroHome, "kiro-fabric", "backups"))).toBe(true);
    expect((fs.statSync(path.join(kiroHome, "kiro-fabric", "backups")).mode & 0o777)).toBe(0o700);
    const manifest = JSON.parse(fs.readFileSync(path.join(backup.path, "backup-manifest.json"), "utf8"));
    expect(manifest.command).toBe("install");
    expect(manifest.excludes).toEqual(["kiro-fabric", "agents/kiro-fabric.json"]);
    expect(manifest.files.map((file: { path: string }) => file.path).sort()).toEqual(["agents/foreign.json", "agents/kiro-fabric.json", "executable.sh", "settings/global.json"]);
    expect(fs.existsSync(path.join(backup.path, "kiro-fabric"))).toBe(false);
    expect((fs.statSync(path.join(backup.path, "executable.sh")).mode & 0o777) & 0o100).toBe(0o100);
    expect(fs.readlinkSync(path.join(backup.path, "current-settings"))).toBe("settings/global.json");
    expect(treeDigest(kiroHome, true)).toBe(before);
  });

  it("restores a verified backup only onto a non-overlapping destination", () => {
    const kiroHome = temporary();
    seedConfiguration(kiroHome);
    const backup = backupOf(kiroHome, "install");
    const destination = temporary();
    fs.mkdirSync(path.join(destination, "kiro-fabric"), { mode: 0o700 });
    const restored = restoreConfigurationBackup(backup.path, destination);
    expect(restored.restored).toBe(3);
    expect(restored.managedSkipped).toEqual(["agents/kiro-fabric.json"]);
    expect(fs.existsSync(path.join(destination, "agents", "kiro-fabric.json"))).toBe(false);
    expect(fs.readFileSync(path.join(destination, "settings", "global.json"), "utf8")).toBe('{"theme":"dark"}\n');
    expect(fs.readlinkSync(path.join(destination, "current-settings"))).toBe("settings/global.json");
    // Refuses to overwrite an existing configuration.
    const occupied = temporary();
    fs.mkdirSync(path.join(occupied, "kiro-fabric"), { mode: 0o700 });
    fs.writeFileSync(path.join(occupied, "executable.sh"), "x", { mode: 0o600 });
    expect(() => restoreConfigurationBackup(backup.path, occupied)).toThrow(/already exists/);
    expect(fs.readFileSync(path.join(occupied, "executable.sh"), "utf8")).toBe("x");
    // Refuses a modified backup.
    fs.chmodSync(path.join(backup.path, "settings", "global.json"), 0o600);
    fs.writeFileSync(path.join(backup.path, "settings", "global.json"), "tampered\n");
    const clean = temporary();
    fs.mkdirSync(path.join(clean, "kiro-fabric"), { mode: 0o700 });
    expect(() => restoreConfigurationBackup(backup.path, clean)).toThrow(/modified backup/);
    expect(fs.existsSync(path.join(clean, "settings"))).toBe(false);
  });

  it("fails closed on oversized files and foreign link components without partial backups", () => {
    const oversized = temporary();
    fs.writeFileSync(path.join(oversized, "big.bin"), Buffer.alloc(65 * 1024 * 1024, 1), { mode: 0o600 });
    expect(() => createConfigurationBackup(oversized, { command: "install" })).toThrow(/exceeds backup bound/);
    expect(fs.existsSync(path.join(oversized, "kiro-fabric", "backups"))).toBe(false);
    const outside = temporary();
    const target = path.join(outside, "secret.txt");
    fs.writeFileSync(target, "secret", { mode: 0o600 });
    const kiroHome = temporary();
    fs.symlinkSync(target, path.join(kiroHome, "leak"));
    const backup = backupOf(kiroHome, "install");
    // Symlinks are recreated verbatim, never followed, so no secret is copied.
    expect(fs.readlinkSync(path.join(backup.path, "leak"))).toBe(target);
    expect(fs.existsSync(path.join(backup.path, "leak")) && fs.lstatSync(path.join(backup.path, "leak")).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(path.join(backup.path, "leak")).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(path.join(backup.path, "leak")).isFile()).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("secret");
  });

  it("retains a bounded number of backups", () => {
    const kiroHome = temporary();
    fs.writeFileSync(path.join(kiroHome, "settings.txt"), "x", { mode: 0o600 });
    for (let index = 0; index < 25; index += 1) backupOf(kiroHome, "install");
    const listed = listConfigurationBackups(kiroHome);
    expect(listed.length).toBeLessThanOrEqual(20);
    expect(fs.readdirSync(path.join(kiroHome, "kiro-fabric", "backups")).length).toBeLessThanOrEqual(20);
  });

  it("records non-regular entries as skipped instead of failing the mutation", async () => {
    const kiroHome = temporary();
    seedConfiguration(kiroHome);
    // A stale daemon socket anywhere in the home must not brick installation.
    const socketPath = path.join(kiroHome, "daemon.sock");
    const server = net.createServer();
    await new Promise<void>(resolve => server.listen(socketPath, resolve));
    try {
      const backup = backupOf(kiroHome, "install");
      if (!backup) throw new Error("expected backup");
      expect(backup.skipped).toBe(1);
      const manifest = JSON.parse(fs.readFileSync(path.join(backup.path, "backup-manifest.json"), "utf8"));
      expect(manifest.skipped).toEqual([{ path: "daemon.sock", reason: "non-regular" }]);
    } finally {
      server.close();
      fs.rmSync(socketPath, { force: true });
    }
  });

  it("preserves original file modes on restore", () => {
    const kiroHome = temporary();
    seedConfiguration(kiroHome);
    const backup = backupOf(kiroHome, "install");
    if (!backup) throw new Error("expected backup");
    const destination = temporary();
    fs.mkdirSync(path.join(destination, "kiro-fabric"), { mode: 0o700 });
    restoreConfigurationBackup(backup.path, destination);
    expect(fs.statSync(path.join(destination, "settings", "global.json")).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(destination, "executable.sh")).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(destination, "settings")).mode & 0o777).toBe(0o700);
  });

  it("exposes list and restore through the module CLI", () => {
    const kiroHome = temporary();
    seedConfiguration(kiroHome);
    const backup = backupOf(kiroHome, "uninstall");
    const module = path.resolve("scripts/installer-configuration-backup.mjs");
    const listed = execFileSync(process.execPath, [module, "list", kiroHome], { encoding: "utf8" }).trim().split("\n").map(line => JSON.parse(line));
    if (!backup) throw new Error("expected backup");
    expect(listed.at(-1)?.name).toBe(path.basename(backup.path));
    const destination = temporary();
    fs.mkdirSync(path.join(destination, "kiro-fabric"), { mode: 0o700 });
    const output = execFileSync(process.execPath, [module, "restore", backup.path, destination], { encoding: "utf8" });
    expect(output).toContain("Restored 3 files");
  });
});
