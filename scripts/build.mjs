#!/usr/bin/env node
import { prepareGeneratedOutput } from "./prepare-generated-output.mjs";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { assertPackagePolicy } from "./package-policy.mjs";
import { sharedEsbuildOptions } from "./esbuild-common.mjs";

assertPackagePolicy();
prepareGeneratedOutput(process.cwd(), "dist");
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json", "--emitDeclarationOnly"], { stdio: "inherit" });
await build({
  ...sharedEsbuildOptions,
  entryPoints: ["src/index.ts", "src/runtime/compiler-worker-entry.ts", "src/runtime/sandbox-worker-entry.ts", "src/fovea/engine-entry.ts", "src/kiro/fovea-hook.ts"],
  outdir: "dist",
  packages: "external",
  logLevel: "info",
});
