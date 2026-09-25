import fs from "node:fs";
import path from "node:path";
import { captureDirectoryAncestry, readDirectoryBoundedSync } from "../src/installation/filesystem-boundary.mjs";

const MAX_ENTRIES = 20_000;
const identity = stat => ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"].map(key => stat[key].toString()).join(":");
const lstat = file => { try { return fs.lstatSync(file, { bigint: true }); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };

// No content reads, link traversal or removal. Bound both total entries and depth.
function inspect(directory) {
  const entries = [], pending = [{ name: "", depth: 0 }];
  while (pending.length) {
    const { name, depth } = pending.pop();
    if (depth > 64 || entries.length >= MAX_ENTRIES) throw new Error("Generated output inspection bound; preserve output");
    const file = path.join(directory, name), stat = fs.lstatSync(file, { bigint: true });
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o022n) || (stat.isFile() && stat.nlink !== 1n)) throw new Error("Unsafe generated output entry; preserve output");
    entries.push([name, identity(stat)]);
    if (stat.isDirectory()) {
      const names = readDirectoryBoundedSync(file, MAX_ENTRIES - entries.length - pending.length).sort();
      const lower = new Set(names.map(value => value.toLowerCase()));
      if (lower.has(".git") || (lower.has("head") && lower.has("objects") && (lower.has("refs") || lower.has("packed-refs")))) throw new Error("Repository metadata in generated output; preserve output");
      for (const child of names) pending.push({ name: path.join(name, child), depth: depth + 1 });
    }
  }
  return JSON.stringify(entries);
}

/** Fresh output without deleting prior bytes. Fixed build scopes only; not a
 * hostile-filesystem sandbox. Concurrent changes refuse when observed.
 * @param {string} root @param {"dist"|"dist/kiro-agent-closure"} relative */
export function prepareGeneratedOutput(root, relative) {
  if (!['dist', 'dist/kiro-agent-closure'].includes(relative) || typeof process.getuid !== "function") throw new Error("Unsupported generated output scope");
  const guard = captureDirectoryAncestry(root), directory = path.join(guard.root, relative);
  const dist = path.join(guard.root, "dist");
  if (relative !== "dist" && !lstat(dist)) { guard.check(); fs.mkdirSync(dist, { mode: 0o755 }); }
  const parent = captureDirectoryAncestry(path.dirname(directory));
  let retained = null;
  const previous = lstat(directory);
  if (previous) {
    if (!previous.isDirectory() || previous.isSymbolicLink()) throw new Error("Generated output must be a real directory; preserve output");
    const snapshot = inspect(directory);
    const cache = path.join(guard.root, ".tmp");
    if (!lstat(cache)) { guard.check(); fs.mkdirSync(cache, { mode: 0o700 }); }
    const cacheGuard = captureDirectoryAncestry(cache), cacheStat = fs.lstatSync(cache);
    if (cacheStat.uid !== process.getuid() || (cacheStat.mode & 0o7777) !== 0o700) throw new Error("Build retention requires a private .tmp directory");
    guard.check(); parent.check(); cacheGuard.check();
    const backup = fs.mkdtempSync(path.join(cache, "generated-output-"));
    retained = path.join(backup, "output");
    console.error("[fabric:task-root] " + JSON.stringify({ path: backup, policy: "retain", source: relative }));
    if (inspect(directory) !== snapshot || identity(lstat(directory)) !== identity(previous)) throw new Error("Generated output changed; preserve output");
    guard.check(); parent.check(); cacheGuard.check();
    fs.renameSync(directory, retained);
  }
  guard.check(); parent.check();
  fs.mkdirSync(directory, { mode: 0o755 }); // EEXIST refuses unexpected replacement.
  return retained;
}
