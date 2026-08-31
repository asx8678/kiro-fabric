#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const plugin = JSON.parse(readFileSync("plugin.json", "utf8"));
const mcp = JSON.parse(readFileSync("mcp.json", "utf8"));
plugin.version = pkg.version;
const server = mcp.mcpServers?.fabric;
if (server?.command !== "node" ||
    !server.args?.includes("${PLUGIN_ROOT}/dist/kiro-closure/kiro/mcp-entry.js")) {
  throw new Error("mcp.json must launch the bundled Kiro closure");
}
writeFileSync("plugin.json", JSON.stringify(plugin, null, 2) + "\n", { mode: 0o644 });
writeFileSync("mcp.json", JSON.stringify(mcp, null, 2) + "\n", { mode: 0o644 });
