import fs from "node:fs";
import path from "node:path";
import { captureDirectoryAncestry, readDirectoryBoundedSync } from "../src/installation/filesystem-boundary.mjs";

const MAX_ENTRIES = 20_000;
export const fileIdentity = stat => ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"].map(key => stat[key].toString()).join(":");
export const lstat = file => { try { return fs.lstatSync(file, { bigint: true }); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
const bareRepository = names => {
  const lower = new Set(names.map(name => name.toLowerCase()));
  return lower.has("head") && lower.has("objects") && (lower.has("refs") || lower.has("packed-refs"));
};

export function inspectOwnedTree(target) {
  target = path.resolve(target);
  if (typeof process.getuid !== "function" || target.split(path.sep).some(name => name.toLowerCase() === ".git")) throw new Error(`Unsafe removal scope: ${target}`);
  const parent = captureDirectoryAncestry(path.dirname(target), { allowMacAliases: true });
  target = path.join(parent.root, path.basename(target));
  let ancestor = parent.root, inspected = 0;
  for (;;) {
    const names = readDirectoryBoundedSync(ancestor, MAX_ENTRIES - inspected);
    inspected += names.length;
    if (bareRepository(names)) throw new Error(`Enclosing Git repository; preserve ${target}`);
    if (ancestor === path.dirname(ancestor)) break;
    ancestor = path.dirname(ancestor);
  }
  const entries = [], pending = [{ name: "", depth: 0 }];
  while (pending.length) {
    const { name, depth } = pending.pop();
    if (depth > 64 || entries.length >= MAX_ENTRIES) throw new Error(`Tree inspection bound; preserve ${target}`);
    const file = path.join(target, name), stat = fs.lstatSync(file, { bigint: true });
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o022n) || (stat.isFile() && stat.nlink !== 1n)) throw new Error(`Unsafe or unowned entry; preserve ${file}`);
    entries.push({ name, identity: fileIdentity(stat), directory: stat.isDirectory() });
    if (stat.isDirectory()) {
      const names = readDirectoryBoundedSync(file, MAX_ENTRIES - entries.length - pending.length).sort();
      if (names.some(child => child.toLowerCase() === ".git") || bareRepository(names)) throw new Error(`Git repository metadata; preserve ${target}`);
      for (const child of names) pending.push({ name: path.join(name, child), depth: depth + 1 });
    }
  }
  parent.check();
  return JSON.stringify(entries);
}

export function removeOwnedTree(target, snapshot = inspectOwnedTree(target)) {
  target = path.resolve(target);
  const parent = captureDirectoryAncestry(path.dirname(target), { allowMacAliases: true });
  target = path.join(parent.root, path.basename(target));
  if (inspectOwnedTree(target) !== snapshot) throw new Error(`Tree changed; preserve ${target}`);
  parent.check();
  fs.rmSync(target, { recursive: true });
}
