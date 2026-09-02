#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedFiles = [
  "dist/index.js",
  "dist/chunks/*.js",
  "dist/runtime/compiler-worker-entry.js",
  "dist/**/*.d.ts",
  "dist/kiro-power-closure/**/*",
  "plugin.json",
  "mcp.json",
  "power-product.json",
  "skills/fabric-exec/**/*",
  "docs/architecture.md",
  "docs/audit.md",
  "docs/configuration.md",
  "docs/release.md",
  "docs/tracing.md",
  "README.md",
  "STATUS.md",
  "SECURITY.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
];

const readJson = (root, name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const assertPackagePolicy = (root = repositoryRoot) => {
  const pkg = readJson(root, "package.json");
  const plugin = readJson(root, "plugin.json");
  const mcp = readJson(root, "mcp.json");
  const product = readJson(root, "power-product.json");

  if (pkg.bin !== undefined) throw new Error("The Power-only package must not publish session wrappers");
  if (pkg.main !== "./dist/index.js" || pkg.types !== "./dist/index.d.ts") {
    throw new Error("Package root runtime or declaration entry drifted");
  }
  if (!equal(pkg.exports, { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } })) {
    throw new Error("Only the minimal root runtime API may be exported");
  }
  if (!equal(pkg.files, expectedFiles)) throw new Error("Published file allowlist drifted");
  if (plugin.name !== "kiro-fabric" || plugin.version !== pkg.version) {
    throw new Error("Power manifest identity or version drifted");
  }
  if (product.product !== "kiro-fabric-power" || product.entrypoint !== "src/kiro/mcp-entry.ts") {
    throw new Error("Power product entrypoint drifted");
  }
  if (!equal(product.mountedProviders, ["artifacts", "memory", "state", "mcp"])) {
    throw new Error("Mounted provider contract drifted");
  }
  const dependencies = Object.keys(pkg.dependencies ?? {}).sort();
  if (!equal(dependencies, [...product.allowedPackageDependencies].sort())) {
    throw new Error("Runtime dependencies drifted from power-product.json");
  }
  const servers = mcp.mcpServers;
  const expectedServer = {
    type: "stdio",
    command: "node",
    args: ["${PLUGIN_ROOT}/dist/kiro-power-closure/kiro/mcp-entry.js"],
    cwd: "${PLUGIN_ROOT}",
  };
  if (!servers || !equal(Object.keys(servers), ["fabric"]) || !equal(servers.fabric, expectedServer)) {
    throw new Error("Root MCP manifest must expose one exact mode-free Fabric server");
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) assertPackagePolicy();
