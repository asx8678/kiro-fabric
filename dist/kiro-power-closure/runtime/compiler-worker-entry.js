import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);

import {
  typeCheckFabricCode
} from "../chunks/chunk-S3FSRH3K.js";
import "../chunks/chunk-GX475RD4.js";

// src/runtime/compiler-worker-entry.ts
import { parentPort } from "node:worker_threads";
var port = parentPort;
port?.once("message", (request) => {
  try {
    port.postMessage({
      ok: true,
      result: typeCheckFabricCode(request.code, request.declarations, request.mode)
    });
  } catch (error) {
    port.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
