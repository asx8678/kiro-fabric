#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { assertPackagePolicy } from "./package-policy.mjs";

assertPackagePolicy();
fs.rmSync("dist", { recursive: true, force: true });
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json", "--emitDeclarationOnly"], { stdio: "inherit" });
await build({
  entryPoints: ["src/index.ts", "src/runtime/compiler-worker-entry.ts"],
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
  sourcemap: false,
  logLevel: "info",
});
