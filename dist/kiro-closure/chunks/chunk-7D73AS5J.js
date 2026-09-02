import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);


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
var MAX_FABRIC_STRING_KEYS = 64;
var MAX_FABRIC_STRING_KEY_BYTES = 256;
var fabricStringsLimitError = (strings, maxSourceBytes) => {
  if (strings === void 0) return void 0;
  const keys = Object.keys(strings);
  if (keys.length > MAX_FABRIC_STRING_KEYS) {
    return `Fabric strings exceed key count: received ${keys.length} keys, limit ${MAX_FABRIC_STRING_KEYS}`;
  }
  let total = 0;
  for (const key of keys) {
    const keyBytes = Buffer.byteLength(key, "utf8");
    if (keyBytes > MAX_FABRIC_STRING_KEY_BYTES) {
      return `Fabric strings key exceeds ${MAX_FABRIC_STRING_KEY_BYTES} bytes`;
    }
    const value = strings[key];
    if (typeof value !== "string") {
      return "Fabric strings values must be strings";
    }
    const valueBytes = Buffer.byteLength(value, "utf8");
    if (valueBytes > maxSourceBytes) {
      return `Fabric strings value exceeds executor.maxSourceBytes: received ${valueBytes} bytes, limit ${maxSourceBytes} bytes`;
    }
    total += keyBytes + valueBytes;
    if (total > maxSourceBytes) {
      return `Fabric strings exceed executor.maxSourceBytes: received ${total} bytes, limit ${maxSourceBytes} bytes`;
    }
  }
  return void 0;
};

export {
  MIN_EXECUTOR_SOURCE_BYTES,
  DEFAULT_EXECUTOR_SOURCE_BYTES,
  MAX_EXECUTOR_SOURCE_BYTES,
  effectiveFabricSourceLimit,
  fabricSourceLimitError,
  fabricTranspiledLimitError,
  fabricStringsLimitError
};
