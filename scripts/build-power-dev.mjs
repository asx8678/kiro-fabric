#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { digestPowerPackage, validatePowerPackage } from "./validate-power-package.mjs";

if (process.platform !== "linux") throw new Error("Checkout-local Power staging is currently supported only on Linux");
const temporaryRoot = path.resolve(".tmp");
fs.mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
const temporaryStats = fs.lstatSync(temporaryRoot);
if (!temporaryStats.isDirectory() || temporaryStats.isSymbolicLink() ||
    (typeof process.getuid === "function" && temporaryStats.uid !== process.getuid()) ||
    (temporaryStats.mode & 0o077) !== 0) throw new Error(".tmp must be a private current-user-owned checkout-local directory");
const parent = fs.realpathSync(temporaryRoot);
const stable = path.join(parent, "kiro-fabric-power");
const token = `${process.pid}-${randomBytes(12).toString("hex")}`;
const building = path.join(parent, `.kiro-fabric-power-building-${token}`);
const link = path.join(parent, `.kiro-fabric-power-link-${token}`);
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
  } else {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
  }
};
try {
  fs.mkdirSync(building, { mode: 0o700 });
  for (const file of ["plugin.json", "power-product.json"]) copy(file, path.join(building, file));
  fs.writeFileSync(path.join(building, "package.json"), `${JSON.stringify({ name: packageJson.name, version: packageJson.version, type: "module", private: true }, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(building, "mcp.json"), `${JSON.stringify(mcp, null, 2)}\n`, { mode: 0o600 });
  copy("dist/kiro-power-closure", path.join(building, "runtime"));
  fs.mkdirSync(path.join(building, "skills"), { mode: 0o700 });
  copy("skills/fabric-exec", path.join(building, "skills", "fabric-exec"));
  const result = validatePowerPackage(building);
  const digest = digestPowerPackage(building, { excludeOwner: true }).digest;
  const generation = path.join(parent, `.kiro-fabric-power-generation-${digest}`);
  if (fs.existsSync(generation)) {
    const existing = digestPowerPackage(generation, { excludeOwner: true });
    if (existing.digest !== digest) throw new Error("Existing staged generation digest mismatch");
    fs.rmSync(building, { recursive: true });
  } else fs.renameSync(building, generation);
  fs.symlinkSync(path.basename(generation), link, "dir");
  try {
    const current = fs.lstatSync(stable);
    if (!current.isSymbolicLink()) {
      validatePowerPackage(stable);
      fs.renameSync(stable, path.join(parent, `.kiro-fabric-power-legacy-${token}`));
    }
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
  fs.renameSync(link, stable);
  const directory = fs.openSync(parent, "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  process.stdout.write(`${JSON.stringify({ ...result, root: stable, generation, digest })}\n${stable}\n`);
} catch (error) {
  try { if (fs.lstatSync(building).isDirectory()) fs.rmSync(building, { recursive: true }); } catch { /* best effort for our unactivated private path */ }
  try { fs.unlinkSync(link); } catch { /* absent */ }
  throw error;
}
