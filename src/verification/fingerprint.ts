import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  VerificationFingerprint,
  VerificationResult,
} from "./types.js";

const PREFIX = "sha256:";

export const sha256Digest = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

export const sha256Text = (text: string): string => sha256Digest(text);

export const sha256Bytes = (bytes: Uint8Array): string => sha256Digest(bytes);

export const sha256File = (path: string): string =>
  sha256Digest(readFileSync(path));

export const fingerprintFor = (digestHex: string): VerificationFingerprint => ({
  algorithm: "sha256",
  digest: `${PREFIX}${digestHex}`,
});

/**
 * Canonical, key-order-stable JSON serialization so identical logical values
 * yield identical digests regardless of object key insertion order. Circular or
 * non-JSON values are rejected with a clear error.
 */
export const canonicalJsonBytes = (value: unknown): Uint8Array => {
  const json = canonicalJson(value);
  return Buffer.from(json, "utf8");
};

const canonicalJson = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Cannot fingerprint non-finite numbers");
  }
  return JSON.stringify(value);
};

/**
 * Compute the self-referential result fingerprint. The `fingerprints` object's
 * entries are canonicalized EXCLUDING `fingerprints.result` (recursively), so
 * the digest is stable and deterministic.
 */
export const fingerprintVerificationResult = (result: VerificationResult): VerificationFingerprint => {
  // Timestamps are excluded (stripped) so identical evidence yields identical.
  const { startedAt: _s, finishedAt: _f, ...body } = result;
  const clone = {
    ...body,
    fingerprints: {
      ...result.fingerprints,
      result: { algorithm: "sha256" as const, digest: `${PREFIX}${"0".repeat(64)}` },
    },
  };
  return fingerprintFor(sha256Digest(canonicalJsonBytes(clone)));
}
