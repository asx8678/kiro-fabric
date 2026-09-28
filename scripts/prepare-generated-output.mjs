import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { captureDirectoryAncestry, readDirectoryBoundedSync } from "../src/installation/filesystem-boundary.mjs";
import { fileIdentity as identity, lstat, inspectOwnedTree, removeOwnedTree } from "./owned-tree.mjs";

const MAX_ENTRIES = 20_000;
const RETAIN_GENERATIONS = 2;
const digest = value => createHash("sha256").update(value).digest("hex");
const currentReceipt = (cache, relative) => path.join(cache, `generated-output-current-${relative.replaceAll("/", "-")}.json`);
const readReceipt = (file, root, source) => {
  try {
    inspectOwnedTree(file);
    if (!lstat(file).isFile() || lstat(file).size > 4096n) return null;
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    return record.schemaVersion === 1 && record.root === root && record.source === source && /^[a-f0-9]{64}$/u.test(record.snapshot) ? record : null;
  } catch { return null; }
};

// No content reads, link traversal or removal. Bound both total entries and depth.
const inspect = inspectOwnedTree;

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
    const generated = readReceipt(currentReceipt(cache, relative), guard.root, relative)?.snapshot === digest(snapshot);
    guard.check(); parent.check(); cacheGuard.check();
    const backup = fs.mkdtempSync(path.join(cache, "generated-output-"));
    retained = path.join(backup, "output");
    console.error("[fabric:task-root] " + JSON.stringify({ path: backup, policy: "retain", source: relative }));
    if (inspect(directory) !== snapshot || identity(lstat(directory)) !== identity(previous)) throw new Error("Generated output changed; preserve output");
    guard.check(); parent.check(); cacheGuard.check();
    fs.renameSync(directory, retained);
    if (generated) fs.writeFileSync(path.join(backup, "retention.json"), JSON.stringify({
      schemaVersion: 1, root: guard.root, source: relative, createdAt: Date.now(), snapshot: digest(inspect(retained)),
    }), { flag: "wx", mode: 0o600 });
  }
  guard.check(); parent.check();
  fs.mkdirSync(directory, { mode: 0o755 }); // EEXIST refuses unexpected replacement.
  return retained;
}

export function pruneGeneratedOutputs(root, relative) {
  if (!["dist", "dist/kiro-agent-closure"].includes(relative)) throw new Error("Unsupported generated output scope");
  const guard = captureDirectoryAncestry(root), cache = path.join(guard.root, ".tmp");
  if (!lstat(cache)) return;
  const cacheGuard = captureDirectoryAncestry(cache), cacheStat = fs.lstatSync(cache);
  if (cacheStat.uid !== process.getuid() || (cacheStat.mode & 0o7777) !== 0o700) throw new Error("Build retention requires a private .tmp directory");
  const receipt = currentReceipt(cache, relative);
  const previous = lstat(receipt);
  if (previous && !readReceipt(receipt, guard.root, relative)) {
    console.error(`Preserved unrecognized build receipt: ${receipt}`);
    return;
  }
  const snapshot = digest(inspect(path.join(guard.root, relative)));
  guard.check(); cacheGuard.check();
  if (previous ? identity(lstat(receipt)) !== identity(previous) : lstat(receipt) !== null) throw new Error("Build receipt changed; preserve output");
  const descriptor = fs.openSync(receipt, fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW | (previous ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL), 0o600);
  try {
    if (previous && identity(fs.fstatSync(descriptor, { bigint: true })) !== identity(previous)) throw new Error("Build receipt changed; preserve output");
    fs.ftruncateSync(descriptor, 0);
    fs.writeFileSync(descriptor, JSON.stringify({ schemaVersion: 1, root: guard.root, source: relative, snapshot }));
  } finally { fs.closeSync(descriptor); }
  const candidates = [];
  for (const name of readDirectoryBoundedSync(cache, MAX_ENTRIES).filter(name => /^generated-output-[A-Za-z0-9]+$/u.test(name))) {
    const directory = path.join(cache, name);
    try {
      const snapshot = inspect(directory);
      if (JSON.stringify(fs.readdirSync(directory).sort()) !== JSON.stringify(["output", "retention.json"])) continue;
      const receipt = path.join(directory, "retention.json");
      if (fs.lstatSync(receipt).size > 4096) continue;
      const record = JSON.parse(fs.readFileSync(receipt, "utf8"));
      if (record.schemaVersion !== 1 || record.root !== guard.root || record.source !== relative || !Number.isSafeInteger(record.createdAt) || record.snapshot !== digest(inspect(path.join(directory, "output")))) continue;
      candidates.push({ directory, snapshot, createdAt: record.createdAt });
    } catch (error) {
      console.error(`Retained ${directory}: ${error.message}`);
    }
  }
  candidates.sort((a, b) => b.createdAt - a.createdAt || a.directory.localeCompare(b.directory));
  for (const candidate of candidates.slice(RETAIN_GENERATIONS)) {
    try {
      guard.check(); cacheGuard.check();
      removeOwnedTree(candidate.directory, candidate.snapshot);
    } catch (error) {
      console.error(`Retained ${candidate.directory}: ${error.message}`);
    }
  }
}
