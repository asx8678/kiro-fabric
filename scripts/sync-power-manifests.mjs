#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const plugin = JSON.parse(readFileSync("plugin.json", "utf8"));
const mcp = JSON.parse(readFileSync("mcp.json", "utf8"));
plugin.version = pkg.version;
const args = mcp.mcpServers?.fabric?.args;
if (!Array.isArray(args)) throw new Error("mcp.json has no fabric args");
const index = args.findIndex((value) => typeof value === "string" && value.startsWith(`${pkg.name}@`));
if (index < 0) throw new Error("mcp.json has no package spec");
args[index] = `${pkg.name}@${pkg.version}`;
writeFileSync("plugin.json", JSON.stringify(plugin, null, 2) + "\n", { mode: 0o644 });
writeFileSync("mcp.json", JSON.stringify(mcp, null, 2) + "\n", { mode: 0o644 });
