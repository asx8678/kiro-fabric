import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);


// src/async-settlement.ts
var abortError = (signal) => {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === "string" && reason ? reason : "Operation aborted");
};
var throwIfAborted = (signal) => {
  if (signal?.aborted) throw abortError(signal);
};
var raceWithAbort = (operation, signal) => {
  if (!signal) return Promise.resolve(operation);
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortError(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
};
var runAbortable = (signal, operation) => {
  try {
    throwIfAborted(signal);
    return raceWithAbort(Promise.resolve(operation()), signal);
  } catch (error) {
    return Promise.reject(error);
  }
};
var settleWithin = async (operations, timeoutMs) => {
  const pending = [...operations].map((operation) => Promise.resolve(operation));
  if (pending.length === 0) return true;
  let timer;
  try {
    return await Promise.race([
      Promise.allSettled(pending).then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// src/runtime/source-limit.ts
import { Buffer } from "node:buffer";
var MIN_EXECUTOR_SOURCE_BYTES = 1024;
var DEFAULT_EXECUTOR_SOURCE_BYTES = 256 * 1024;
var MAX_EXECUTOR_SOURCE_BYTES = 512 * 1024;
var MAX_EXECUTOR_TRANSPILED_BYTES = 2 * MAX_EXECUTOR_SOURCE_BYTES;
var effectiveFabricSourceLimit = (configured) => {
  if (configured === void 0) return DEFAULT_EXECUTOR_SOURCE_BYTES;
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_EXECUTOR_SOURCE_BYTES;
  return Math.min(MAX_EXECUTOR_SOURCE_BYTES, Math.max(1, Math.floor(configured)));
};
var fabricSourceLimitError = (code, maxSourceBytes) => {
  const received = Buffer.byteLength(code, "utf8");
  return received > maxSourceBytes ? `Fabric source exceeds executor.maxSourceBytes: received ${received} bytes, limit ${maxSourceBytes} bytes` : void 0;
};
var fabricTranspiledLimitError = (code) => {
  const received = Buffer.byteLength(code, "utf8");
  return received > MAX_EXECUTOR_TRANSPILED_BYTES ? `Fabric transpiled source exceeds hard limit: received ${received} bytes, limit ${MAX_EXECUTOR_TRANSPILED_BYTES} bytes` : void 0;
};

export {
  throwIfAborted,
  runAbortable,
  settleWithin,
  MIN_EXECUTOR_SOURCE_BYTES,
  DEFAULT_EXECUTOR_SOURCE_BYTES,
  MAX_EXECUTOR_SOURCE_BYTES,
  effectiveFabricSourceLimit,
  fabricSourceLimitError,
  fabricTranspiledLimitError
};
