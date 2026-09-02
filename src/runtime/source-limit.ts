import { Buffer } from "node:buffer";

export const DEFAULT_EXECUTOR_SOURCE_BYTES = 256 * 1024;
export const MIN_EXECUTOR_SOURCE_BYTES = 1_024;
export const MAX_EXECUTOR_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_FABRIC_PAYLOAD_KEYS = 128;
const MAX_FABRIC_PAYLOAD_KEY_BYTES = 1_024;

export const effectiveFabricSourceLimit = (value: number | undefined): number =>
  Number.isSafeInteger(value) ? Math.max(MIN_EXECUTOR_SOURCE_BYTES, Math.min(MAX_EXECUTOR_SOURCE_BYTES, value!)) : DEFAULT_EXECUTOR_SOURCE_BYTES;

export const fabricSourceLimitError = (code: string, maximum: number): string | undefined => {
  const bytes = Buffer.byteLength(code, "utf8");
  return bytes > maximum ? `Fabric source exceeds ${maximum} bytes: received ${bytes}` : undefined;
};

export const fabricPayloadsLimitError = (
  payloads: Record<string, string> | undefined,
  maximum: number,
): string | undefined => {
  if (payloads === undefined) return undefined;
  const keys = Object.keys(payloads);
  if (keys.length > MAX_FABRIC_PAYLOAD_KEYS) return `Fabric payloads exceed ${MAX_FABRIC_PAYLOAD_KEYS} keys`;
  let total = 0;
  for (const key of keys) {
    if (Buffer.byteLength(key, "utf8") > MAX_FABRIC_PAYLOAD_KEY_BYTES) return "Fabric payload key is too large";
    const value = payloads[key];
    if (typeof value !== "string") return "Fabric payload values must be strings";
    total += Buffer.byteLength(key, "utf8") + Buffer.byteLength(value, "utf8");
    if (total > maximum) return `Fabric payloads exceed ${maximum} bytes: received ${total}`;
  }
  return undefined;
};

export const fabricTranspiledLimitError = (code: string): string | undefined => {
  const maximum = MAX_EXECUTOR_SOURCE_BYTES * 4;
  const bytes = Buffer.byteLength(code, "utf8");
  return bytes > maximum ? `Transpiled guest source exceeds ${maximum} bytes: received ${bytes}` : undefined;
};
