import { parentPort } from "node:worker_threads";
import {
  typeCheckFabricCode,
  type FabricCompilerRequest,
  type FabricCompilerWorkerResponse,
} from "./type-checker.js";

// Build-artifact verification imports every entry point in the main thread.
// Only install the protocol handler when this entry is actually a worker.
const port = parentPort;
port?.once("message", (request: FabricCompilerRequest) => {
  try {
    port.postMessage({
      ok: true,
      result: typeCheckFabricCode(request.code, request.declarations),
    } satisfies FabricCompilerWorkerResponse);
  } catch (error) {
    port.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies FabricCompilerWorkerResponse);
  }
});
