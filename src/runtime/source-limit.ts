import { Buffer } from "node:buffer";

export const MIN_EXECUTOR_SOURCE_BYTES = 1024;
export const DEFAULT_EXECUTOR_SOURCE_BYTES = 256 * 1024;
export const MAX_EXECUTOR_SOURCE_BYTES = 512 * 1024;
export const MAX_EXECUTOR_TRANSPILED_BYTES = 2 * MAX_EXECUTOR_SOURCE_BYTES;

export const effectiveFabricSourceLimit = (configured?: number): number => {
  if (configured === undefined) return DEFAULT_EXECUTOR_SOURCE_BYTES;
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_EXECUTOR_SOURCE_BYTES;
  return Math.min(MAX_EXECUTOR_SOURCE_BYTES, Math.max(1, Math.floor(configured)));
};

export const fabricSourceLimitError = (
  code: string,
  maxSourceBytes: number,
): string | undefined => {
  const received = Buffer.byteLength(code, "utf8");
  return received > maxSourceBytes
    ? `Fabric source exceeds executor.maxSourceBytes: received ${received} bytes, limit ${maxSourceBytes} bytes`
    : undefined;
};

export const fabricTranspiledLimitError = (code: string): string | undefined => {
  const received = Buffer.byteLength(code, "utf8");
  return received > MAX_EXECUTOR_TRANSPILED_BYTES
    ? `Fabric transpiled source exceeds hard limit: received ${received} bytes, limit ${MAX_EXECUTOR_TRANSPILED_BYTES} bytes`
    : undefined;
};

export const MAX_FABRIC_STRING_KEYS = 64;
export const MAX_FABRIC_STRING_KEY_BYTES = 256;

export const fabricStringsLimitError = (
  strings: Record<string, string> | undefined,
  maxSourceBytes: number,
): string | undefined => {
  if (strings === undefined) return undefined;
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
  return undefined;
};
