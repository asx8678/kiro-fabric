#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { validatePowerPackage } from "./validate-power-package.mjs";

const temporaryRoot = path.resolve(".tmp");
fs.mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
const temporaryStats = fs.lstatSync(temporaryRoot);
if (!temporaryStats.isDirectory() || temporaryStats.isSymbolicLink()) {
  throw new Error(".tmp must be a regular checkout-local directory");
}
if (process.platform !== "win32" && typeof process.getuid === "function" && temporaryStats.uid !== process.getuid()) {
  throw new Error(".tmp must be owned by the current user");
}
fs.chmodSync(temporaryRoot, 0o700);
const root = path.join(fs.realpathSync(temporaryRoot), "kiro-fabric-power");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const mcp = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  mcpServers: { fabric: { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/runtime/kiro/mcp-entry.js"], cwd: "${PLUGIN_ROOT}" } },
};
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
for (const file of ["plugin.json", "power-product.json"]) fs.copyFileSync(file, path.join(root, file));
fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name: packageJson.name, version: packageJson.version, type: "module", private: true }, null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(root, "mcp.json"), `${JSON.stringify(mcp, null, 2)}\n`, { mode: 0o600 });
fs.cpSync("dist/kiro-power-closure", path.join(root, "runtime"), { recursive: true });
fs.mkdirSync(path.join(root, "skills"), { mode: 0o700 });
fs.cpSync("skills/fabric-exec", path.join(root, "skills", "fabric-exec"), { recursive: true });
const makePrivate = (directory) => {
  fs.chmodSync(directory, 0o700);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) makePrivate(target);
    else if (entry.isFile()) fs.chmodSync(target, 0o600);
    else throw new Error(`Unsupported staged package entry: ${target}`);
  }
};
makePrivate(root);
const result = validatePowerPackage(root);
process.stdout.write(`${JSON.stringify(result)}\n${root}\n`);
