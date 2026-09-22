import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openKiroMemory, type KiroMemoryBinding } from "../src/kiro/memory.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "memory-storage-identity-"))); roots.push(root);
  const a = path.join(root, "a"), b = path.join(root, "b");
  const first = openKiroMemory("workspace", a), second = openKiroMemory("workspace", b);
  const scope = path.join(a, "memory");
  const namespace = fs.readdirSync(scope, { withFileTypes: true }).find(entry => entry.isDirectory())!.name;
  return { root, a, b, first, second, scope, namespace, directory: path.join(scope, namespace) };
}
function snapshot(root: string): unknown {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) return { link: fs.readlinkSync(root) };
  if (!stat.isDirectory()) return { mode: stat.mode, bytes: fs.readFileSync(root).toString("base64") };
  return fs.readdirSync(root).sort().map(name => [name, snapshot(path.join(root, name))]);
}
const operations: Array<[string, (memory: KiroMemoryBinding) => Promise<unknown>]> = [
  ["get", memory => memory.get("key")], ["set", memory => memory.set("key", "changed")],
  ["delete", memory => memory.delete("key")], ["search", memory => memory.search("sentinel")],
  ["index", memory => memory.index()], ["list", memory => memory.list()], ["empty search", memory => memory.search(" ")],
];

describe.each(["root", "scope", "namespace"] as const)("memory %s lifetime boundary", level => {
  it.each(["symlink", "directory", "permissions"] as const)("rejects replacement/unsafe %s before all operations", async kind => {
    if (process.platform === "win32" && kind !== "directory") return;
    const f = fixture(); await f.first.set("key", "original-sentinel"); await f.second.set("key", "foreign-sentinel");
    const target = level === "root" ? f.a : level === "scope" ? f.scope : f.directory;
    const foreign = level === "root" ? f.b : level === "scope" ? path.join(f.b, "memory") : path.join(f.b, "memory", f.namespace);
    if (kind === "permissions") fs.chmodSync(target, 0o770);
    else {
      fs.renameSync(target, target + ".original");
      if (kind === "symlink") fs.symlinkSync(foreign, target);
      else fs.cpSync(target + ".original", target, { recursive: true });
    }
    const before = snapshot(f.root), mkdir = vi.spyOn(fs, "mkdirSync"), open = vi.spyOn(fs, "openSync");
    for (const [name, run] of operations) await expect(run(f.first), name).rejects.toThrow();
    expect(mkdir).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
    vi.restoreAllMocks(); expect(snapshot(f.root)).toEqual(before);
  });
});

describe.each(["scope", "namespace"] as const)("memory %s ownership marker", level => {
  it.each(["replacement", "contents", "permissions", "hardlink"] as const)("rejects %s drift without repairing it", async kind => {
    if (process.platform === "win32" && kind === "permissions") return;
    const f = fixture(); await f.first.set("key", "original-sentinel");
    const marker = path.join(level === "scope" ? f.scope : f.directory, ".kiro-fabric-owner");
    const old = fs.readFileSync(marker);
    if (kind === "replacement") { fs.renameSync(marker, marker + ".original"); fs.writeFileSync(marker, old, { mode: 0o600 }); }
    if (kind === "contents") fs.writeFileSync(marker, "foreign metadata", { mode: 0o600 });
    if (kind === "permissions") fs.chmodSync(marker, 0o640);
    if (kind === "hardlink") fs.linkSync(marker, marker + ".alias");
    const before = snapshot(f.root), mkdir = vi.spyOn(fs, "mkdirSync"), read = vi.spyOn(fs, "readSync");
    for (const [name, run] of operations) await expect(run(f.first), name).rejects.toThrow();
    expect(mkdir).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    vi.restoreAllMocks(); expect(snapshot(f.root)).toEqual(before);
  });
});

it("rejects an ancestor symlink even when the memory directory inode is unchanged", async () => {
  if (process.platform === "win32") return;
  const f = fixture(); await f.first.set("key", "original-sentinel");
  const moved = f.root + ".original"; roots.push(moved);
  fs.renameSync(f.root, moved); fs.symlinkSync(moved, f.root);
  const before = snapshot(moved);
  for (const [name, run] of operations) await expect(run(f.first), name).rejects.toThrow();
  expect(snapshot(moved)).toEqual(before);
});

it.each(["get", "index"] as const)("does not report missing/empty data when the namespace disappears during %s", async operation => {
  const f = fixture(); await f.first.set("key", "original-sentinel");
  if (operation === "get") {
    const lstat = fs.lstatSync;
    vi.spyOn(fs, "lstatSync").mockImplementation((target, options) => {
      if (String(target) === path.join(f.directory, "missing.json")) fs.renameSync(f.directory, f.directory + ".original");
      return lstat(target, options as never);
    });
  } else {
    const open = fs.opendirSync;
    vi.spyOn(fs, "opendirSync").mockImplementation(((target: fs.PathLike, options?: fs.OpenDirOptions) => {
      if (String(target) === f.directory) fs.renameSync(f.directory, f.directory + ".original");
      return open(target, options);
    }) as typeof fs.opendirSync);
  }
  await expect(operation === "get" ? f.first.get("missing") : f.first.index()).rejects.toThrow();
  vi.restoreAllMocks(); expect(fs.existsSync(path.join(f.directory + ".original", "key.json"))).toBe(true);
});

it("revalidates a namespace after waiting on a live mutation lock", async () => {
  const f = fixture(); await f.first.set("key", "original-sentinel"); await f.second.set("key", "foreign-sentinel");
  const lock = path.join(f.directory, ".kiro-fabric-mutation-lock"); fs.mkdirSync(lock, { mode: 0o700 });
  fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, acquiredAt: Date.now(), token: "live-owner" }), { mode: 0o600 });
  const pending = f.first.set("key", "must-not-write");
  await new Promise(resolve => setTimeout(resolve, 25));
  fs.renameSync(f.directory, f.directory + ".original"); fs.symlinkSync(path.join(f.b, "memory", f.namespace), f.directory);
  const before = snapshot(f.root);
  await expect(pending).rejects.toThrow(); expect(snapshot(f.root)).toEqual(before);
});

it.each(["set", "delete"] as const)("revalidates after the %s precommit callback before effects", async operation => {
  const f = fixture(); await f.first.set("key", "original-sentinel"); await f.second.set("key", "foreign-sentinel");
  const foreign = snapshot(f.b);
  let calls = 0;
  const beforeCommit = () => {
    if (++calls !== (operation === "set" ? 4 : 3)) return;
    fs.renameSync(f.a, f.a + ".original"); fs.symlinkSync(f.b, f.a);
  };
  const pending = operation === "set" ? f.first.set("key", "must-not-write", undefined, beforeCommit) : f.first.delete("key", undefined, beforeCommit);
  await expect(pending).rejects.toThrow(); expect(snapshot(f.b)).toEqual(foreign);
  expect((await openKiroMemory("workspace", f.b).get("key"))?.value).toBe("foreign-sentinel");
});
