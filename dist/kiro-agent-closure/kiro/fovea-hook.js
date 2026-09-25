import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);

import {
  foveaHookCapability
} from "../chunks/chunk-7LWVZOGJ.js";
import "../chunks/chunk-AE4E2KSU.js";

// src/kiro/fovea-hook.ts
import path from "node:path";
import { pathToFileURL } from "node:url";
function runFoveaHook(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "--status") {
    process.stdout.write(JSON.stringify(foveaHookCapability()) + "\n");
    return 0;
  }
  process.stderr.write("Navigator automatic hooks disabled: no supported native session-to-MCP association. Use --status for diagnostics.\n");
  return 3;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = runFoveaHook();
}
export {
  foveaHookCapability,
  runFoveaHook
};
