#!/usr/bin/env node
// Certify independent managed and Power runtime closure size/surface budgets.
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = process.argv.includes("--json");
const specs = [
  {
    id: "managed",
    directory: join(root, "dist", "kiro-closure"),
    required: ["kiro/mcp-entry.js", "kiro/agent-worker-entry.js", "kiro/management-entry.js", "package.json"],
    forbidden: [],
    ceilings: { closureBytes: 32 * 1024 * 1024, fileCount: 200, largestChunkBytes: 12 * 1024 * 1024 },
  },
  {
    id: "power",
    directory: join(root, "dist", "kiro-power-closure"),
    required: ["kiro/mcp-entry.js", "package.json"],
    forbidden: ["kiro/agent-worker-entry.js", "kiro/management-entry.js"],
    ceilings: { closureBytes: 24 * 1024 * 1024, fileCount: 180, largestChunkBytes: 12 * 1024 * 1024 },
  },
];

const fileList = (directory) => {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  if (existsSync(directory)) walk(directory);
  return files;
};

const errors = [];
const closures = specs.map((spec) => {
  const allFiles = fileList(spec.directory);
  const jsFiles = allFiles.filter((file) => file.endsWith(".js"));
  const mapFiles = allFiles.filter((file) => file.endsWith(".map"));
  const totalBytes = allFiles.reduce((sum, file) => sum + statSync(file).size, 0);
  const largestJs = jsFiles.reduce((maximum, file) => Math.max(maximum, statSync(file).size), 0);
  if (allFiles.length === 0) errors.push(`${spec.id} closure is absent`);
  if (mapFiles.length > 0) errors.push(`${spec.id} closure contains ${mapFiles.length} source maps`);
  for (const required of spec.required) {
    if (!existsSync(join(spec.directory, required))) errors.push(`${spec.id} closure missing ${required}`);
  }
  for (const forbidden of spec.forbidden) {
    if (existsSync(join(spec.directory, forbidden))) errors.push(`${spec.id} closure contains forbidden ${forbidden}`);
  }
  if (existsSync(join(spec.directory, "node_modules"))) errors.push(`${spec.id} closure ships node_modules`);
  if (totalBytes > spec.ceilings.closureBytes) errors.push(`${spec.id} closure ${totalBytes} bytes exceeds ${spec.ceilings.closureBytes}`);
  if (allFiles.length > spec.ceilings.fileCount) errors.push(`${spec.id} closure ${allFiles.length} files exceeds ${spec.ceilings.fileCount}`);
  if (largestJs > spec.ceilings.largestChunkBytes) errors.push(`${spec.id} largest chunk ${largestJs} exceeds ${spec.ceilings.largestChunkBytes}`);
  return {
    id: spec.id,
    bytes: totalBytes,
    bytesKiB: Math.round(totalBytes / 1024),
    fileCount: allFiles.length,
    jsFileCount: jsFiles.length,
    mapFileCount: mapFiles.length,
    largestJsBytes: largestJs,
    ceilings: spec.ceilings,
  };
});

if (json) process.stdout.write(`${JSON.stringify({ ok: errors.length === 0, closures }, null, 2)}\n`);
else for (const closure of closures) console.log(`${closure.id} closure size: ${closure.bytesKiB} KiB across ${closure.fileCount} files (${closure.jsFileCount} JS, ${closure.mapFileCount} maps)`);
if (errors.length > 0) {
  for (const error of errors) console.error(`certify-closure-size: ${error}`);
  process.exitCode = 1;
}
