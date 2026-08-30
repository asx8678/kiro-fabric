#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const PLUGIN_FIELDS = new Set(["$schema", "name", "version", "description", "author", "keywords", "homepage", "repository", "license", "extensions"]);
const MCP_FIELDS = new Set(["$schema", "mcpServers"]);
const STDIO_FIELDS = new Set(["type", "command", "args", "cwd", "env"]);
const fail = (message) => { throw new Error(`invalid Kiro Power package: ${message}`); };
const json = (file) => JSON.parse(readFileSync(file, "utf8"));

export const validatePowerPackage = (root) => {
  root = realpathSync(path.resolve(root));
  const pkg = json(path.join(root, "package.json"));
  const plugin = json(path.join(root, "plugin.json"));
  const mcp = json(path.join(root, "mcp.json"));
  if (plugin.$schema !== PLUGIN_SCHEMA || mcp.$schema !== MCP_SCHEMA) fail("schema versions must be Agent Plugins 1.0.0");
  for (const key of Object.keys(plugin)) if (!PLUGIN_FIELDS.has(key)) fail(`unknown plugin.json field ${key}`);
  for (const key of Object.keys(mcp)) if (!MCP_FIELDS.has(key)) fail(`unknown mcp.json field ${key}`);
  if (!/^[a-z0-9](?!.*(?:--|\.\.\.))[a-z0-9.-]{0,62}[a-z0-9]$/.test(plugin.name)) fail("invalid plugin name");
  if (plugin.version !== pkg.version) fail("plugin and package versions differ");
  if (!plugin.description || !plugin.author?.name || !Array.isArray(plugin.keywords) || !plugin.keywords.length) fail("required Kiro metadata is absent");
  const servers = mcp.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers) || !Object.keys(servers).length) fail("mcpServers is empty");
  for (const [name, server] of Object.entries(servers)) {
    if (!server || typeof server !== "object" || Array.isArray(server)) fail(`${name} is not an object`);
    for (const key of Object.keys(server)) if (!STDIO_FIELDS.has(key)) fail(`${name} has unknown field ${key}`);
    if (server.type !== "stdio") fail(`${name} is not stdio`);
    if (typeof server.command !== "string" || /\s/.test(server.command) || !(server.command.startsWith("./") || /^[A-Za-z0-9_.-]+$/.test(server.command))) fail(`${name} command must be one executable token`);
    if (server.command.includes("${")) fail(`${name} command contains a placeholder`);
    if (!Array.isArray(server.args) || server.args.some((value) => typeof value !== "string")) fail(`${name} args must be strings`);
    if (typeof server.cwd !== "string" || !["${PLUGIN_ROOT}", "${PLUGIN_DATA}"].some((base) => server.cwd === base || server.cwd.startsWith(base + "/"))) fail(`${name} cwd escapes plugin storage`);
    for (const value of [...server.args, server.cwd, ...Object.values(server.env ?? {})]) {
      for (const placeholder of String(value).matchAll(/\$\{([^}]+)\}/g)) {
        if (placeholder[1] !== "PLUGIN_ROOT" && placeholder[1] !== "PLUGIN_DATA") fail(`${name} uses unsupported placeholder ${placeholder[0]}`);
      }
    }
    if (server.env !== undefined && (!server.env || typeof server.env !== "object" || Array.isArray(server.env))) fail(`${name} env must be an object`);
    for (const [key, value] of Object.entries(server.env ?? {})) {
      if (/PLUGIN_(?:ROOT|DATA)/i.test(key)) fail(`${name} overrides reserved ${key}`);
      if (/(TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION|COOKIE)/i.test(key) || /(bearer\s+|-----BEGIN|api[_-]?key)/i.test(String(value))) fail(`${name} contains secret-looking environment data`);
    }
  }
  const releaseSpec = mcp.mcpServers.fabric?.args?.find((value) => typeof value === "string" && value.startsWith(`${pkg.name}@`));
  if (mcp.mcpServers.fabric?.command === "npx" && !releaseSpec) fail("release npx launcher is missing an exact package spec");
  if (releaseSpec && releaseSpec !== `${pkg.name}@${pkg.version}`) fail("MCP npm spec is not exact package version");
  const skills = path.join(root, "skills");
  const entries = readdirSync(skills, { withFileTypes: true });
  if (!entries.length) fail("skills directory is empty");
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail(`skills/${entry.name} is not a regular directory`);
    if (!lstatSync(path.join(skills, entry.name, "SKILL.md")).isFile()) fail(`skills/${entry.name}/SKILL.md is absent`);
  }
  const visit = (directory) => { for (const entry of readdirSync(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); if (entry.isSymbolicLink()) fail(`symlink is not allowed: ${path.relative(root, target)}`); if (entry.isDirectory()) visit(target); else if (!entry.isFile()) fail(`non-file package entry: ${path.relative(root, target)}`); } };
  for (const file of ["plugin.json", "mcp.json", "package.json"]) if (!lstatSync(path.join(root, file)).isFile()) fail(`${file} is not a regular file`);
  visit(skills);
  try { const runtime = path.join(root, "runtime"); if (lstatSync(runtime).isDirectory()) visit(runtime); } catch { /* release package uses npm launcher */ }
  return { ok: true, root, version: pkg.version, skills: entries.length };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { const result = validatePowerPackage(process.argv[2] ?? process.cwd()); console.log(JSON.stringify(result)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
