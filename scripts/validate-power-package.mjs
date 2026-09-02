#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const PLUGIN_FIELDS = new Set(["$schema", "name", "version", "description", "author", "keywords", "homepage", "repository", "license", "extensions"]);
const MCP_FIELDS = new Set(["$schema", "mcpServers"]);
const STDIO_FIELDS = new Set(["type", "command", "args", "cwd", "env"]);
const SKILL_FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
const KEBAB_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const fail = (message) => { throw new Error(`invalid Kiro Power package: ${message}`); };
const json = (file) => JSON.parse(readFileSync(file, "utf8"));

const skillFrontmatter = (file) => {
  const content = readFileSync(file, "utf8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) fail(`${file} has no YAML frontmatter`);
  let metadata;
  try {
    metadata = parseYaml(match[1]);
  } catch (error) {
    fail(`${file} has invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) fail(`${file} frontmatter must be a mapping`);
  return { content, metadata };
};

const activationTerms = (description) => {
  const positive = description.split(/\b(?:do not|never)\b/iu, 1)[0] ?? description;
  const ignored = new Set(["use", "when", "changing", "change", "kiro", "fabric", "the", "a", "an", "or", "and", "for", "to", "of", "with"]);
  return new Set((positive.toLowerCase().match(/[a-z0-9]+/gu) ?? [])
    .filter((term) => term.length > 2 && !ignored.has(term)));
};

export const validateSkillTree = (skills, packageRoot = path.dirname(skills)) => {
  const entries = readdirSync(skills, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  if (!entries.length) fail("skills directory is empty");
  const parsed = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail(`skills/${entry.name} is not a regular directory`);
    if (!KEBAB_NAME.test(entry.name)) fail(`skills/${entry.name} is not a kebab-case skill directory`);
    const file = path.join(skills, entry.name, "SKILL.md");
    let stats;
    try { stats = lstatSync(file); } catch { fail(`skills/${entry.name}/SKILL.md is absent`); }
    if (!stats.isFile() || stats.isSymbolicLink()) fail(`skills/${entry.name}/SKILL.md is absent or is a symlink`);
    const { content, metadata } = skillFrontmatter(file);
    for (const key of Object.keys(metadata)) if (!SKILL_FIELDS.has(key)) fail(`skills/${entry.name}/SKILL.md has unsupported portable field ${key}`);
    if (metadata.name !== entry.name || !KEBAB_NAME.test(String(metadata.name ?? ""))) {
      fail(`skills/${entry.name}/SKILL.md name must match its directory`);
    }
    if (typeof metadata.description !== "string" || !metadata.description.trim()) fail(`skills/${entry.name}/SKILL.md description is required`);
    for (const field of ["license", "compatibility", "allowed-tools"]) {
      if (metadata[field] !== undefined && typeof metadata[field] !== "string") fail(`skills/${entry.name}/SKILL.md field ${field} must be a string`);
    }
    if (metadata.metadata !== undefined && (!metadata.metadata || typeof metadata.metadata !== "object" || Array.isArray(metadata.metadata)
      || Object.values(metadata.metadata).some((value) => typeof value !== "string"))) {
      fail(`skills/${entry.name}/SKILL.md metadata must map strings to strings`);
    }
    if (!/\buse when\b/iu.test(metadata.description)) fail(`skills/${entry.name}/SKILL.md description needs a positive "Use when" condition`);
    if (!/\b(?:do not|never) use\b/iu.test(metadata.description)) fail(`skills/${entry.name}/SKILL.md description needs a meaningful exclusion`);
    for (const match of content.matchAll(/\breferences\/([a-z0-9][a-z0-9._/-]*\.md)\b/giu)) {
      const reference = path.resolve(path.dirname(file), "references", match[1]);
      const relative = path.relative(path.dirname(file), reference);
      if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail(`${file} reference escapes its skill: ${match[0]}`);
      let referenceStats;
      try { referenceStats = lstatSync(reference); } catch { fail(`${file} references missing file ${match[0]}`); }
      if (!referenceStats.isFile() || referenceStats.isSymbolicLink()) fail(`${file} reference is not a regular file: ${match[0]}`);
    }
    parsed.push({ name: entry.name, description: metadata.description, terms: activationTerms(metadata.description) });
  }
  for (let leftIndex = 0; leftIndex < parsed.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < parsed.length; rightIndex += 1) {
      const left = parsed[leftIndex];
      const right = parsed[rightIndex];
      const normalizedLeft = left.description.toLowerCase().replace(/\s+/gu, " ").trim();
      const normalizedRight = right.description.toLowerCase().replace(/\s+/gu, " ").trim();
      const shared = [...left.terms].filter((term) => right.terms.has(term)).length;
      const overlap = shared / Math.max(1, Math.min(left.terms.size, right.terms.size));
      if (normalizedLeft === normalizedRight || overlap >= 0.8) {
        fail(`skills/${left.name} and skills/${right.name} have dangerously overlapping activation descriptions`);
      }
    }
  }
  return { entries, skills: parsed.map(({ name }) => name), packageRoot };
};

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
  const fabric = mcp.mcpServers.fabric;
  if (fabric?.command !== "node") fail("fabric MCP must use the bundled Node runtime closure");
  const launcher = fabric.args?.[0];
  const allowedLaunchers = [
    "${PLUGIN_ROOT}/dist/kiro-power-closure/kiro/mcp-entry.js",
    "${PLUGIN_ROOT}/runtime/kiro/mcp-entry.js",
  ];
  if (!allowedLaunchers.includes(launcher)) fail("fabric MCP launcher is not a bundled closure entry");
  const launcherPath = path.join(root, launcher.slice("${PLUGIN_ROOT}/".length));
  const launcherStats = lstatSync(launcherPath);
  if (!launcherStats.isFile() || launcherStats.isSymbolicLink()) {
    fail("fabric MCP bundled closure entry is absent or is a symlink");
  }
  const skills = path.join(root, "skills");
  const validatedSkills = validateSkillTree(skills, root);
  const visit = (directory) => { for (const entry of readdirSync(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); if (entry.isSymbolicLink()) fail(`symlink is not allowed: ${path.relative(root, target)}`); if (entry.isDirectory()) visit(target); else if (!entry.isFile()) fail(`non-file package entry: ${path.relative(root, target)}`); } };
  for (const file of ["plugin.json", "mcp.json", "package.json"]) if (!lstatSync(path.join(root, file)).isFile()) fail(`${file} is not a regular file`);
  visit(skills);
  const runtime = path.dirname(path.dirname(launcherPath));
  const runtimeStats = lstatSync(runtime);
  if (!runtimeStats.isDirectory() || runtimeStats.isSymbolicLink()) {
    fail("fabric MCP runtime closure is not a regular directory");
  }
  visit(runtime);
  return { ok: true, root, version: pkg.version, skills: validatedSkills.entries.length };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { const result = validatePowerPackage(process.argv[2] ?? process.cwd()); console.log(JSON.stringify(result)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
