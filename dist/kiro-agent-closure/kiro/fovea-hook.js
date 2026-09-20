import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);

import "../chunks/chunk-AE4E2KSU.js";

// src/kiro/fovea-hook.ts
import path from "node:path";
import { pathToFileURL } from "node:url";
function foveaHookCapability() {
  return { schemaVersion: 1, status: "host-blocked", reason: "native-session-rendezvous-unavailable", dispatched: false };
}
function runFoveaHook() {
  process.stdout.write(JSON.stringify(foveaHookCapability()) + "\n");
  return 3;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = runFoveaHook();
}
export {
  foveaHookCapability,
  runFoveaHook
};
