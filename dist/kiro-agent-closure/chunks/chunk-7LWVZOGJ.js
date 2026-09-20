import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);


// src/kiro/fovea-native.ts
function foveaHookCapability() {
  return { schemaVersion: 1, status: "host-blocked", reason: "native-session-rendezvous-unavailable", dispatched: false, automatic: false, modelContextDelivered: false };
}

export {
  foveaHookCapability
};
