#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const allowedRootEntries = new Set(["plugin.json", "mcp.json", "package.json", "power-product.json", "runtime", "skills", ".kiro-fabric-power-owner.json"]);
const legacyHost = String.fromCodePoint(112, 105);
const forbiddenTerms = [
  `@earendil-works/${legacyHost}-`, `@mariozechner/${legacyHost}-`,
  `PI_CODING_${"AGENT"}_DIR`, `managed-${"main"}`, `internal-${"child"}`,
  `kiro-fabric-${"dev"}`, `node-${"process"}-runtime`, `agent-${"worker"}-entry`,
  `management-${"entry"}`, String.fromCodePoint(960),
];
const fail = (message) => { throw new Error(`invalid Kiro Power package: ${message}`); };
const json = (file) => {
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > 2 * 1024 * 1024) {
    fail(`JSON input is not a bounded single-link file: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
};
const exactKeys = (value, keys) =>
  value && typeof value === "object" && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const normalized = (value) => value.replaceAll("\\", "/");
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packageRoot = (inputRoot) => {
  const lexical = path.resolve(inputRoot);
  const lexicalStats = fs.lstatSync(lexical);
  if (lexicalStats.isSymbolicLink()) {
    const target = fs.readlinkSync(lexical);
    if (path.isAbsolute(target) || target.includes(path.sep) || !target.startsWith(".kiro-fabric-power-generation-")) fail("root symlink is not an approved checkout-local staging pointer");
    const resolved = fs.realpathSync(lexical);
    if (path.dirname(resolved) !== fs.realpathSync(path.dirname(lexical))) fail("staging pointer escapes its checkout-local parent");
    return resolved;
  }
  return lexical;
};

export const walkPackage = (inputRoot) => {
  const root = packageRoot(inputRoot);
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      const stats = fs.lstatSync(target);
      if (stats.isSymbolicLink()) fail(`symlink is not allowed: ${path.relative(root, target)}`);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(target);
      else fail(`unsupported entry: ${path.relative(root, target)}`);
    }
  };
  visit(root);
  return files;
};

export const digestPowerPackage = (inputRoot, options = {}) => {
  const root = packageRoot(inputRoot);
  const digest = createHash("sha256");
  const files = walkPackage(root).filter((file) => !(options.excludeOwner && path.basename(file) === ".kiro-fabric-power-owner.json"));
  for (const file of files) {
    const relative = normalized(path.relative(root, file));
    const content = fs.readFileSync(file);
    const mode = fs.statSync(file).mode & 0o777;
    digest.update(relative).update("\0").update(String(mode)).update("\0").update(content);
  }
  return { digest: digest.digest("hex"), files: files.length, bytes: files.reduce((sum, file) => sum + fs.statSync(file).size, 0) };
};

export const validatePowerPackage = (inputRoot) => {
  const rootPath = packageRoot(inputRoot);
  const rootStat = fs.lstatSync(rootPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("root must resolve to a regular directory");
  if (process.platform !== "win32") {
    if (typeof process.getuid === "function" && rootStat.uid !== process.getuid()) fail("root must be owned by the current user");
    if ((rootStat.mode & 0o077) !== 0) fail("root permissions must be private");
  }
  const root = fs.realpathSync(rootPath);
  if (process.platform !== "win32") {
    const inspectPermissions = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        const stats = fs.lstatSync(target);
        if ((stats.mode & 0o077) !== 0) fail(`entry permissions must be private: ${path.relative(root, target)}`);
        if (typeof process.getuid === "function" && stats.uid !== process.getuid()) fail(`entry is owned by another user: ${path.relative(root, target)}`);
        if (entry.isDirectory()) inspectPermissions(target);
      }
    };
    inspectPermissions(root);
  }
  const packageFiles = walkPackage(root);
  if (packageFiles.length > 500) fail("package file-count bound exceeded");
  let packageBytes = 0;
  for (const file of packageFiles) {
    const bytes = fs.lstatSync(file).size;
    if (bytes > 16 * 1024 * 1024) fail(`package file-size bound exceeded: ${path.relative(root, file)}`);
    packageBytes += bytes;
  }
  if (packageBytes > 64 * 1024 * 1024) fail("package byte bound exceeded");
  for (const entry of fs.readdirSync(root)) if (!allowedRootEntries.has(entry)) fail(`unexpected package root entry: ${entry}`);
  for (const required of ["plugin.json", "mcp.json", "package.json", "power-product.json", "runtime", "skills"]) if (!fs.existsSync(path.join(root, required))) fail(`${required} is absent`);
  const pkg = json(path.join(root, "package.json"));
  const plugin = json(path.join(root, "plugin.json"));
  const mcp = json(path.join(root, "mcp.json"));
  const product = json(path.join(root, "power-product.json"));
  if (!exactKeys(pkg, ["name", "version", "type", "private"]) || pkg.name !== "kiro-fabric" || pkg.type !== "module" || pkg.private !== true) {
    fail("staged package metadata drifted");
  }
  if (!exactKeys(plugin, ["$schema", "name", "version", "description", "author", "keywords", "homepage", "repository", "license"]) ||
      plugin.name !== "kiro-fabric" || plugin.version !== pkg.version) {
    fail("plugin identity or capabilities drifted");
  }
  const authoritativeProduct = json(path.join(repositoryRoot, "power-product.json"));
  if (!exactKeys(product, ["$schema", "schemaVersion", "product", "entrypoint", "runtimeAssets", "mountedProviders", "allowedPackageDependencies", "forbiddenRuntimeModules"]) ||
      product.schemaVersion !== 1 || product.product !== "kiro-fabric-power" ||
      product.entrypoint !== "src/kiro/mcp-entry.ts" ||
      product.runtimeAssets?.compilerWorker !== "src/runtime/compiler-worker-entry.ts" ||
      JSON.stringify(product.mountedProviders) !== JSON.stringify(["artifacts", "memory", "state", "mcp"]) ||
      JSON.stringify(product.allowedPackageDependencies) !== JSON.stringify(authoritativeProduct.allowedPackageDependencies) ||
      JSON.stringify(product.forbiddenRuntimeModules) !== JSON.stringify(authoritativeProduct.forbiddenRuntimeModules)) {
    fail("Power product contract drifted");
  }
  if (!exactKeys(mcp, ["$schema", "mcpServers"])) fail("MCP manifest fields drifted");
  const servers = mcp.mcpServers;
  if (!servers || JSON.stringify(Object.keys(servers)) !== JSON.stringify(["fabric"])) fail("exactly one fabric MCP server is required");
  const server = servers.fabric;
  if (JSON.stringify(server) !== JSON.stringify({
    type: "stdio",
    command: "node",
    args: ["${PLUGIN_ROOT}/runtime/kiro/mcp-entry.js"],
    cwd: "${PLUGIN_ROOT}",
  })) fail("fabric MCP transport or entrypoint drifted");
  const skills = fs.readdirSync(path.join(root, "skills"), { withFileTypes: true });
  if (skills.length !== 1 || skills[0]?.name !== "fabric-exec" || !skills[0].isDirectory()) fail("exactly the fabric-exec skill must be packaged");
  const skillRoot = path.join(root, "skills", "fabric-exec");
  const skillFiles = walkPackage(skillRoot).map((file) => normalized(path.relative(skillRoot, file))).sort();
  if (JSON.stringify(skillFiles) !== JSON.stringify(["SKILL.md", "references/api.md"])) fail("fabric-exec skill file set drifted");
  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  if (!skill.startsWith("---\nname: fabric-exec\n") || !skill.includes("description:")) fail("fabric-exec skill metadata is invalid");

  const manifestPath = path.join(root, "runtime", "closure-manifest.json");
  const closure = json(manifestPath);
  if (closure.product !== "kiro-fabric-power" || closure.executor !== "quickjs" || closure.entrypoint !== "kiro/mcp-entry.js" ||
      closure.compilerWorker !== "runtime/compiler-worker-entry.js" || !Array.isArray(closure.sourceInputs) ||
      closure.sourceInputs.some((file) => product.forbiddenRuntimeModules.some((prefix) => file === prefix || file.startsWith(prefix))) ||
      !Array.isArray(closure.packageInputs) || closure.packageInputs.length > 256 ||
      closure.packageInputs.some((entry) => !exactKeys(entry, ["name", "version", "license"]) ||
        typeof entry.name !== "string" || !entry.name || typeof entry.version !== "string" || !entry.version ||
        typeof entry.license !== "string" || !entry.license)) {
    fail("closure identity, dependency inventory, or source boundary drifted");
  }
  const expected = new Set(closure.files.map((entry) => entry.path));
  const actualRuntime = walkPackage(path.join(root, "runtime"))
    .map((file) => normalized(path.relative(path.join(root, "runtime"), file)))
    .filter((file) => file !== "closure-manifest.json");
  if (JSON.stringify([...expected].sort()) !== JSON.stringify(actualRuntime.sort())) fail("closure file inventory is incomplete");
  const composite = createHash("sha256");
  for (const entry of [...closure.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const file = path.join(root, "runtime", entry.path);
    const content = fs.readFileSync(file);
    if (content.length !== entry.bytes || createHash("sha256").update(content).digest("hex") !== entry.sha256) fail(`closure digest mismatch: ${entry.path}`);
    composite.update(entry.path).update("\0").update(content);
  }
  if (composite.digest("hex") !== closure.contentDigest) fail("closure composite digest mismatch");
  for (const file of walkPackage(root).filter((file) => /\.(?:js|json|md)$/u.test(file) && path.basename(file) !== "power-product.json")) {
    const text = fs.readFileSync(file, "utf8");
    for (const term of forbiddenTerms) if (text.includes(term)) fail(`forbidden product term in ${path.relative(root, file)}: ${term}`);
  }
  return { ok: true, root, version: pkg.version, ...digestPowerPackage(root, { excludeOwner: true }) };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(validatePowerPackage(process.argv[2] ?? process.cwd()))); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
