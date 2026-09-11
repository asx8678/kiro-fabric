#!/usr/bin/env node
import { verifyBuildClosure } from "./build-inputs.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const required = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/runtime/compiler-worker-entry.js",
  "dist/kiro-agent-closure/kiro/mcp-entry.js",
  "dist/kiro-agent-closure/runtime/compiler-worker-entry.js",
  "dist/kiro-agent-closure/closure-manifest.json",
];
for (const file of required) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Required build artifact is missing: ${file}`);
  }
}
for (const forbidden of [
  "dist/kiro-closure",
  "dist/kiro-agent-closure/kiro/agent-worker-entry.js",
  "dist/kiro-agent-closure/kiro/management-entry.js",
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

verifyBuildClosure(path.resolve("."));

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
  "dist/kiro-agent-closure/kiro/mcp-entry.js",
  "dist/kiro-agent-closure/runtime/compiler-worker-entry.js",
]) {
  await import(`${pathToFileURL(path.resolve(entry)).href}?build-audit=${Date.now()}`);
}
