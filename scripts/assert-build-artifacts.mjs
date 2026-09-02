#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const required = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/runtime/compiler-worker-entry.js",
  "dist/kiro-power-closure/kiro/mcp-entry.js",
  "dist/kiro-power-closure/runtime/compiler-worker-entry.js",
  "dist/kiro-power-closure/closure-manifest.json",
];
for (const file of required) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Required build artifact is missing: ${file}`);
  }
}
for (const forbidden of [
  "dist/kiro-closure",
  "dist/kiro-power-closure/kiro/agent-worker-entry.js",
  "dist/kiro-power-closure/kiro/management-entry.js",
]) {
  if (fs.existsSync(forbidden)) throw new Error(`Obsolete build artifact exists: ${forbidden}`);
}

const files = [];
const visit = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (entry.isFile()) files.push(target);
    else throw new Error(`Unsupported build artifact: ${target}`);
  }
};
visit("dist");
for (const file of files) {
  if (file.endsWith(".map")) throw new Error(`Production build contains a source map: ${file}`);
}

const closureRoot = path.resolve("dist/kiro-power-closure");
const manifest = JSON.parse(fs.readFileSync(path.join(closureRoot, "closure-manifest.json"), "utf8"));
const actualClosureFiles = files
  .filter((file) => path.resolve(file).startsWith(`${closureRoot}${path.sep}`) && !file.endsWith("closure-manifest.json"))
  .map((file) => path.relative(closureRoot, file).replaceAll("\\", "/"))
  .sort();
const manifestFiles = manifest.files.map((entry) => entry.path).sort();
if (JSON.stringify(actualClosureFiles) !== JSON.stringify(manifestFiles)) {
  throw new Error("Closure manifest file inventory does not match dist");
}
const digest = createHash("sha256");
for (const entry of manifest.files) {
  const file = path.join(closureRoot, entry.path);
  const content = fs.readFileSync(file);
  if (content.length !== entry.bytes || createHash("sha256").update(content).digest("hex") !== entry.sha256) {
    throw new Error(`Closure manifest checksum mismatch: ${entry.path}`);
  }
  digest.update(entry.path).update("\0").update(content);
}
if (digest.digest("hex") !== manifest.contentDigest) throw new Error("Closure content digest mismatch");

const declarations = fs.readFileSync("dist/index.d.ts", "utf8");
for (const removed of ["agent", "managed", "extension", "node-process", "orchestration"]) {
  if (declarations.toLowerCase().includes(removed)) {
    throw new Error(`Public declarations expose removed surface: ${removed}`);
  }
}

// Static imports are exercised here; the worker entry is separate and must be
// imported explicitly. Entry guards prevent stdio startup in this process.
for (const entry of [
  "dist/index.js",
  "dist/runtime/compiler-worker-entry.js",
  "dist/kiro-power-closure/kiro/mcp-entry.js",
  "dist/kiro-power-closure/runtime/compiler-worker-entry.js",
]) {
  await import(`${pathToFileURL(path.resolve(entry)).href}?build-audit=${Date.now()}`);
}
