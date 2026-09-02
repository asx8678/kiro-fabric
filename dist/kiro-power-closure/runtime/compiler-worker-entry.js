import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);

import {
  typeCheckFabricCode
} from "../chunks/chunk-SPHG3WWN.js";
import "../chunks/chunk-LSWTYIW3.js";

// src/runtime/compiler-worker-entry.ts
import { parentPort } from "node:worker_threads";
var port = parentPort;
port?.on("message", (request) => {
  let response;
  try {
    response = { id: request.id, ok: true, result: typeCheckFabricCode(request.code, request.declarations) };
  } catch (error) {
    response = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  port.postMessage(response);
});
