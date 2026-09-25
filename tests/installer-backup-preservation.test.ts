import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfigurationBackup, listConfigurationBackups, restoreConfigurationBackup } from "../scripts/installer-configuration-backup.mjs";
import { managerErrorResult, presentManagerError } from "../scripts/install-manager.mjs";
import { installerSuiteFiles } from "../scripts/test-installer.mjs";
import { snapshotStagingScope, assertStagingScopeUnchanged } from "../scripts/verification/staging-preservation-snapshot.mjs";

// Retain ALL fixtures, including failed copies and repository metadata. These
// blockers make pre-fix counterexamples observable without executing deletion;
// a swallowed deletion error cannot pass the final zero-attempt assertion.
const roots: string[] = [];
let deletionAttempts: string[];
beforeEach(() => {
  deletionAttempts = [];
  for (const method of ["rmSync", "unlinkSync", "rmdirSync"] as const) {
    vi.spyOn(fs, method).mockImplementation((target: fs.PathLike) => {
      deletionAttempts.push(`${method}:${String(target)}`);
      throw new Error("fixture blocked deletion");
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) console.warn(`[backup preservation fixture] retained ${root}`);
  expect(deletionAttempts, "no cleanup/pruning attempt may be swallowed").toEqual([]);
});
const temporary = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "backup-preserve-")));
  fs.chmodSync(root, 0o700); roots.push(root); return root;
};
const write = (root: string, relative: string, text: string) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, text, { flag: "wx", mode: 0o600 });
};
const backupOf = (home: string) => {
  const result = createConfigurationBackup(home, { command: "install" });
  if (!result) throw new Error("expected backup");
  return result;
};
const destination = () => {
  const root = temporary(); fs.mkdirSync(path.join(root, "kiro-fabric"), { mode: 0o700 }); return root;
};
type BackupFailure = Error & { configurationBackup: { path: string; status: string } };
function failureOf(action: () => unknown): BackupFailure {
  try { action(); } catch (error) { expect(error).toBeInstanceOf(Error); return error as BackupFailure; }
  throw new Error("expected failure");
}
function repository(home: string, kind: string) {
  if (kind === "directory") {
    write(home, "project/.git/HEAD", "ref: refs/heads/main\n");
    fs.mkdirSync(path.join(home, "project/.git/objects"), { mode: 0o700 });
    fs.mkdirSync(path.join(home, "project/.git/refs"), { mode: 0o700 });
  } else if (kind === "worktree") write(home, "project/.git", "gitdir: ../retained-metadata\n");
  else if (kind === "link") {
    fs.mkdirSync(path.join(home, "project"), { mode: 0o700 });
    fs.symlinkSync("../retained-metadata", path.join(home, "project/.git"));
  } else {
    write(home, "project/HEAD", "ref: refs/heads/main\n");
    fs.mkdirSync(path.join(home, "project/objects"), { mode: 0o700 });
    fs.mkdirSync(path.join(home, "project/refs"), { mode: 0o700 });
  }
}

describe("configuration backup preservation", () => {
  it.each(["directory", "worktree", "link", "bare"])("retains exact partial evidence containing %s repository metadata", kind => {
    const home = temporary(); repository(home, kind); write(home, "zz-fail", "original content");
    const sourceBefore = snapshotStagingScope(path.join(home, "project"));
    const open = fs.openSync, fault = new Error("injected second source open");
    let opens = 0, captured: ReturnType<typeof snapshotStagingScope> | undefined, retained = "";
    vi.spyOn(fs, "openSync").mockImplementation((...args) => {
      if (args[0] === path.join(home, "zz-fail") && ++opens === 2) {
        const root = path.join(home, "kiro-fabric/backups");
        const names = fs.readdirSync(root); expect(names).toHaveLength(1);
        retained = path.join(root, names[0]!); captured = snapshotStagingScope(retained); throw fault;
      }
      return open(...args);
    });
    const failure = failureOf(() => backupOf(home));
    expect(opens).toBe(2); expect(captured).toBeDefined();
    expect(failure.cause).toBe(fault);
    expect(failure.configurationBackup).toEqual({ path: retained, status: "unverified" });
    assertStagingScopeUnchanged(captured!, snapshotStagingScope(retained), "failed copy");
    assertStagingScopeUnchanged(sourceBefore, snapshotStagingScope(path.join(home, "project")), "source repository");
    expect(listConfigurationBackups(home)).toEqual([]);
    const target = destination(), before = snapshotStagingScope(target);
    expect(() => restoreConfigurationBackup(retained, target)).toThrow();
    assertStagingScopeUnchanged(before, snapshotStagingScope(target), "partial restore refusal");
  });

  it("retains a complete-looking tree on post-manifest sync failure without claiming durability", () => {
    const home = temporary(); write(home, "settings", "fixture");
    const sync = fs.fsyncSync, fault = new Error("injected manifest-publication sync failure");
    let captured: ReturnType<typeof snapshotStagingScope> | undefined, retained = "";
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => {
      const root = path.join(home, "kiro-fabric/backups");
      const name = fs.existsSync(root) ? fs.readdirSync(root)[0] : undefined;
      if (name && fs.existsSync(path.join(root, name, "backup-manifest.json"))) {
        retained = path.join(root, name); captured = snapshotStagingScope(retained); throw fault;
      }
      return sync(fd);
    });
    const failure = failureOf(() => backupOf(home));
    expect(captured).toBeDefined(); expect(failure.cause).toBe(fault);
    expect(failure.configurationBackup).toEqual({ path: retained, status: "unverified" });
    assertStagingScopeUnchanged(captured!, snapshotStagingScope(retained), "failed synchronization");
    // Subsequent listing verifies current bytes, not historical fsync success.
    expect(listConfigurationBackups(home)).toMatchObject([{ name: path.basename(retained), complete: true }]);
  });

  it("creation never prunes old backups, repository metadata or unknown evidence", () => {
    const home = temporary(); repository(home, "directory"); write(home, "settings", "fixture");
    const first = backupOf(home), before = snapshotStagingScope(first.path);
    const unknown = path.join(path.dirname(first.path), "20000101T000000Z-0000000000000000");
    fs.mkdirSync(unknown, { mode: 0o700 }); write(unknown, "foreign", "retain unknown evidence");
    const unknownBefore = snapshotStagingScope(unknown);
    const retained = [first.path];
    for (let n = 1; n < 25; n++) retained.push(backupOf(home).path);
    expect(fs.readdirSync(path.dirname(first.path))).toHaveLength(26);
    for (const root of retained) expect(fs.readFileSync(path.join(root, "project/.git/HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
    assertStagingScopeUnchanged(before, snapshotStagingScope(first.path), "old valid backup");
    assertStagingScopeUnchanged(unknownBefore, snapshotStagingScope(unknown), "unknown evidence");
    expect(listConfigurationBackups(home).map(b => b.name).sort()).toEqual(retained.map(p => path.basename(p)).sort());
  });

  it("listing refuses structurally incomplete copies even with a schema-1 manifest", () => {
    const home = temporary(); write(home, "settings", "fixture"); const backup = backupOf(home), evidence = temporary();
    fs.renameSync(path.join(backup.path, "settings"), path.join(evidence, "retained-settings"));
    const before = snapshotStagingScope(backup.path);
    expect(listConfigurationBackups(home)).toEqual([]);
    const target = destination(), targetBefore = snapshotStagingScope(target);
    expect(() => restoreConfigurationBackup(backup.path, target)).toThrow(/missing/);
    assertStagingScopeUnchanged(before, snapshotStagingScope(backup.path), "incomplete listing");
    assertStagingScopeUnchanged(targetBefore, snapshotStagingScope(target), "incomplete restore");
  });

  it("listing never follows a symlinked manifest", () => {
    const home = temporary(); const backup = backupOf(home), evidence = temporary();
    const manifest = path.join(backup.path, "backup-manifest.json");
    fs.renameSync(manifest, path.join(evidence, "original-manifest"));
    write(evidence, "foreign", '{"schemaVersion":1,"files":[]}');
    fs.symlinkSync(path.join(evidence, "foreign"), manifest);
    const read = vi.spyOn(fs, "readFileSync"), open = vi.spyOn(fs, "openSync");
    expect(listConfigurationBackups(home)).toEqual([]);
    expect(read.mock.calls.some(([p]) => p === manifest || p === path.join(evidence, "foreign"))).toBe(false);
    expect(open.mock.calls.some(([p]) => p === manifest || p === path.join(evidence, "foreign"))).toBe(false);
  });

  it("listing bounds root enumeration explicitly rather than returning a misleading empty list", () => {
    const home = temporary(); const first = backupOf(home), root = path.dirname(first.path);
    for (let n = 0; n < 256; n++) fs.mkdirSync(path.join(root, `20000101T000000Z-${n.toString(16).padStart(16, "0")}`), { mode: 0o700 });
    const read = vi.spyOn(fs, "readdirSync");
    expect(() => listConfigurationBackups(home)).toThrow(/listing.*bound/);
    expect(read.mock.calls.some(([p]) => p === root)).toBe(false);
    expect(fs.existsSync(first.path)).toBe(true);
  });

  it("reports unverified evidence in both JSON and human manager failures", () => {
    const home = temporary(), retained = path.join(home, "unverified");
    const error = Object.assign(new Error("fixture backup failure"), { configurationBackup: { path: retained, status: "unverified" } });
    expect(managerErrorResult(error, home)).toMatchObject({ exitCode: 5, committed: false, configurationBackup: { path: retained, status: "unverified" } });
    const stdout: string[] = [], stderr: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(chunk => { stdout.push(String(chunk)); return true; });
    vi.spyOn(process.stderr, "write").mockImplementation(chunk => { stderr.push(String(chunk)); return true; });
    expect(presentManagerError(error, true, home)).toBe(5);
    expect(JSON.parse(stdout.join(""))).toMatchObject({ configurationBackup: { path: retained, status: "unverified" } });
    expect(presentManagerError(error, false, home)).toBe(5);
    expect(stderr.join("")).toContain(`Unverified configuration backup evidence: ${retained}`);
    expect(stderr.join("")).not.toContain("Prior configuration backup:");
  });

  it.each(["file", "directory", "symlink"])("reserves the final manifest name before copying a source %s", kind => {
    const home = temporary(), file = path.join(home, "backup-manifest.json");
    if (kind === "file") write(home, "backup-manifest.json", "original user content");
    else if (kind === "directory") fs.mkdirSync(file, { mode: 0o700 });
    else fs.symlinkSync("missing-foreign-target", file);
    const before = snapshotStagingScope(home);
    expect(() => backupOf(home)).toThrow(/reserved configuration backup path/);
    assertStagingScopeUnchanged(before, snapshotStagingScope(home), "reserved source manifest");
  });

  it("reports the attempted path when exclusive mkdir takes effect then throws", () => {
    const home = temporary(), mkdir = fs.mkdirSync, fault = new Error("mkdir acknowledgement lost");
    let retained = "";
    vi.spyOn(fs, "mkdirSync").mockImplementation(((...args: Parameters<typeof fs.mkdirSync>) => {
      const result = mkdir(...args);
      if (typeof args[0] === "string" && path.dirname(args[0]) === path.join(home, "kiro-fabric/backups")) {
        retained = args[0]; throw fault;
      }
      return result;
    }) as typeof fs.mkdirSync);
    const failure = failureOf(() => backupOf(home));
    expect(retained).not.toBe(""); expect(failure.cause).toBe(fault);
    expect(failure.configurationBackup).toEqual({ path: retained, status: "unverified" });
    expect(fs.readdirSync(retained)).toEqual([]); expect(listConfigurationBackups(home)).toEqual([]);
  });

  it("publishes the final manifest exclusively without replacing a collided entry", () => {
    const home = temporary(), open = fs.openSync;
    let collided = "";
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("replacement rename forbidden"); });
    vi.spyOn(fs, "openSync").mockImplementation((...args) => {
      if (typeof args[0] === "string" && path.basename(args[0]) === "backup-manifest.json" &&
          typeof args[1] === "number" && (args[1] & fs.constants.O_CREAT)) {
        expect(args[1] & fs.constants.O_EXCL).not.toBe(0);
        collided = args[0]; fs.writeFileSync(collided, "concurrent sentinel", { flag: "wx", mode: 0o600 });
      }
      return open(...args);
    });
    const failure = failureOf(() => backupOf(home));
    expect(collided).not.toBe(""); expect(failure.message).toContain("EEXIST");
    expect(fs.readFileSync(collided, "utf8")).toBe("concurrent sentinel");
    expect(listConfigurationBackups(home)).toEqual([]);
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it("retains a partial manifest and both write/close failures", () => {
    const home = temporary(), open = fs.openSync, writeFile = fs.writeFileSync, close = fs.closeSync;
    const writeFault = new Error("partial manifest write"), closeFault = new Error("manifest close failed");
    let descriptor: number | undefined, manifest = "";
    vi.spyOn(fs, "openSync").mockImplementation((...args) => {
      const fd = open(...args);
      if (typeof args[0] === "string" && path.basename(args[0]) === "backup-manifest.json" && typeof args[1] === "number" && (args[1] & fs.constants.O_CREAT)) {
        descriptor = fd; manifest = args[0];
      }
      return fd;
    });
    vi.spyOn(fs, "writeFileSync").mockImplementation((...args) => {
      if (args[0] === descriptor) { fs.writeSync(descriptor!, Buffer.from('{"schemaVersion":')); throw writeFault; }
      return writeFile(...args);
    });
    vi.spyOn(fs, "closeSync").mockImplementation(fd => {
      close(fd);
      if (fd === descriptor) { descriptor = undefined; throw closeFault; }
    });
    const failure = failureOf(() => backupOf(home));
    expect(manifest).not.toBe(""); expect(descriptor).toBeUndefined();
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect((failure.cause as AggregateError).errors).toEqual([writeFault, closeFault]);
    expect((failure.cause as Error).cause).toBe(writeFault);
    expect(fs.readFileSync(manifest, "utf8")).toBe('{"schemaVersion":');
    expect(listConfigurationBackups(home)).toEqual([]);
  });

  it("verifies the completed tree before returning a successful backup", () => {
    const home = temporary(); write(home, "settings", "before");
    const sync = fs.fsyncSync; let changed = false, retained = "";
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => {
      sync(fd);
      const root = path.join(home, "kiro-fabric/backups"), name = fs.existsSync(root) ? fs.readdirSync(root)[0] : undefined;
      if (!changed && name && fs.existsSync(path.join(root, name, "backup-manifest.json"))) {
        changed = true; retained = path.join(root, name);
        const file = path.join(retained, "settings"); fs.chmodSync(file, 0o600); fs.writeFileSync(file, "tamper"); fs.chmodSync(file, 0o400);
      }
    });
    const failure = failureOf(() => backupOf(home));
    expect(changed).toBe(true); expect(failure.message).toMatch(/modified backup content/);
    expect(failure.configurationBackup).toEqual({ path: retained, status: "unverified" });
    expect(fs.readFileSync(path.join(retained, "settings"), "utf8")).toBe("tamper");
    expect(fs.readFileSync(path.join(home, "settings"), "utf8")).toBe("before");
    expect(listConfigurationBackups(home)).toEqual([]);
  });

  it("bounds the creation manifest before claiming a destination", () => {
    const home = temporary(), stringify = JSON.stringify;
    let injected = false;
    vi.spyOn(JSON, "stringify").mockImplementation((...args) => {
      const value = args[0];
      if (value?.schemaVersion === 1 && value.kiroHome === home && Array.isArray(value.files)) {
        injected = true; return " ".repeat(4 * 1024 * 1024 + 1);
      }
      return stringify(...args);
    });
    const failure = failureOf(() => backupOf(home));
    expect(injected).toBe(true); expect(failure.message).toMatch(/manifest exceeds bound/);
    expect(failure.configurationBackup).toBeUndefined(); expect(fs.readdirSync(home)).toEqual([]);
  });

  it("reports aggregate listing entry exhaustion and closes the directory handle", () => {
    const home = temporary(), backup = backupOf(home), opendir = fs.opendirSync;
    let reads = 0, closed = false;
    // Simulate a directory expanding past the aggregate budget without creating
    // 20,002 host entries. The real bounded reader must stop and close it.
    vi.spyOn(fs, "opendirSync").mockImplementation((...args) => {
      if (args[0] === backup.path) return {
        readSync: () => { reads++; return { name: "foreign" }; }, closeSync: () => { closed = true; },
      } as unknown as fs.Dir;
      return opendir(...args);
    });
    expect(() => listConfigurationBackups(home)).toThrow(/listing resource bound exceeded/);
    expect(reads).toBe(20002); expect(closed).toBe(true);
  });

  it("charges failed candidates against the aggregate listing byte budget", () => {
    const home = temporary(), manifests = new Set<string>();
    for (let i = 0; i < 65; i++) manifests.add(path.join(backupOf(home).path, "backup-manifest.json"));
    const lstat = fs.lstatSync, fstat = fs.fstatSync, open = fs.openSync, close = fs.closeSync;
    const descriptors = new Set<number>(); let opened = 0;
    // Each small real manifest is observed as having grown to the per-manifest
    // maximum, then returns early EOF. Invalid candidates must not reset the
    // shared budget. No large files are written or existing evidence removed.
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
      const stat = lstat(...args);
      if (typeof args[0] === "string" && manifests.has(args[0]) && stat) Reflect.set(stat, "size", 4 * 1024 * 1024);
      return stat;
    }) as typeof fs.lstatSync);
    vi.spyOn(fs, "openSync").mockImplementation((...args) => {
      const fd = open(...args);
      if (typeof args[0] === "string" && manifests.has(args[0])) { descriptors.add(fd); opened++; }
      return fd;
    });
    vi.spyOn(fs, "fstatSync").mockImplementation((...args) => {
      const stat = fstat(...args);
      if (descriptors.has(args[0])) Reflect.set(stat, "size", 4 * 1024 * 1024);
      return stat;
    });
    vi.spyOn(fs, "closeSync").mockImplementation(fd => { descriptors.delete(fd); close(fd); });
    expect(() => listConfigurationBackups(home)).toThrow(/listing resource bound exceeded/);
    expect(opened).toBe(63); expect(descriptors.size).toBe(0);
  });

  it("is registered in the maintained installer contract suite", () => {
    expect(installerSuiteFiles("contracts").filter((p: string) => p === "tests/installer-backup-preservation.test.ts")).toHaveLength(1);
  });
});
