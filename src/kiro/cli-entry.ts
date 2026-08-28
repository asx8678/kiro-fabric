#!/usr/bin/env node
// Executable entry for the kiro-fabric management CLI. Only runs when this
// file is the process entry point, so import-based build assertions stay inert.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
const selfPath = fileURLToPath(import.meta.url);
if (invokedPath === selfPath || invokedPath === realpathSync(selfPath)) {
  const { runKiroCli } = await import("./cli.js");
  process.exitCode = await runKiroCli(process.argv.slice(2));
}
