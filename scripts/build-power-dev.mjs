#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validatePowerPackage } from "./validate-power-package.mjs";
const root = path.resolve(".tmp/kiro-fabric-power");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true, mode: 0o700 });
for (const file of ["plugin.json", "package.json"]) cpSync(file, path.join(root, file));
cpSync("skills", path.join(root, "skills"), { recursive: true });
cpSync("dist/kiro-closure", path.join(root, "runtime"), { recursive: true });
const mcp = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  mcpServers: { fabric: {
    type: "stdio", command: "node",
    args: ["${PLUGIN_ROOT}/runtime/kiro/mcp-entry.js", "--integration", "power"],
    cwd: "${PLUGIN_ROOT}", env: { KIRO_FABRIC_INTEGRATION: "power" },
  } },
};
writeFileSync(path.join(root, "mcp.json"), JSON.stringify(mcp, null, 2) + "\n", { mode: 0o600 });
validatePowerPackage(root);
process.stdout.write(`${root}\nImport this local folder in Kiro IDE as a custom Power.\n`);
