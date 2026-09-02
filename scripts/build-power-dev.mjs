#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validatePowerPackage } from "./validate-power-package.mjs";

if (process.platform !== "linux") throw new Error("Checkout-local Power staging is currently supported only on Linux");
const sleepSync = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
const errorCode = (error) => error?.code;
const processIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
};
const identity = (stats) => ({ dev: stats.dev, ino: stats.ino });
const sameIdentity = (stats, expected) => stats.dev === expected.dev && stats.ino === expected.ino;
const fsyncDirectory = (directory) => { const descriptor = fs.openSync(directory, "r"); try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); } };

const temporaryRoot = path.resolve(".tmp");
fs.mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
const temporaryStats = fs.lstatSync(temporaryRoot);
if (!temporaryStats.isDirectory() || temporaryStats.isSymbolicLink() ||
    (typeof process.getuid === "function" && temporaryStats.uid !== process.getuid()) ||
    (temporaryStats.mode & 0o077) !== 0) throw new Error(".tmp must be a private current-user-owned checkout-local directory");
const parent = fs.realpathSync(temporaryRoot);
const stable = path.join(parent, "kiro-fabric-power");
const lock = path.join(parent, ".kiro-fabric-power-publication.lock");

const acquireLock = () => {
  const deadline = performance.now() + 60_000;
  while (true) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      const lockStats = fs.lstatSync(lock);
      const token = randomBytes(24).toString("hex");
      const owner = path.join(lock, "owner.json");
      fs.writeFileSync(owner, `${JSON.stringify({ pid: process.pid, token, acquiredAt: Date.now() })}\n`, { mode: 0o600, flag: "wx" });
      return { token, lock: identity(lockStats), owner: identity(fs.lstatSync(owner)) };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const stats = fs.lstatSync(lock);
      if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o077) !== 0) throw new Error("Power staging publication lock is foreign");
      if (Date.now() - stats.mtimeMs > 30_000) {
        let pid = 0;
        try { pid = JSON.parse(fs.readFileSync(path.join(lock, "owner.json"), "utf8")).pid; } catch { /* old malformed locks are reclaimable */ }
        if (!processIsAlive(pid)) {
          const current = fs.lstatSync(lock);
          if (sameIdentity(current, identity(stats))) {
            try { fs.rmSync(path.join(lock, "owner.json"), { force: true }); fs.rmdirSync(lock); continue; } catch { /* retry */ }
          }
        }
      }
      if (performance.now() >= deadline) throw new Error("Timed out waiting for Power staging publication lock");
      sleepSync(20);
    }
  }
};
const releaseLock = (held) => {
  try {
    const lockStats = fs.lstatSync(lock); const ownerPath = path.join(lock, "owner.json"); const ownerStats = fs.lstatSync(ownerPath);
    if (!sameIdentity(lockStats, held.lock) || !sameIdentity(ownerStats, held.owner)) return;
    const marker = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    if (marker.pid !== process.pid || marker.token !== held.token) return;
    fs.unlinkSync(ownerPath); fs.rmdirSync(lock);
  } catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(errorCode(error))) throw error; }
};

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const mcp = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  mcpServers: { fabric: { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/runtime/kiro/mcp-entry.js"], cwd: "${PLUGIN_ROOT}" } },
};
const copy = (source, target) => {
  const stats = fs.lstatSync(source);
  if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile()) || (stats.isFile() && stats.nlink !== 1)) throw new Error(`Unsupported staged source entry: ${source}`);
  if (stats.isDirectory()) {
    fs.mkdirSync(target, { mode: 0o700 });
    for (const entry of fs.readdirSync(source).sort()) copy(path.join(source, entry), path.join(target, entry));
    fs.chmodSync(target, 0o700);
  } else {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
  }
};

const held = acquireLock();
const token = `${process.pid}-${randomBytes(12).toString("hex")}`;
const building = path.join(parent, `.kiro-fabric-power-building-${token}`);
const link = path.join(parent, `.kiro-fabric-power-link-${token}`);
let buildingIdentity;
try {
  fs.mkdirSync(building, { mode: 0o700 });
  buildingIdentity = identity(fs.lstatSync(building));
  for (const file of ["plugin.json", "power-product.json"]) copy(file, path.join(building, file));
  fs.writeFileSync(path.join(building, "package.json"), `${JSON.stringify({ name: packageJson.name, version: packageJson.version, type: "module", private: true }, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(building, "mcp.json"), `${JSON.stringify(mcp, null, 2)}\n`, { mode: 0o600 });
  copy("dist/kiro-power-closure", path.join(building, "runtime"));
  fs.mkdirSync(path.join(building, "skills"), { mode: 0o700 });
  copy("skills/fabric-exec", path.join(building, "skills", "fabric-exec"));
  const result = validatePowerPackage(building);
  const digest = result.digest;
  const generation = path.join(parent, `.kiro-fabric-power-generation-${digest}`);
  if (fs.existsSync(generation)) {
    const existing = validatePowerPackage(generation);
    if (existing.digest !== digest || existing.files !== result.files || existing.bytes !== result.bytes) throw new Error("Existing staged generation evidence mismatch");
    const current = fs.lstatSync(building);
    if (sameIdentity(current, buildingIdentity)) fs.rmSync(building, { recursive: true });
    buildingIdentity = undefined;
  } else {
    fs.renameSync(building, generation);
    buildingIdentity = undefined;
    fsyncDirectory(parent);
  }
  fs.symlinkSync(path.basename(generation), link, "dir");
  try {
    const current = fs.lstatSync(stable);
    if (!current.isSymbolicLink()) {
      validatePowerPackage(stable);
      fs.renameSync(stable, path.join(parent, `.kiro-fabric-power-legacy-${token}`));
    }
  } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
  fs.renameSync(link, stable);
  fsyncDirectory(parent);
  if (fs.realpathSync(stable) !== fs.realpathSync(generation)) throw new Error("Stable Power staging pointer changed during publication");
  process.stdout.write(`${JSON.stringify({ ...result, root: stable, generation, digest })}\n${stable}\n`);
} catch (error) {
  try { const current = fs.lstatSync(building); if (buildingIdentity && sameIdentity(current, buildingIdentity)) fs.rmSync(building, { recursive: true }); } catch { /* absent or substituted */ }
  try { fs.unlinkSync(link); } catch { /* absent */ }
  throw error;
} finally {
  releaseLock(held);
}
