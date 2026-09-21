/** Shared bounded-identity validators for the continuity surfaces. Each
 * helper throws with the caller's fully qualified label ("archive event id",
 * "rotation note") so every surface keeps its exact historical error taxonomy
 * while the bounds live in one audited place. */

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

/** Bounded opaque identifier: 1..128 characters of the continuity id alphabet. */
export const continuityBoundedId = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(`continuity ${label} is malformed`);
  return value;
};

/** Bounded workspace/session key: non-empty and at most `maxBytes` UTF-8 bytes. */
export const continuityBoundedKey = (value: unknown, label: string, maxBytes = 256): string => {
  if (typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(`continuity ${label} is malformed`);
  return value;
};

/** Bounded operator text: non-empty, at most `maxBytes` UTF-8 bytes, and
 * well-formed UTF-8 (lone surrogates fail the round trip). */
export const continuityBoundedText = (value: unknown, label: string, maxBytes = 512): string => {
  if (typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > maxBytes || Buffer.from(value, "utf8").toString("utf8") !== value) throw new Error(`continuity ${label} is malformed`);
  return value;
};
