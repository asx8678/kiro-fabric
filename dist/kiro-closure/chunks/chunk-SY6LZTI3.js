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

export {
  throwIfAborted,
  runAbortable,
  settleWithin
};
