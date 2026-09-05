#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { assertPackagePolicy } from "./package-policy.mjs";
import { sharedEsbuildOptions } from "./esbuild-common.mjs";

assertPackagePolicy();
fs.rmSync("dist", { recursive: true, force: true });
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json", "--emitDeclarationOnly"], { stdio: "inherit" });
await build({
  ...sharedEsbuildOptions,
  entryPoints: ["src/index.ts", "src/runtime/compiler-worker-entry.ts"],
  outdir: "dist",
  packages: "external",
  logLevel: "info",
});
