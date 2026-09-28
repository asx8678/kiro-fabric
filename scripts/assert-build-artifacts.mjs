#!/usr/bin/env node
import { verifyBuildClosure } from "./build-inputs.mjs";
import { pruneGeneratedOutputs } from "./prepare-generated-output.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const required = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/fovea/engine-entry.js",
  "dist/runtime/compiler-worker-entry.js",
  "dist/runtime/sandbox-worker-entry.js",
  "dist/kiro-agent-closure/kiro/mcp-entry.js",
  "dist/kiro-agent-closure/runtime/compiler-worker-entry.js",
  "dist/kiro-agent-closure/runtime/sandbox-worker-entry.js",
  "dist/kiro-agent-closure/closure-manifest.json",
  "dist/kiro-agent-closure/fovea/engine-entry.js",
  "dist/kiro-agent-closure/fovea/component.json",
  "dist/kiro-agent-closure/fovea/upstream.json",
  "dist/kiro-agent-closure/fovea/UPSTREAM-LICENSE.txt",
  "dist/kiro-agent-closure/fovea/ast-grep-LICENSE.txt",
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
  "dist/runtime/sandbox-worker-entry.js",
  "dist/kiro-agent-closure/kiro/mcp-entry.js",
  "dist/kiro-agent-closure/runtime/compiler-worker-entry.js",
  "dist/kiro-agent-closure/runtime/sandbox-worker-entry.js",
]) {
  await import(`${pathToFileURL(path.resolve(entry)).href}?build-audit=${Date.now()}`);
}

// The TypeScript compiler belongs to the compiler worker and is loaded lazily
// by the sandbox. Keep it out of the static graph of MCP server startup.
const staticImports = (file) => {
  const text = fs.readFileSync(file, "utf8");
  return [...text.matchAll(/^(?:import|export)\s[^;]*?from\s*"([^"]+)"|^import\s*"([^"]+)"/gm)].map((match) => match[1] ?? match[2]);
};
const loadsTypeScript = (file) => fs.readFileSync(file, "utf8").includes("require_typescript()");
const closureChunks = "dist/kiro-agent-closure/chunks";
for (const root of [
  "dist/runtime/sandbox-worker-entry.js",
  "dist/kiro-agent-closure/kiro/mcp-entry.js",
  "dist/kiro-agent-closure/runtime/sandbox-worker-entry.js",
  ...fs.readdirSync(closureChunks).filter((name) => name.startsWith("mcp-server-")).map((name) => path.join(closureChunks, name)),
]) {
  const seen = new Set();
  const pending = [path.resolve(root)];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (loadsTypeScript(file)) throw new Error(`Startup graph of ${root} statically loads the TypeScript compiler: ${path.relative(".", file)}`);
    for (const specifier of staticImports(file)) {
      if (specifier === "typescript") throw new Error(`Startup graph of ${root} statically imports typescript: ${path.relative(".", file)}`);
      if (specifier.startsWith(".")) pending.push(path.resolve(path.dirname(file), specifier));
    }
  }
}

pruneGeneratedOutputs(path.resolve("."), "dist");
pruneGeneratedOutputs(path.resolve("."), "dist/kiro-agent-closure");
