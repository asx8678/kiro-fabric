#!/usr/bin/env node
import { build } from "esbuild";

const result = await build({
  entryPoints: [
    "src/index.ts",
    "src/protocol.ts",
    "src/kernel/index.ts",
    "src/kiro/index.ts",
    "src/kiro/mcp-entry.ts",
    "src/kiro/agent-worker-entry.ts",
    "src/kiro/cli-entry.ts",
    "src/kiro/setup-entry.ts",
    "src/verification/index.ts",
  ],
  outdir: "dist",
  outbase: "src",
  entryNames: "[dir]/[name]",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node24",
  splitting: true,
  sourcemap: true,
  metafile: true,
  logLevel: "info",
});

const bundledPackages = Object.keys(result.metafile.inputs).filter((input) =>
  input.includes("node_modules/"),
);
if (bundledPackages.length > 0) {
  throw new Error(`Package code was bundled unexpectedly:\n${bundledPackages.join("\n")}`);
}

// Legacy generic-agent tests still exercise their historical worker directly.
// Build it as one isolated compatibility fixture; it is neither in the Kiro
// closure nor the published package.
await build({
  entryPoints: ["src/worker.ts"],
  outfile: "dist/worker.js",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  logLevel: "silent",
});
