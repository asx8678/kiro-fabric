#!/usr/bin/env node
// PR1 package/closure size certification.
//
// Certifies that the built Kiro runtime closure stays within explicit byte
// ceilings, that it contains no source maps, and that the required entry and
// metadata are present. Machine-readable measurements are printed to stdout.
//
// Usage: node scripts/certify-closure-size.mjs [--json]
// Must be run after `pnpm run build` (which emits dist/kiro-closure).

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const closureDir = join(root, "dist", "kiro-closure");
const json = process.argv.includes("--json");

// Explicit ceilings. Tune with measured baselines; PR1 establishes first-pass
// bounds over what the bundle actually ships so regressions fail loudly.
const CEILINGS = {
  /** Total shipped bytes (incl. role JS + package.json). */
  closureBytes: 32 * 1024 * 1024,
  /** Total count of shipped files. */
  fileCount: 200,
  /** Largest single JS chunk. */
  largestChunkBytes: 12 * 1024 * 1024,
};

const fileList = (dir) => {
  const files = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return files;
};

const allFiles = fileList(closureDir);
const jsFiles = allFiles.filter((f) => f.endsWith(".js"));
const mapFiles = allFiles.filter((f) => f.endsWith(".map"));
const totalBytes = allFiles.reduce((sum, f) => sum + statSync(f).size, 0);
const largestJs = jsFiles.reduce(
  (m, f) => Math.max(m, statSync(f).size),
  0,
);

const errors = [];
if (mapFiles.length > 0) {
  errors.push(`closure contains ${mapFiles.length} source maps`);
}
for (const required of ["kiro/mcp-entry.js", "kiro/agent-worker-entry.js", "package.json"]) {
  if (!existsSync(join(closureDir, required))) errors.push(`missing ${required}`);
}
if (existsSync(join(closureDir, "node_modules"))) {
  errors.push("closure ships a node_modules directory");
}
if (totalBytes > CEILINGS.closureBytes) {
  errors.push(
    `closure ${totalBytes} bytes exceeds ceiling ${CEILINGS.closureBytes}`,
  );
}
if (allFiles.length > CEILINGS.fileCount) {
  errors.push(
    `closure ${allFiles.length} files exceeds ceiling ${CEILINGS.fileCount}`,
  );
}
if (largestJs > CEILINGS.largestChunkBytes) {
  errors.push(
    `largest JS chunk ${largestJs} bytes exceeds ceiling ${CEILINGS.largestChunkBytes}`,
  );
}

const measured = {
  bytes: totalBytes,
  bytesKiB: Math.round(totalBytes / 1024),
  fileCount: allFiles.length,
  jsFileCount: jsFiles.length,
  mapFileCount: mapFiles.length,
  largestJsBytes: largestJs,
  ceilings: CEILINGS,
};

if (json) {
  process.stdout.write(JSON.stringify({ ok: errors.length === 0, measured }, null, 2) + "\n");
} else {
  console.log(
    `closure size: ${measured.bytesKiB} KiB across ${measured.fileCount} files ` +
    `(${measured.jsFileCount} JS, ${measured.mapFileCount} maps)`,
  );
}

if (errors.length > 0) {
  for (const e of errors) console.error(`certify-closure-size: ${e}`);
  process.exitCode = 1;
}