import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess, { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createConfigurationBackup,
  listConfigurationBackups,
  restoreConfigurationBackup,
} from "../scripts/installer-configuration-backup.mjs";

const backupOf = (kiroHome: string, command: string, sourceRoot?: string): NonNullable<ReturnType<typeof createConfigurationBackup>> => {
  const backup = createConfigurationBackup(kiroHome, { command, sourceRoot });
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
  vi.restoreAllMocks();
  // Preserve every backup/repository fixture, including early failures.
  for (const root of roots.splice(0)) console.warn(`[configuration backup fixture] retained ${root}`);
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

type PinnedCall = { executable: string; args: string[]; options: SpawnSyncOptionsWithStringEncoding & { input: Buffer; cwd: string } };
const nativePinnedSpawn = childProcess.spawnSync;
const pinnedRequest = (call: PinnedCall): Record<string, unknown> => JSON.parse(call.options.input.subarray(4, 4 + call.options.input.readUInt32BE()).toString());
const injectPinned = (call: PinnedCall, source: string): void => { call.args[2] = source + "\n" + call.args[2]; };
const forcePinnedChildren = (): void => {
  const original = fs.statSync;
  vi.spyOn(fs, "statSync").mockImplementation(((...args: Parameters<typeof fs.statSync>) => {
    if (String(args[0]).startsWith("/proc/self/fd/") && String(args[0]).endsWith("/.")) throw Object.assign(new Error("fixture: use fd3 child"), { code: "ENOTDIR" });
    return original(...args);
  }) as typeof fs.statSync);
};
const interceptPinnedChildren = (action: (call: PinnedCall) => void): void => {
  vi.spyOn(childProcess, "spawnSync").mockImplementation(((executable, args, options) => {
    const call = { executable, args: [...(args ?? [])], options: { ...options } } as PinnedCall;
    action(call);
    return nativePinnedSpawn(call.executable, call.args, call.options) as SpawnSyncReturns<string>;
  }) as typeof childProcess.spawnSync);
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
    expect(manifest.sourceRoot).toBeNull();
    expect(backup.sourceRoot).toBeNull();
    expect(manifest.excludes).toEqual(["kiro-fabric", "agents/kiro-fabric.json"]);
    expect(backup.excludes).toEqual(manifest.excludes);
    expect(manifest.files.map((file: { path: string }) => file.path).sort()).toEqual(["agents/foreign.json", "agents/kiro-fabric.json", "executable.sh", "settings/global.json"]);
    expect(fs.existsSync(path.join(backup.path, "kiro-fabric"))).toBe(false);
    expect((fs.statSync(path.join(backup.path, "executable.sh")).mode & 0o777) & 0o100).toBe(0o100);
    expect(fs.readlinkSync(path.join(backup.path, "current-settings"))).toBe("settings/global.json");
    expect(treeDigest(kiroHome, true)).toBe(before);
  });

  it("keeps a missing first-install home untouched and returns null", () => {
    const parent = temporary(), sourceRoot = temporary(), kiroHome = path.join(parent, "new-home");
    expect(createConfigurationBackup(kiroHome, { command: "install" })).toBeNull();
    expect(createConfigurationBackup(kiroHome, { command: "install", sourceRoot })).toBeNull();
    expect(fs.readdirSync(parent)).toEqual([]);
    expect(fs.readdirSync(sourceRoot)).toEqual([]);
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

  it.each(["missing file", "missing link", "missing directory", "extra file", "extra directory", "extra link", "omitted parent", "duplicate", "cross-type duplicate", "wrong type", "bad array", "bad size", "bad mode", "bad target", "alias", "managed tree", "skipped parent", "entry bound", "depth bound", "manifest bound"])("rejects malformed restore inventory before effects: %s", kind => {
    const home = temporary(), destination = temporary();
    seedConfiguration(home);
    fs.mkdirSync(path.join(home, "empty"), { mode: 0o700 });
    const backup = backupOf(home, "install"), manifestPath = path.join(backup.path, "backup-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    fs.mkdirSync(path.join(destination, "kiro-fabric"), { mode: 0o700 });
    if (kind === "missing file") fs.renameSync(path.join(backup.path, "executable.sh"), path.join(temporary(), "retained-entry"));
    if (kind === "missing link") fs.renameSync(path.join(backup.path, "current-settings"), path.join(temporary(), "retained-entry"));
    if (kind === "missing directory") fs.renameSync(path.join(backup.path, "empty"), path.join(temporary(), "retained-entry"));
    if (kind === "extra file") fs.writeFileSync(path.join(backup.path, "extra"), "x", { mode: 0o600 });
    if (kind === "extra directory") fs.mkdirSync(path.join(backup.path, "extra"), { mode: 0o700 });
    if (kind === "extra link") fs.symlinkSync("missing", path.join(backup.path, "extra"));
    if (kind === "omitted parent") manifest.directories = manifest.directories.filter((entry: { path: string }) => entry.path !== "settings");
    if (kind === "duplicate") manifest.files.push(manifest.files[0]);
    if (kind === "cross-type duplicate") manifest.symlinks.push({ path: manifest.files[0].path, target: "x" });
    if (kind === "wrong type") { fs.renameSync(path.join(backup.path, "current-settings"), path.join(temporary(), "retained-entry")); fs.mkdirSync(path.join(backup.path, "current-settings"), { mode: 0o700 }); }
    if (kind === "bad array") manifest.files = {};
    if (kind === "bad size") manifest.files[0].size = -1;
    if (kind === "bad mode") manifest.directories[0].mode = "700";
    if (kind === "bad target") manifest.symlinks[0].target = null;
    if (kind === "alias") manifest.files[0].path = "settings/../executable.sh";
    if (kind === "managed tree") manifest.directories.push({ path: "kiro-fabric", mode: 0o700 });
    if (kind === "skipped parent") manifest.skipped.push({ path: "absent/skip", reason: "hardlinked" });
    if (kind === "entry bound") manifest.symlinks = Array.from({ length: 20001 }, (_, i) => ({ path: `link-${i}`, target: "x" }));
    if (kind === "depth bound") manifest.symlinks.push({ path: Array(35).fill("deep").join("/"), target: "x" });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    if (kind === "manifest bound") fs.truncateSync(manifestPath, 4 * 1024 * 1024 + 1);
    expect(listConfigurationBackups(home)).toEqual([]);
    const before = treeDigest(destination);
    const mkdir = vi.spyOn(fs, "mkdirSync"), chmod = vi.spyOn(fs, "chmodSync"), write = vi.spyOn(fs, "writeFileSync"), link = vi.spyOn(fs, "symlinkSync");
    expect(() => restoreConfigurationBackup(backup.path, destination)).toThrow();
    expect(mkdir).not.toHaveBeenCalled(); expect(chmod).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled();
    expect(treeDigest(destination)).toBe(before);
  });

  it.each([false, true])("rejects outward destination parent before any effects (synthetic=%s)", synthetic => {
    const home = temporary(), destination = temporary(), outside = temporary();
    fs.mkdirSync(path.join(home, "pivot"), { mode: 0o700 });
    fs.mkdirSync(path.join(home, "aaa-first"), { mode: 0o700 });
    fs.symlinkSync("synthetic-target", path.join(home, "pivot/restored-link"));
    const backup = backupOf(home, "install");
    if (synthetic) {
      fs.writeFileSync(path.join(backup.path, "backup-manifest.json"), JSON.stringify({ schemaVersion: 1, files: [], directories: [], symlinks: [{ path: "pivot/restored-link", target: "synthetic-target" }] }));
      fs.renameSync(path.join(backup.path, "pivot/restored-link"), path.join(temporary(), "retained-entry"));
      fs.renameSync(path.join(backup.path, "pivot"), path.join(temporary(), "retained-entry"));
    }
    fs.mkdirSync(path.join(destination, "kiro-fabric"), { mode: 0o700 });
    fs.symlinkSync(outside, path.join(destination, "pivot"));
    const before = treeDigest(destination), external = treeDigest(outside);
    const mkdir = vi.spyOn(fs, "mkdirSync"), link = vi.spyOn(fs, "symlinkSync");
    expect(() => restoreConfigurationBackup(backup.path, destination)).toThrow();
    expect(mkdir).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled();
    expect(treeDigest(destination)).toBe(before); expect(treeDigest(outside)).toBe(external);
    expect(fs.lstatSync(path.join(destination, "pivot")).isSymbolicLink()).toBe(true);
  });

  it.each(["file parent", "link parent", "skipped present", "manifest symlink", "manifest hardlink", "oversized file", "destination collision"])("fails closed on restore evidence or destination hazard: %s", kind => {
    const home = temporary(), destination = temporary(), outside = temporary();
    seedConfiguration(home);
    const backup = backupOf(home, "install"), manifestPath = path.join(backup.path, "backup-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (kind === "file parent" || kind === "link parent") manifest.symlinks.push({ path: `${kind === "file parent" ? "executable.sh" : "current-settings"}/child`, target: "x" });
    if (kind === "skipped present") { manifest.skipped.push({ path: "skip", reason: "hardlinked" }); fs.writeFileSync(path.join(backup.path, "skip"), "x", { mode: 0o600 }); }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    if (kind === "manifest symlink") { fs.renameSync(manifestPath, path.join(outside, "manifest")); fs.symlinkSync(path.join(outside, "manifest"), manifestPath); }
    if (kind === "manifest hardlink") fs.linkSync(manifestPath, path.join(outside, "manifest"));
    if (kind === "oversized file") { const file = path.join(backup.path, "executable.sh"); fs.chmodSync(file, 0o600); fs.truncateSync(file, 65 * 1024 * 1024); }
    fs.mkdirSync(path.join(destination, "kiro-fabric"), { mode: 0o700 });
    if (kind === "destination collision") fs.writeFileSync(path.join(destination, "executable.sh"), "keep", { mode: 0o600 });
    const before = treeDigest(destination), external = treeDigest(outside);
    const mkdir = vi.spyOn(fs, "mkdirSync"), chmod = vi.spyOn(fs, "chmodSync"), write = vi.spyOn(fs, "writeFileSync"), link = vi.spyOn(fs, "symlinkSync");
    expect(() => restoreConfigurationBackup(backup.path, destination)).toThrow();
    expect(mkdir).not.toHaveBeenCalled(); expect(chmod).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled();
    expect(treeDigest(destination)).toBe(before); expect(treeDigest(outside)).toBe(external);
  });

  it("restores intact legacy v1 metadata with unordered parents, empty directories and verbatim outward links", () => {
    const home = temporary(), destination = temporary(), outside = temporary();
    seedConfiguration(home);
    fs.mkdirSync(path.join(home, "nested/empty"), { recursive: true, mode: 0o700 });
    fs.symlinkSync(outside, path.join(home, "outward"));
    const backup = backupOf(home, "install"), manifestPath = path.join(backup.path, "backup-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    delete manifest.sourceRoot;
    manifest.directories.reverse();
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(listConfigurationBackups(home)).toMatchObject([{ name: path.basename(backup.path), complete: true }]);
    fs.mkdirSync(path.join(destination, "kiro-fabric"), { mode: 0o700 });
    expect(restoreConfigurationBackup(backup.path, destination)).toMatchObject({ restored: 3, symlinks: 2 });
    expect(fs.readdirSync(path.join(destination, "nested/empty"))).toEqual([]);
    expect(fs.readlinkSync(path.join(destination, "outward"))).toBe(outside);
    expect(fs.readdirSync(outside)).toEqual([]);
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

  it("backs up a checkout-home with a realistic sparse Node artifact only after explicit source opt-in", () => {
    const kiroHome = temporary();
    seedConfiguration(kiroHome);
    const artifacts = [".git", ".tmp", "dist", "node_modules"];
    for (const directory of artifacts) fs.mkdirSync(path.join(kiroHome, directory), { mode: 0o700 });
    const node = path.join(kiroHome, ".tmp", `private-tools-${"a".repeat(64)}`, "tools", "node");
    fs.mkdirSync(path.dirname(node), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(node, "wx", 0o700);
    try { fs.ftruncateSync(fd, Math.ceil(120.6 * 1024 * 1024)); } finally { fs.closeSync(fd); }
    const nodeBefore = fs.lstatSync(node);
    expect(nodeBefore.size).toBeGreaterThan(64 * 1024 * 1024);
    expect(nodeBefore.blocks * 512).toBeLessThan(nodeBefore.size);
    for (const directory of artifacts) fs.writeFileSync(path.join(kiroHome, directory, "artifact"), "source/build data", { mode: 0o600 });
    // Names are not a generic ignore list: nested artifacts and arbitrary
    // configuration (including dotfiles and source inputs) must be preserved.
    const userFiles = ["preferences.json", ".gitignore", "package.json", "custom/user.txt", ...artifacts.map(name => `projects/${name}/user.json`)];
    for (const relative of userFiles) {
      const file = path.join(kiroHome, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, `configuration: ${relative}\n`, { mode: 0o600 });
    }
    const backup = backupOf(kiroHome, "install", kiroHome);
    const raw = fs.readFileSync(path.join(backup.path, "backup-manifest.json"));
    const manifest = JSON.parse(raw.toString());
    expect(manifest.sourceRoot).toBe(kiroHome);
    expect(backup.sourceRoot).toBe(kiroHome);
    expect(manifest.excludes).toEqual(["kiro-fabric", "agents/kiro-fabric.json", ...artifacts]);
    expect(backup.excludes).toEqual(manifest.excludes);
    expect(backup.manifestSha256).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(backup.files).toBe(4 + userFiles.length);
    for (const directory of artifacts) expect(fs.existsSync(path.join(backup.path, directory))).toBe(false);
    expect(fs.lstatSync(node)).toMatchObject({ ino: nodeBefore.ino, size: nodeBefore.size, mode: nodeBefore.mode, nlink: 1, mtimeMs: nodeBefore.mtimeMs });
    const destination = temporary();
    fs.mkdirSync(path.join(destination, "kiro-fabric"), { mode: 0o700 });
    const restored = restoreConfigurationBackup(backup.path, destination);
    expect(restored.restored).toBe(3 + userFiles.length);
    expect(restored.managedSkipped).toEqual(["agents/kiro-fabric.json"]);
    for (const relative of ["settings/global.json", "agents/foreign.json", ...userFiles]) {
      const original = fs.readFileSync(path.join(kiroHome, relative));
      expect(fs.readFileSync(path.join(backup.path, relative))).toEqual(original);
      expect(fs.readFileSync(path.join(destination, relative))).toEqual(original);
      const record = manifest.files.find((file: { path: string }) => file.path === relative);
      expect(record.sha256).toBe(createHash("sha256").update(original).digest("hex"));
    }
  });

  it.each(["implicit", "disjoint"])("does not infer source exclusions for an ordinary home (%s source root)", kind => {
    const kiroHome = temporary();
    seedConfiguration(kiroHome);
    fs.mkdirSync(path.join(kiroHome, ".git"), { mode: 0o700 });
    fs.writeFileSync(path.join(kiroHome, "package.json"), '{"name":"kiro-fabric"}', { mode: 0o600 });
    const artifact = path.join(kiroHome, ".tmp", "tools", "node");
    fs.mkdirSync(path.dirname(artifact), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(artifact, "wx", 0o600);
    try { fs.ftruncateSync(fd, Math.ceil(120.6 * 1024 * 1024)); } finally { fs.closeSync(fd); }
    const sourceRoot = kind === "disjoint" ? temporary() : undefined;
    expect(() => createConfigurationBackup(kiroHome, { command: "install", sourceRoot })).toThrow(/exceeds backup bound: .tmp\/tools\/node/);
    expect(fs.existsSync(path.join(kiroHome, "kiro-fabric", "backups"))).toBe(false);
    expect(fs.readFileSync(path.join(kiroHome, "settings/global.json"), "utf8")).toBe('{"theme":"dark"}\n');
    expect(fs.lstatSync(artifact).size).toBeGreaterThan(64 * 1024 * 1024);
  });

  it.each(["user-export.bin", ".tmp"])("does not exclude oversized user file %s even in an explicit checkout-home", name => {
    const kiroHome = temporary();
    const file = path.join(kiroHome, name);
    const fd = fs.openSync(file, "wx", 0o600);
    try { fs.ftruncateSync(fd, 65 * 1024 * 1024); } finally { fs.closeSync(fd); }
    expect(() => createConfigurationBackup(kiroHome, { command: "install", sourceRoot: kiroHome })).toThrow(`configuration file exceeds backup bound: ${name}`);
    expect(fs.existsSync(path.join(kiroHome, "kiro-fabric"))).toBe(false);
    expect(fs.lstatSync(file).size).toBe(65 * 1024 * 1024);
  });

  it("preserves ordinary-home artifact names and source-home same-named files and symlinks", () => {
    const kiroHome = temporary(), unrelatedSource = temporary(), outside = temporary();
    for (const name of [".git", ".tmp", "dist", "node_modules"]) {
      fs.mkdirSync(path.join(kiroHome, name), { mode: 0o700 });
      fs.writeFileSync(path.join(kiroHome, name, "user.json"), name, { mode: 0o600 });
    }
    const ordinary = backupOf(kiroHome, "install", unrelatedSource);
    expect(ordinary.excludes).toEqual(["kiro-fabric", "agents/kiro-fabric.json"]);
    for (const name of [".git", ".tmp", "dist", "node_modules"]) expect(fs.readFileSync(path.join(ordinary.path, name, "user.json"), "utf8")).toBe(name);
    const sourceHome = temporary();
    for (const name of [".git", ".tmp", "dist"]) fs.writeFileSync(path.join(sourceHome, name), `user configuration ${name}`, { mode: 0o600 });
    fs.symlinkSync(outside, path.join(sourceHome, "node_modules"));
    const explicit = backupOf(sourceHome, "install", sourceHome);
    expect(explicit.excludes).toEqual(["kiro-fabric", "agents/kiro-fabric.json"]);
    for (const name of [".git", ".tmp", "dist"]) expect(fs.readFileSync(path.join(explicit.path, name), "utf8")).toBe(`user configuration ${name}`);
    expect(fs.readlinkSync(path.join(explicit.path, "node_modules"))).toBe(outside);
  });

  it("rejects invalid, aliased, noncanonical and overlapping source roots before creating a backup", () => {
    const parent = temporary(), kiroHome = path.join(parent, "home"), sibling = path.join(parent, "source");
    fs.mkdirSync(kiroHome, { mode: 0o700 });
    fs.mkdirSync(sibling, { mode: 0o700 });
    seedConfiguration(kiroHome);
    fs.symlinkSync(kiroHome, path.join(parent, "alias"));
    fs.symlinkSync(parent, path.join(parent, "parent-alias"));
    const invalid = ["", "relative", path.join(parent, "missing"), path.join(kiroHome, "settings/global.json"), path.join(parent, "alias"), path.join(parent, "parent-alias", "home"), `${kiroHome}/settings/..`, path.join(kiroHome, "settings"), parent];
    for (const sourceRoot of invalid) {
      expect(() => createConfigurationBackup(kiroHome, { command: "install", sourceRoot }), sourceRoot).toThrow();
      expect(fs.existsSync(path.join(kiroHome, "kiro-fabric", "backups"))).toBe(false);
    }
    expect(() => createConfigurationBackup(path.join(parent, "alias"), { command: "install", sourceRoot: kiroHome })).toThrow(/symlink|canonical|unsafe directory/);
    expect(fs.readFileSync(path.join(kiroHome, "agents/foreign.json"), "utf8")).toBe("{}\n");
  });

  it("skips safe ordinary hardlinks without reading or modifying them, while preserving normal user files", () => {
    const kiroHome = temporary(), outside = temporary();
    seedConfiguration(kiroHome);
    const first = path.join(kiroHome, "linked-config.json"), second = path.join(kiroHome, "other-config.json");
    fs.writeFileSync(first, "shared user content", { mode: 0o600 });
    fs.linkSync(first, second);
    fs.linkSync(first, path.join(outside, "external-link"));
    const before = fs.lstatSync(first);
    const opened = vi.spyOn(fs, "openSync");
    const backup = backupOf(kiroHome, "install");
    expect(opened.mock.calls.some(([file]) => file === first || file === second)).toBe(false);
    const manifest = JSON.parse(fs.readFileSync(path.join(backup.path, "backup-manifest.json"), "utf8"));
    expect(backup.skipped).toBe(2);
    expect(manifest.skipped).toEqual([{ path: "linked-config.json", reason: "hardlinked" }, { path: "other-config.json", reason: "hardlinked" }]);
    expect(fs.existsSync(path.join(backup.path, "linked-config.json"))).toBe(false);
    expect(fs.existsSync(path.join(backup.path, "other-config.json"))).toBe(false);
    expect(fs.readFileSync(path.join(backup.path, "settings/global.json"), "utf8")).toBe('{"theme":"dark"}\n');
    expect(fs.readFileSync(path.join(backup.path, "agents/foreign.json"), "utf8")).toBe("{}\n");
    expect(fs.lstatSync(first)).toMatchObject({ ino: before.ino, nlink: 3, mode: before.mode, mtimeMs: before.mtimeMs });
    expect(fs.readFileSync(path.join(outside, "external-link"), "utf8")).toBe("shared user content");
  });

  it.each([false, true])("refuses hardlinked managed controls (source-home=%s)", source => {
    const kiroHome = temporary(), outside = temporary();
    seedConfiguration(kiroHome);
    const control = path.join(kiroHome, "agents/kiro-fabric.json");
    fs.linkSync(control, path.join(outside, "control-link"));
    expect(() => createConfigurationBackup(kiroHome, { command: "install", sourceRoot: source ? kiroHome : undefined })).toThrow(/unsafe configuration file agents\/kiro-fabric.json/);
    expect(fs.existsSync(path.join(kiroHome, "kiro-fabric", "backups"))).toBe(false);
    expect(fs.lstatSync(control).nlink).toBe(2);
    expect(fs.readFileSync(path.join(outside, "control-link"), "utf8")).toBe("{}\n");
  });

  it.each([0o620, 0o602])("refuses unsafe ordinary hardlinks with writable mode %s", mode => {
    const kiroHome = temporary(), outside = temporary();
    const file = path.join(kiroHome, "user.json");
    fs.writeFileSync(file, "unsafe shared content", { mode: 0o600 });
    fs.linkSync(file, path.join(outside, "alias"));
    fs.chmodSync(file, mode);
    expect(() => createConfigurationBackup(kiroHome, { command: "install" })).toThrow(/unsafe configuration file user.json/);
    expect(fs.existsSync(path.join(kiroHome, "kiro-fabric"))).toBe(false);
    expect(fs.lstatSync(file).mode & 0o777).toBe(mode);
    expect(fs.lstatSync(file).nlink).toBe(2);
  });

  it("does not classify a foreign-owned ordinary hardlink as safe", () => {
    const kiroHome = temporary(), outside = temporary();
    const file = path.join(kiroHome, "foreign.json");
    fs.writeFileSync(file, "foreign content", { mode: 0o600 });
    fs.linkSync(file, path.join(outside, "alias"));
    const original = fs.lstatSync;
    // Ownership cannot be changed by an unprivileged fixture. All path/link
    // operations are real; only this inode's observed uid is fault-injected.
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
      const stats = original(...args);
      if (stats && args[0] === file) Reflect.set(stats, "uid", Number(stats.uid) + 1);
      return stats;
    }) as typeof fs.lstatSync);
    expect(() => createConfigurationBackup(kiroHome, { command: "install" })).toThrow(/unsafe configuration file foreign.json|not owned/);
    expect(fs.existsSync(path.join(kiroHome, "kiro-fabric"))).toBe(false);
  });

  it.each(["symlink", "directory"])("refuses a managed control with unsafe type %s", kind => {
    const kiroHome = temporary(), outside = temporary();
    seedConfiguration(kiroHome);
    const control = path.join(kiroHome, "agents/kiro-fabric.json");
    fs.renameSync(control, path.join(temporary(), "retained-entry"));
    if (kind === "symlink") fs.symlinkSync(outside, control);
    else fs.mkdirSync(control, { mode: 0o700 });
    expect(() => createConfigurationBackup(kiroHome, { command: "install" })).toThrow(/unsafe configuration file agents\/kiro-fabric.json/);
    expect(fs.existsSync(path.join(kiroHome, "kiro-fabric", "backups"))).toBe(false);
  });

  it.each(["managed", "backups"])("refuses a symlinked %s backup destination component without touching foreign evidence", kind => {
    const kiroHome = temporary(), outside = temporary();
    fs.writeFileSync(path.join(outside, "foreign-evidence"), "preserve", { mode: 0o600 });
    fs.mkdirSync(path.join(outside, "backups"), { mode: 0o700 });
    if (kind === "managed") fs.symlinkSync(outside, path.join(kiroHome, "kiro-fabric"));
    else {
      fs.mkdirSync(path.join(kiroHome, "kiro-fabric"), { mode: 0o700 });
      fs.symlinkSync(path.join(outside, "backups"), path.join(kiroHome, "kiro-fabric", "backups"));
    }
    const before = treeDigest(outside);
    expect(() => createConfigurationBackup(kiroHome, { command: "install", sourceRoot: kiroHome })).toThrow(/symlink|unsafe directory/);
    expect(treeDigest(outside)).toBe(before);
  });

  it("does not use source exclusions to bypass unsafe directory permissions", () => {
    const kiroHome = temporary();
    seedConfiguration(kiroHome);
    const artifact = path.join(kiroHome, ".tmp");
    fs.mkdirSync(artifact, { mode: 0o700 });
    fs.chmodSync(artifact, 0o777);
    expect(() => createConfigurationBackup(kiroHome, { command: "install", sourceRoot: kiroHome })).toThrow(/unsafe directory permissions/);
    expect(fs.existsSync(path.join(kiroHome, "kiro-fabric", "backups"))).toBe(false);
    expect(fs.lstatSync(artifact).mode & 0o777).toBe(0o777);
  });

  it("keeps the depth cap for unknown source-home configuration", () => {
    const kiroHome = temporary();
    const deep = path.join(kiroHome, ...Array.from({ length: 33 }, () => "user"));
    fs.mkdirSync(deep, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(deep, "settings.json"), "preserve", { mode: 0o600 });
    expect(() => createConfigurationBackup(kiroHome, { command: "install", sourceRoot: kiroHome })).toThrow(/configuration backup depth exceeded/);
    expect(fs.existsSync(path.join(kiroHome, "kiro-fabric"))).toBe(false);
    expect(fs.readFileSync(path.join(deep, "settings.json"), "utf8")).toBe("preserve");
  });

  it.each(["user.json", "agents/kiro-fabric.json"])("refuses an inventoried file becoming hardlinked before copy: %s", relative => {
    const kiroHome = temporary(), outside = temporary();
    seedConfiguration(kiroHome);
    const file = path.join(kiroHome, relative), alias = path.join(outside, "late-hardlink");
    if (relative === "user.json") fs.writeFileSync(file, "shared content", { mode: 0o600 });
    const backups = path.join(kiroHome, "kiro-fabric", "backups");
    const original = fs.mkdirSync;
    let injected = false;
    vi.spyOn(fs, "mkdirSync").mockImplementation(((...args: Parameters<typeof fs.mkdirSync>) => {
      if (typeof args[0] === "string" && path.dirname(args[0]) === backups) {
        fs.linkSync(file, alias);
        injected = true;
      }
      return original(...args);
    }) as typeof fs.mkdirSync);
    expect(() => createConfigurationBackup(kiroHome, { command: "install" })).toThrow(/unsafe configuration file/);
    expect(injected).toBe(true);
    const retained = fs.readdirSync(backups);
    expect(retained).toHaveLength(1);
    expect(fs.existsSync(path.join(backups, retained[0]!, "backup-manifest.json"))).toBe(false);
    expect(listConfigurationBackups(kiroHome)).toEqual([]);
    expect(fs.lstatSync(file).nlink).toBe(2);
    expect(fs.readFileSync(alias)).toEqual(fs.readFileSync(file));
  });

  it("refuses a symlink swap at open without reading its external target", () => {
    const kiroHome = temporary(), outside = temporary();
    const file = path.join(kiroHome, "user.json"), secret = path.join(outside, "secret.json");
    fs.writeFileSync(file, "same-sized data", { mode: 0o600 });
    fs.writeFileSync(secret, "private content", { mode: 0o600 });
    const original = fs.openSync;
    let injected = false;
    vi.spyOn(fs, "openSync").mockImplementation((...args) => {
      if (args[0] === file && !injected) {
        fs.renameSync(file, path.join(temporary(), "retained-entry"));
        fs.symlinkSync(secret, file);
        injected = true;
      }
      return original(...args);
    });
    expect(() => createConfigurationBackup(kiroHome, { command: "install" })).toThrow(/ELOOP|symlink|unsafe/);
    expect(injected).toBe(true);
    expect(fs.existsSync(path.join(kiroHome, "kiro-fabric"))).toBe(false);
    expect(fs.readlinkSync(file)).toBe(secret);
    expect(fs.readFileSync(secret, "utf8")).toBe("private content");
  });

  it("bounds a source read even if a file grows past 64 MiB during inventory", () => {
    const kiroHome = temporary();
    const file = path.join(kiroHome, "growing.json");
    fs.writeFileSync(file, "small", { mode: 0o600 });
    const original = fs.readSync;
    let read = 0, injected = false;
    vi.spyOn(fs, "readSync").mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
      const count = original(...args);
      read += count;
      if (!injected) {
        fs.truncateSync(file, 65 * 1024 * 1024);
        injected = true;
      }
      return count;
    }) as typeof fs.readSync);
    expect(() => createConfigurationBackup(kiroHome, { command: "install" })).toThrow(/configuration changed during backup/);
    expect(injected).toBe(true);
    expect(read).toBeLessThanOrEqual(Buffer.byteLength("small") + 1);
    expect(fs.existsSync(path.join(kiroHome, "kiro-fabric"))).toBe(false);
    expect(fs.lstatSync(file).size).toBe(65 * 1024 * 1024);
  });

  it.each(["same second", "clock rollback"])("preserves all snapshots during %s", kind => {
    const kiroHome = temporary();
    seedConfiguration(kiroHome);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
      for (let index = 0; index < 20; index += 1) {
        const backup = backupOf(kiroHome, "install");
        // Deterministically sort every older random suffix above the new one.
        fs.renameSync(backup.path, path.join(path.dirname(backup.path), `20300101T000000Z-ffffffffffff${index.toString(16).padStart(4, "0")}`));
      }
      if (kind === "clock rollback") vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
      const fresh = backupOf(kiroHome, "update");
      expect(fs.existsSync(fresh.path)).toBe(true);
      expect(createHash("sha256").update(fs.readFileSync(path.join(fresh.path, "backup-manifest.json"))).digest("hex")).toBe(fresh.manifestSha256);
      expect(fs.readdirSync(path.dirname(fresh.path))).toHaveLength(21);
    } finally { vi.useRealTimers(); }
  });

  it.each(["unknown", "corrupt", "modified", "extra file", "extra directory", "missing file", "hardlink", "manifest hardlink", "symlink", "manifest symlink", "wrong home", "duplicate path", "oversized manifest", "oversized file", "mode"])(
    "creation preserves %s evidence and listing refuses it", kind => {
      const kiroHome = temporary(), outside = temporary();
      seedConfiguration(kiroHome);
      const backup = backupOf(kiroHome, "install");
      const old = path.join(path.dirname(backup.path), "20000101T000000Z-0000000000000000");
      fs.renameSync(backup.path, old);
      const manifestPath = path.join(old, "backup-manifest.json"), file = path.join(old, "settings/global.json");
      const external = path.join(outside, "evidence");
      fs.writeFileSync(external, "external evidence", { mode: 0o600 });
      if (kind === "unknown") fs.renameSync(manifestPath, path.join(temporary(), "retained-entry"));
      if (kind === "corrupt") fs.writeFileSync(manifestPath, "not JSON");
      if (kind === "modified") { fs.chmodSync(file, 0o600); fs.writeFileSync(file, "changed"); }
      if (kind === "extra file") fs.writeFileSync(path.join(old, "foreign"), "keep", { mode: 0o600 });
      if (kind === "extra directory") fs.mkdirSync(path.join(old, "foreign"), { mode: 0o700 });
      if (kind === "missing file") fs.renameSync(file, path.join(temporary(), "retained-entry"));
      if (kind === "hardlink") fs.linkSync(file, path.join(outside, "hardlink"));
      if (kind === "manifest hardlink") fs.linkSync(manifestPath, path.join(outside, "hardlink"));
      if (kind === "symlink" || kind === "manifest symlink") { const target = kind === "symlink" ? file : manifestPath; fs.renameSync(target, path.join(temporary(), "retained-entry")); fs.symlinkSync(external, target); }
      if (kind === "wrong home" || kind === "duplicate path") {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (kind === "wrong home") manifest.kiroHome = outside;
        else manifest.files.push(manifest.files[0]);
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      }
      if (kind === "oversized manifest" || kind === "oversized file") {
        const target = kind === "oversized manifest" ? manifestPath : file;
        fs.chmodSync(target, 0o600);
        const fd = fs.openSync(target, "r+");
        try { fs.ftruncateSync(fd, 65 * 1024 * 1024); } finally { fs.closeSync(fd); }
      }
      if (kind === "mode") fs.chmodSync(file, 0o444);
      const before = treeDigest(old), externalBefore = treeDigest(outside);
      for (let index = 0; index < 21; index += 1) backupOf(kiroHome, "update");
      expect(fs.existsSync(old)).toBe(true);
      expect(treeDigest(old)).toBe(before);
      expect(treeDigest(outside)).toBe(externalBefore);
      expect(listConfigurationBackups(kiroHome).some(item => item.name === path.basename(old))).toBe(false);
    },
  );

  it.each(["foreign file", "foreign directory", "foreign symlink", "symlink hardlink", "directory mode", "manifest mode", "deep tree"])(
    "creation preserves %s and listing rejects unsafe evidence", kind => {
      const kiroHome = temporary(), outside = temporary();
      seedConfiguration(kiroHome);
      const backup = backupOf(kiroHome, "install"), old = path.join(path.dirname(backup.path), "20000101T000000Z-0000000000000000");
      fs.renameSync(backup.path, old);
      const target = kind === "foreign file" ? path.join(old, "settings/global.json")
        : kind === "foreign symlink" || kind === "symlink hardlink" ? path.join(old, "current-settings") : path.join(old, "settings");
      if (kind === "symlink hardlink") fs.linkSync(target, path.join(outside, "link-evidence"));
      if (kind === "directory mode") fs.chmodSync(target, 0o500);
      if (kind === "manifest mode") fs.chmodSync(path.join(old, "backup-manifest.json"), 0o400);
      if (kind === "deep tree") fs.mkdirSync(path.join(old, ...Array.from({ length: 34 }, () => "foreign")), { recursive: true, mode: 0o700 });
      const before = treeDigest(old);
      const lstat = fs.lstatSync;
      if (kind.startsWith("foreign")) vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
        const stats = lstat(...args);
        if (args[0] === target && stats) Reflect.set(stats, "uid", Number(stats.uid) + 1);
        return stats;
      }) as typeof fs.lstatSync);
      for (let index = 0; index < 21; index += 1) backupOf(kiroHome, "update");
      expect(fs.existsSync(old)).toBe(true);
      expect(treeDigest(old)).toBe(before);
      expect(listConfigurationBackups(kiroHome).some(item => item.name === path.basename(old))).toBe(false);
      vi.restoreAllMocks();
      if (kind === "directory mode") fs.chmodSync(target, 0o700);
    },
  );

  it("creation preserves overflow evidence without opening older snapshots", () => {
    const kiroHome = temporary();
    const first = backupOf(kiroHome, "install"), root = path.dirname(first.path);
    for (let index = 0; index < 256; index += 1) {
      fs.mkdirSync(path.join(root, `20000101T000000Z-${index.toString(16).padStart(16, "0")}`), { mode: 0o700 });
    }
    const opened = vi.spyOn(fs, "openSync"), fresh = backupOf(kiroHome, "update");
    expect(fs.existsSync(fresh.path)).toBe(true);
    expect(fs.readdirSync(root)).toHaveLength(258);
    expect(opened.mock.calls.some(([file]) => typeof file === "string" && file.includes("20000101T"))).toBe(false);
  });

  it("creation does not open oversized older manifests", () => {
    const kiroHome = temporary();
    const first = backupOf(kiroHome, "install"), root = path.dirname(first.path);
    const old = path.join(root, "20000101T000000Z-0000000000000000");
    fs.renameSync(first.path, old);
    const manifest = path.join(old, "backup-manifest.json");
    fs.truncateSync(manifest, 5 * 1024 * 1024);
    for (let index = 0; index < 19; index += 1) backupOf(kiroHome, "update");
    const opened = vi.spyOn(fs, "openSync");
    backupOf(kiroHome, "update");
    expect(opened.mock.calls.some(([file]) => file === manifest)).toBe(false);
    expect(fs.lstatSync(manifest).size).toBe(5 * 1024 * 1024);
  });

  it("listing bounds a growing manifest descriptor read and preserves the changed tree", () => {
    const kiroHome = temporary();
    const first = backupOf(kiroHome, "install"), root = path.dirname(first.path);
    const old = path.join(root, "20000101T000000Z-0000000000000000");
    fs.renameSync(first.path, old);
    const manifest = path.join(old, "backup-manifest.json"), size = fs.lstatSync(manifest).size;
    for (let index = 0; index < 19; index += 1) backupOf(kiroHome, "update");
    const open = fs.openSync, read = fs.readSync, close = fs.closeSync;
    let descriptor: number | undefined, bytes = 0, injected = false;
    vi.spyOn(fs, "openSync").mockImplementation((...args) => {
      const result = open(...args);
      if (args[0] === manifest) descriptor = result;
      return result;
    });
    vi.spyOn(fs, "closeSync").mockImplementation(fd => {
      if (fd === descriptor) descriptor = undefined;
      close(fd);
    });
    vi.spyOn(fs, "readSync").mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
      const count = read(...args);
      if (args[0] === descriptor) {
        bytes += count;
        if (!injected) { injected = true; fs.truncateSync(manifest, 65 * 1024 * 1024); }
      }
      return count;
    }) as typeof fs.readSync);
    const fresh = backupOf(kiroHome, "update");
    // Creation no longer scans old backups; exercise the real listing verifier.
    expect(listConfigurationBackups(kiroHome).some(item => item.name === path.basename(old))).toBe(false);
    expect(injected).toBe(true);
    expect(bytes).toBeLessThanOrEqual(size + 1);
    expect(fs.existsSync(fresh.path)).toBe(true);
    expect(fs.lstatSync(manifest).size).toBe(65 * 1024 * 1024);
  });

  it("preserves every backup beyond the former automatic-pruning threshold", () => {
    const kiroHome = temporary();
    fs.writeFileSync(path.join(kiroHome, "settings.txt"), "x", { mode: 0o600 });
    for (let index = 0; index < 25; index += 1) backupOf(kiroHome, "install");
    const listed = listConfigurationBackups(kiroHome);
    expect(listed).toHaveLength(25);
    expect(fs.readdirSync(path.join(kiroHome, "kiro-fabric", "backups"))).toHaveLength(25);
  });

  it("classifies a synthetic non-regular entry as skipped without touching its path", () => {
    const kiroHome = temporary();
    seedConfiguration(kiroHome);
    const readdir = fs.readdirSync;
    // Classification only: no actual socket binding/unlink or lifecycle claim.
    vi.spyOn(fs, "readdirSync").mockImplementation(((...args: Parameters<typeof fs.readdirSync>) => {
      const entries = readdir(...args);
      if (args[0] === kiroHome && typeof args[1] === "object" && args[1]?.withFileTypes) {
        return [...entries, { name: "daemon.sock", isDirectory: () => false, isSymbolicLink: () => false, isFile: () => false }];
      }
      return entries;
    }) as typeof fs.readdirSync);
    const backup = backupOf(kiroHome, "install");
    expect(backup.skipped).toBe(1);
    const manifest = JSON.parse(fs.readFileSync(path.join(backup.path, "backup-manifest.json"), "utf8"));
    expect(manifest.skipped).toEqual([{ path: "daemon.sock", reason: "non-regular" }]);
    expect(fs.existsSync(path.join(kiroHome, "daemon.sock"))).toBe(false);
  });

  it("preserves exact recorded modes under umask 077 without chmodding preexisting directories", () => {
    const kiroHome = temporary();
    seedConfiguration(kiroHome);
    fs.chmodSync(path.join(kiroHome, "settings"), 0o500);
    fs.chmodSync(path.join(kiroHome, "settings", "global.json"), 0o644);
    fs.chmodSync(path.join(kiroHome, "executable.sh"), 0o755);
    fs.chmodSync(path.join(kiroHome, "agents"), 0o750);
    const backup = backupOf(kiroHome, "install");
    // The backup has captured the read-only mode; restore fixture traversal for teardown.
    fs.chmodSync(path.join(kiroHome, "settings"), 0o700);
    const destination = temporary();
    fs.mkdirSync(path.join(destination, "kiro-fabric"), { mode: 0o700 });
    fs.mkdirSync(path.join(destination, "agents"), { mode: 0o750 });
    fs.chmodSync(path.join(destination, "agents"), 0o750);
    const previousUmask = process.umask(0o077);
    try {
      restoreConfigurationBackup(backup.path, destination);
    } finally {
      process.umask(previousUmask);
    }
    try {
      expect(fs.statSync(path.join(destination, "settings")).mode & 0o777).toBe(0o500);
      expect(fs.statSync(path.join(destination, "settings", "global.json")).mode & 0o777).toBe(0o644);
      expect(fs.statSync(path.join(destination, "executable.sh")).mode & 0o777).toBe(0o755);
      expect(fs.statSync(path.join(destination, "agents")).mode & 0o777).toBe(0o750);
    } finally {
      fs.chmodSync(path.join(destination, "settings"), 0o700);
    }
  });

  it("rejects preexisting directory mode drift before pinned effects", () => {
    const kiroHome = temporary();
    seedConfiguration(kiroHome);
    fs.chmodSync(path.join(kiroHome, "agents"), 0o750);
    const backup = backupOf(kiroHome, "install"), destination = temporary();
    fs.mkdirSync(path.join(destination, "kiro-fabric"), { mode: 0o700 });
    fs.mkdirSync(path.join(destination, "agents"), { mode: 0o711 });
    fs.chmodSync(path.join(destination, "agents"), 0o711);
    const spawn = vi.spyOn(childProcess, "spawnSync");
    expect(() => restoreConfigurationBackup(backup.path, destination)).toThrow(/directory mode mismatch: agents/);
    expect(fs.statSync(path.join(destination, "agents")).mode & 0o777).toBe(0o711);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    { phase: "mkdir", operation: "mkdir0700", name: "child", method: "mkdirSync", parent: "pivot" },
    { phase: "directory chmod", operation: "chmodDirectory", name: "child", method: "fchmodSync", parent: "pivot" },
    { phase: "file", operation: "writeExclusive", name: "global.json", method: "openSync", parent: "settings" },
    { phase: "symlink", operation: "symlinkExclusive", name: "legacy", method: "symlinkSync", parent: "links" },
  ] as const)("pins the checked parent across an outward swap immediately before $phase", scenario => {
    const kiroHome = temporary(), destination = temporary(), outside = temporary();
    seedConfiguration(kiroHome);
    fs.mkdirSync(path.join(kiroHome, "pivot", "child"), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(kiroHome, "pivot", "child"), 0o750);
    fs.mkdirSync(path.join(kiroHome, "links"), { mode: 0o700 });
    fs.symlinkSync("../settings/global.json", path.join(kiroHome, "links", "legacy"));
    fs.symlinkSync("../settings/global.json", path.join(kiroHome, "links", "zz-failure"));
    fs.mkdirSync(path.join(kiroHome, "nested", "empty"), { recursive: true, mode: 0o700 });
    const backup = backupOf(kiroHome, "install");
    fs.mkdirSync(path.join(destination, "kiro-fabric"), { mode: 0o700 });
    if (["pivot", "settings", "links"].includes(scenario.parent)) fs.mkdirSync(path.join(destination, scenario.parent), { mode: 0o700 });
    fs.writeFileSync(path.join(outside, "marker"), "outside unchanged", { mode: 0o600 });
    const outsideBefore = treeDigest(outside), checkedParent = path.join(destination, scenario.parent), evidence = checkedParent + "-evidence";
    forcePinnedChildren();
    let raced = false;
    interceptPinnedChildren(call => {
      const request = pinnedRequest(call);
      if (!raced && request.operation === scenario.operation && request.name === scenario.name && call.options.cwd === checkedParent) {
        raced = true;
        injectPinned(call, `(() => { const fs = require('node:fs'), effect = fs.${scenario.method}; let once = false; fs.${scenario.method} = (...args) => { if (!once) { once = true; fs.${scenario.method} = effect; fs.renameSync(${JSON.stringify(checkedParent)}, ${JSON.stringify(evidence)}); fs.symlinkSync(${JSON.stringify(outside)}, ${JSON.stringify(checkedParent)}); } return effect(...args); }; })();`);
      }
    });
    let failure: unknown;
    try { restoreConfigurationBackup(backup.path, destination); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(raced).toBe(true);
    expect(treeDigest(outside)).toBe(outsideBefore);
    expect(fs.readFileSync(path.join(outside, "marker"), "utf8")).toBe("outside unchanged");
    expect(fs.lstatSync(checkedParent).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(evidence).isDirectory()).toBe(true);
  });

  it("preserves published evidence and never compare-then-deletes after a later pinned failure", () => {
    const kiroHome = temporary();
    seedConfiguration(kiroHome);
    const backup = backupOf(kiroHome, "install"), destination = temporary();
    fs.mkdirSync(path.join(destination, "kiro-fabric"), { mode: 0o700 });
    forcePinnedChildren();
    const operations: string[] = [];
    interceptPinnedChildren(call => {
      const request = pinnedRequest(call);
      if (typeof request.operation === "string") operations.push(request.operation);
      if (request.operation === "symlinkExclusive" && request.name === "current-settings") {
        injectPinned(call, `require('node:fs').symlinkSync = () => { throw Error('injected restore failure'); };`);
      }
    });
    expect(() => restoreConfigurationBackup(backup.path, destination)).toThrow(/partial entries may have been preserved/);
    expect(fs.readFileSync(path.join(destination, "settings", "global.json"), "utf8")).toBe('{"theme":"dark"}\n');
    expect(operations).not.toContain("unlink");
    expect(operations).not.toContain("unlinkSymlink");
    expect(operations).not.toContain("rmdir");
  });

  // Parent startup must ALSO be allowlisted (including esbuild binary selection).
  // These children never inherit preloads, credentials, real-home config or PATH.
  const cliEnvironment = (root: string) => {
    for (const name of ["tmp", "config", "cache", "data", "state"]) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
    return { HOME: root, PATH: "", LANG: "C", LC_ALL: "C", TMPDIR: path.join(root, "tmp"), TMP: path.join(root, "tmp"), TEMP: path.join(root, "tmp"), XDG_CONFIG_HOME: path.join(root, "config"), XDG_CACHE_HOME: path.join(root, "cache"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state") };
  };
  it("exposes list and restore through the module CLI", () => {
    const root = temporary(), env = cliEnvironment(root), kiroHome = temporary();
    seedConfiguration(kiroHome);
    const backup = backupOf(kiroHome, "uninstall"), module = path.resolve("scripts/installer-configuration-backup.mjs");
    const listing = spawnSync(process.execPath, [module, "list", kiroHome], { cwd: root, env, encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] });
    expect(listing.error).toBeUndefined(); expect(listing.signal).toBeNull(); expect(listing.status, listing.stderr).toBe(0); expect(listing.stderr).toBe("");
    const listed = listing.stdout.trim().split("\n").map(line => JSON.parse(line));
    expect(listed.at(-1)?.name).toBe(path.basename(backup.path));
    const destination = temporary(); fs.mkdirSync(path.join(destination, "kiro-fabric"), { mode: 0o700 });
    const restored = spawnSync(process.execPath, [module, "restore", backup.path, destination], { cwd: root, env, encoding: "utf8", timeout: 240_000, stdio: ["ignore", "pipe", "pipe"] });
    expect(restored.error).toBeUndefined(); expect(restored.signal).toBeNull(); expect(restored.status, restored.stderr).toBe(0); expect(restored.stderr).toBe("");
    expect(restored.stdout).toContain("Restored 3 files");
    expect(fs.readFileSync(path.join(destination, "settings/global.json"), "utf8")).toBe('{"theme":"dark"}\n');
    expect(fs.existsSync(path.join(destination, "agents/kiro-fabric.json"))).toBe(false);
  }, 360_000);

  it("keeps the backup CLI inactive inside bundled manager commands", async () => {
    const root = temporary(), env = cliEnvironment(root), manager = path.join(root, "install-manager.mjs");
    await build({ entryPoints: [path.resolve("scripts/install-manager.mjs")], outfile: manager, bundle: true, platform: "node", format: "esm", target: "node24", logLevel: "silent" });
    const kiroHome = temporary();
    const doctor = spawnSync(process.execPath, [manager, "doctor", "--kiro-home", kiroHome, "--json"], { cwd: root, env, encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] });
    expect(doctor.error).toBeUndefined(); expect(doctor.signal).toBeNull(); expect(doctor.status).toBe(5);
    expect(JSON.parse(doctor.stdout)).toMatchObject({ command: "doctor", outcome: "diagnostic-failure" }); expect(doctor.stderr).toBe("");
    seedConfiguration(kiroHome);
    const backup = backupOf(kiroHome, "install"), destination = temporary(); fs.mkdirSync(path.join(destination, "kiro-fabric"), { mode: 0o700 });
    const restored = spawnSync(process.execPath, [manager, "restore", "--backup", backup.path, "--kiro-home", destination, "--yes", "--non-interactive", "--json"], { cwd: root, env, encoding: "utf8", timeout: 240_000, stdio: ["ignore", "pipe", "pipe"] });
    expect(restored.error).toBeUndefined(); expect(restored.signal).toBeNull(); expect(restored.status, restored.stdout + restored.stderr).toBe(0);
    expect(JSON.parse(restored.stdout)).toMatchObject({ command: "restore", outcome: "restored", restored: 3 }); expect(restored.stderr).toBe("");
    expect(fs.readFileSync(path.join(destination, "settings/global.json"), "utf8")).toBe('{"theme":"dark"}\n');
  }, 360_000);
});
