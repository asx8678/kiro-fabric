#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FABRIC_TOOLS,
  generateAgentProfile,
} from "./agent-profile.mjs";

const MAX_PACKAGE_FILES = 500;
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const AGENT_PRODUCT_SHA256 = "d46040b7908c84abd5762da68098da53b82cc505afe10fc7366625a84f0215d8";
const SCRIPT_FILES = [
  "agent-profile.mjs",
  "install-agent-user.mjs",
  "validate-agent-package.mjs",
];
const ROOT_ENTRIES = ["agent-product.json", "package.json", "runtime", "scripts", "skills"];
const normalize = (value) => value.replaceAll("\\", "/");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(`invalid Kiro Agent package: ${message}`); };

const isContained = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

const safeRelative = (value) => typeof value === "string" && value.length > 0 &&
  !value.includes("\\") && !path.posix.isAbsolute(value) &&
  !value.split("/").some((part) => part === "" || part === "." || part === "..");

const packageRoot = (input) => {
  const lexical = path.resolve(input);
  const stats = fs.lstatSync(lexical);
  if (!stats.isSymbolicLink()) return lexical;
  if (path.basename(lexical) !== "kiro-fabric-agent") fail("unapproved staging pointer name");
  const target = fs.readlinkSync(lexical);
  if (path.isAbsolute(target) || target.includes(path.sep) || !/^\.kiro-fabric-agent-generation-[a-f0-9]{64}$/u.test(target)) {
    fail("unapproved staging pointer");
  }
  const targetPath = path.join(path.dirname(lexical), target);
  let targetStats;
  try { targetStats = fs.lstatSync(targetPath); }
  catch { fail("staging generation is unavailable"); }
  if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) fail("staging generation is not a regular directory");
  const resolved = fs.realpathSync(lexical);
  if (path.dirname(resolved) !== fs.realpathSync(path.dirname(lexical))) fail("staging pointer escapes parent");
  return resolved;
};

export const walkPackage = (input) => {
  const root = packageRoot(input);
  const files = [];
  let entriesSeen = 0;
  let bytesSeen = 0;
  const visit = (directory) => {
    const directoryStats = fs.lstatSync(directory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink() ||
        (typeof process.getuid === "function" && directoryStats.uid !== process.getuid()) ||
        (process.platform !== "win32" && (directoryStats.mode & 0o022) !== 0)) {
      fail(`unsafe package directory: ${normalize(path.relative(root, directory) || ".")}`);
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      entriesSeen += 1;
      if (entriesSeen > MAX_PACKAGE_FILES) fail("tree entry bound exceeded");
      const target = path.join(directory, entry.name);
      const stats = fs.lstatSync(target);
      const relative = normalize(path.relative(root, target));
      if (stats.isSymbolicLink()) fail(`symlink: ${relative}`);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && stats.nlink === 1 &&
          (typeof process.getuid !== "function" || stats.uid === process.getuid()) &&
          (process.platform === "win32" || (stats.mode & 0o022) === 0)) {
        bytesSeen += stats.size;
        if (bytesSeen > MAX_PACKAGE_BYTES) fail("tree byte bound exceeded");
        files.push(target);
      }
      else fail(`unsupported entry: ${relative}`);
    }
  };
  visit(root);
  return files;
};

export const snapshotTree = (input) => {
  const root = path.resolve(input);
  const stats = fs.lstatSync(root);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(`tree root is unsafe: ${root}`);
  const walkedFiles = walkPackage(root);
  const directories = [];
  const collectDirectories = (directory) => {
    const current = fs.lstatSync(directory);
    if (!current.isDirectory() || current.isSymbolicLink() ||
        (typeof process.getuid === "function" && current.uid !== process.getuid()) ||
        (process.platform !== "win32" && (current.mode & 0o022) !== 0)) {
      fail(`unsafe tree directory: ${normalize(path.relative(root, directory) || ".")}`);
    }
    directories.push({ path: normalize(path.relative(root, directory) || "."), mode: current.mode & 0o777 });
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory()) collectDirectories(path.join(directory, entry.name));
    }
  };
  collectDirectories(root);
  const files = walkedFiles.map((file) => {
    const bytes = fs.readFileSync(file);
    const current = fs.lstatSync(file);
    return {
      path: normalize(path.relative(root, file)),
      bytes: bytes.length,
      mode: current.mode & 0o777,
      sha256: hash(bytes),
    };
  });
  const digest = createHash("sha256");
  for (const directory of directories) {
    digest.update("directory\0").update(directory.path).update("\0").update(String(directory.mode)).update("\0");
  }
  for (const file of files) {
    digest.update("file\0").update(file.path).update("\0").update(String(file.mode)).update("\0").update(String(file.bytes)).update("\0").update(file.sha256).update("\0");
  }
  return { digest: digest.digest("hex"), directories, files };
};

export const digestAgentPackage = (input) => {
  const root = packageRoot(input);
  const inventory = snapshotTree(root);
  return {
    digest: inventory.digest,
    files: inventory.files.length,
    bytes: inventory.files.reduce((total, file) => total + file.bytes, 0),
  };
};

const jsonFile = (root, name) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
  } catch (error) {
    fail(`${name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const assertExactNames = (actual, expected, label) => {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) fail(`${label} inventory drifted`);
};

const validateClosure = (root) => {
  const runtime = path.join(root, "runtime");
  const closure = jsonFile(root, "runtime/closure-manifest.json");
  if (closure.schemaVersion !== 1 || closure.product !== "kiro-fabric-agent" ||
      closure.entrypoint !== "kiro/mcp-entry.js" || closure.compilerWorker !== "runtime/compiler-worker-entry.js" ||
      closure.executor !== "quickjs" || !Array.isArray(closure.files)) {
    fail("closure identity drifted");
  }
  const expected = [];
  const contentDigest = createHash("sha256");
  const seen = new Set();
  for (const entry of closure.files) {
    if (!entry || !safeRelative(entry.path) || seen.has(entry.path) ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? "")) {
      fail("closure inventory entry is unsafe");
    }
    seen.add(entry.path);
    const target = path.join(runtime, ...entry.path.split("/"));
    if (!isContained(runtime, target)) fail(`closure path escapes runtime: ${entry.path}`);
    const bytes = fs.readFileSync(target);
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) fail(`closure digest: ${entry.path}`);
    contentDigest.update(entry.path).update("\0").update(bytes);
    expected.push(entry.path);
  }
  if (contentDigest.digest("hex") !== closure.contentDigest) fail("closure content digest drifted");
  const actual = walkPackage(runtime)
    .map((file) => normalize(path.relative(runtime, file)))
    .filter((file) => file !== "closure-manifest.json");
  assertExactNames(actual, expected, "closure");
  const runtimeInventory = snapshotTree(runtime);
  const expectedDirectories = new Set(["."]);
  for (const file of ["closure-manifest.json", ...expected]) {
    let directory = path.posix.dirname(file);
    while (directory !== ".") {
      expectedDirectories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  assertExactNames(runtimeInventory.directories.map((entry) => entry.path), expectedDirectories, "closure directory");
  return runtimeInventory;
};

export const validateAgentPackage = (input) => {
  const rootPath = packageRoot(input);
  const rootStats = fs.lstatSync(rootPath);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) fail("root is not a directory");
  if (process.platform !== "win32" && ((rootStats.mode & 0o022) !== 0 ||
      (typeof process.getuid === "function" && rootStats.uid !== process.getuid()))) {
    fail("root is writable by another user or not current-user owned");
  }
  const root = fs.realpathSync(rootPath);
  const inventory = snapshotTree(root);
  const namedGeneration = /^\.kiro-fabric-agent-generation-([a-f0-9]{64})$/u.exec(path.basename(root));
  if (namedGeneration && namedGeneration[1] !== inventory.digest) {
    fail("digest-named staging generation does not match its contents");
  }
  const bytes = inventory.files.reduce((total, file) => total + file.bytes, 0);
  if (inventory.files.length > MAX_PACKAGE_FILES || bytes > MAX_PACKAGE_BYTES) fail("package bounds exceeded");
  assertExactNames(fs.readdirSync(root), ROOT_ENTRIES, "root");
  for (const requiredDirectory of ["runtime", "scripts", "skills", "skills/fabric-exec"]) {
    const stats = fs.lstatSync(path.join(root, requiredDirectory));
    if (!stats.isDirectory() || stats.isSymbolicLink()) fail(`${requiredDirectory} is not a regular directory`);
  }

  const product = jsonFile(root, "agent-product.json");
  if (hash(fs.readFileSync(path.join(root, "agent-product.json"))) !== AGENT_PRODUCT_SHA256) {
    fail("agent product authority digest drifted");
  }
  if (product.schemaVersion !== 1 || product.product !== "kiro-fabric-agent" ||
      product.entrypoint !== "src/kiro/mcp-entry.ts" || product.outputBundle !== "dist/kiro-agent-closure" ||
      JSON.stringify(product.tools) !== JSON.stringify(FABRIC_TOOLS) ||
      JSON.stringify(product.bundledAgentResources) !== JSON.stringify(["skills/fabric-exec/SKILL.md", "skills/fabric-exec/references/api.md"])) {
    fail("agent product contract drifted");
  }

  const pkg = jsonFile(root, "package.json");
  if (pkg.name !== "kiro-fabric" || typeof pkg.version !== "string" || pkg.private !== true || pkg.type !== "module" ||
      pkg.engines?.node !== ">=24" || pkg.scripts?.["install:agent"] !== "node scripts/install-agent-user.mjs .") {
    fail("package identity/install contract drifted");
  }
  assertExactNames(Object.keys(pkg), ["name", "version", "type", "private", "engines", "scripts"], "package manifest");

  const scriptFiles = walkPackage(path.join(root, "scripts"))
    .map((file) => normalize(path.relative(path.join(root, "scripts"), file)));
  assertExactNames(scriptFiles, SCRIPT_FILES, "installer script");
  assertExactNames(fs.readdirSync(path.join(root, "scripts")), SCRIPT_FILES, "installer script root");
  assertExactNames(fs.readdirSync(path.join(root, "skills")), ["fabric-exec"], "skills root");
  const skillFiles = walkPackage(path.join(root, "skills", "fabric-exec"))
    .map((file) => normalize(path.relative(path.join(root, "skills", "fabric-exec"), file)));
  assertExactNames(skillFiles, ["SKILL.md", "references/api.md"], "skill");

  const skill = snapshotTree(path.join(root, "skills", "fabric-exec"));
  assertExactNames(skill.directories.map((entry) => entry.path), [".", "references"], "skill directory");

  const runtime = validateClosure(root);
  return {
    ok: true,
    root,
    version: pkg.version,
    digest: inventory.digest,
    files: inventory.files.length,
    bytes,
    inventory,
    runtime,
    skill,
  };
};

export const validateInstalledAgentProfile = (profilePath, options) => {
  const absoluteProfile = path.resolve(profilePath);
  const stats = fs.lstatSync(absoluteProfile);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 ||
      (typeof process.getuid === "function" && stats.uid !== process.getuid()) ||
      (process.platform !== "win32" && (stats.mode & 0o022) !== 0)) {
    fail("installed profile is not a safe regular file");
  }
  const profile = jsonFile(path.dirname(absoluteProfile), path.basename(absoluteProfile));
  const expected = generateAgentProfile(options);
  if (JSON.stringify(profile) !== JSON.stringify(expected)) fail("installed profile differs from the generated contract");
  const installRoot = fs.realpathSync(options.installRoot);
  for (const [label, target] of Object.entries({
    runtimeRoot: options.runtimeRoot,
    dataRoot: options.dataRoot,
    skillPath: options.skillPath,
  })) {
    if (!path.isAbsolute(target) || !isContained(installRoot, path.resolve(target))) fail(`${label} escapes the owned global installation`);
  }
  const runtimeEntry = path.join(options.runtimeRoot, "kiro", "mcp-entry.js");
  for (const [label, target] of Object.entries({ nodePath: options.nodePath, runtimeEntry, skillPath: options.skillPath })) {
    const targetStats = fs.lstatSync(target);
    if (!targetStats.isFile() || targetStats.isSymbolicLink()) fail(`${label} does not resolve to a regular installed file`);
  }
  const nodeStats = fs.statSync(options.nodePath);
  if (process.platform !== "win32" && (nodeStats.mode & 0o111) === 0) fail("nodePath is not executable");
  if (!fs.lstatSync(options.dataRoot).isDirectory()) fail("dataRoot is not a directory");
  return { ok: true, profile, sha256: hash(fs.readFileSync(absoluteProfile)) };
};

const invokedAsMain = process.argv[1] !== undefined &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedAsMain) {
  try {
    process.stdout.write(`${JSON.stringify(validateAgentPackage(process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")))}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
