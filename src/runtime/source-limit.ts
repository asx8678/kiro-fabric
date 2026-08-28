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
