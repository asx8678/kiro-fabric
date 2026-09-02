#!/usr/bin/env node
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  installPowerPackage,
  resolveUserPowerRoot,
  shouldInstallUserPower,
} from "./power-user-install.mjs";
import { validatePowerPackage } from "./validate-power-package.mjs";
const root = path.resolve(".tmp/kiro-fabric-power");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true, mode: 0o700 });
for (const file of ["plugin.json", "package.json"]) cpSync(file, path.join(root, file));
mkdirSync(path.join(root, "skills"), { mode: 0o700 });
// Package a skill only when it carries a real SKILL.md. This mirrors the
// validator's contract and keeps stale, untracked, or half-removed local
// directories (e.g. skills/fabric-advisor) from contaminating the package.
for (const skill of readdirSync("skills", { withFileTypes: true })) {
  if (!skill.isDirectory()) continue;
  const markdown = path.join("skills", skill.name, "SKILL.md");
  try { if (!statSync(markdown).isFile()) continue; } catch { continue; }
  cpSync(path.join("skills", skill.name), path.join(root, "skills", skill.name), { recursive: true });
}
cpSync("dist/kiro-power-closure", path.join(root, "runtime"), { recursive: true });
const mcp = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  mcpServers: { fabric: {
    type: "stdio", command: "node",
    args: ["${PLUGIN_ROOT}/runtime/kiro/mcp-entry.js"],
    cwd: "${PLUGIN_ROOT}", env: { KIRO_FABRIC_INTEGRATION: "power" },
  } },
};
writeFileSync(path.join(root, "mcp.json"), JSON.stringify(mcp, null, 2) + "\n", { mode: 0o600 });
validatePowerPackage(root);
const lines = [root];
if (shouldInstallUserPower()) {
  const userRoot = installPowerPackage(root, resolveUserPowerRoot());
  lines.push(userRoot);
  process.stdout.write(
    `${lines.join("\n")}\nStaged a checkout copy and installed the user-global Power at ` +
    `${userRoot}. Import that folder in Kiro IDE as a custom Power if this is the first ` +
    `install; later power:dev runs refresh it in place. Kiro CLI v3 picks up IDE-installed ` +
    `Powers; from this source checkout launch with node dist/kiro/setup-entry.js launch-power.\n`,
  );
} else {
  process.stdout.write(
    `${root}\nSkipped user-global Power install (KIRO_FABRIC_SKIP_USER_POWER_INSTALL=1). ` +
    `Import this local folder in Kiro IDE as a custom Power.\n`,
  );
}
