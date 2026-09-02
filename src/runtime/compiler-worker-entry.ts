import { parentPort } from "node:worker_threads";
import {
  typeCheckFabricCode,
  type FabricCompilerRequest,
  type FabricCompilerWorkerResponse,
} from "./type-checker.js";

// Build-artifact verification imports every entry point in the main thread.
// Only install the protocol handler when this entry is actually a worker.
// The worker is warm-pooled: it serves many requests over its lifetime and is
// recycled by the parent on error, timeout, abort, idle, or the use cap.
const port = parentPort;
port?.on("message", (request: FabricCompilerRequest & { id: number }) => {
  let response: FabricCompilerWorkerResponse;
  try {
    response = { id: request.id, ok: true, result: typeCheckFabricCode(request.code, request.declarations) };
  } catch (error) {
    response = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  port.postMessage(response);
});
