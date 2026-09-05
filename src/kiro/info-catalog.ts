import type { ResolvedFabricAction } from "../protocol.js";

const MAX_INFO_CATALOG_BYTES = 20_000;

/** Prefer digest-bound descriptors, then refs/risk, then the largest fitting
 * prefix of refs. Every representation obeys the serialized UTF-8 byte bound. */
export const fabricInfoActions = (
  actions: readonly Pick<ResolvedFabricAction, "ref" | "risk" | "descriptorDigest">[],
): unknown[] => {
  const summarized = actions.map(({ ref, risk, descriptorDigest }) => ({ ref, risk, descriptorDigest }));
  if (Buffer.byteLength(JSON.stringify(summarized), "utf8") <= MAX_INFO_CATALOG_BYTES) return summarized;
  const refsOnly = actions.map(({ ref, risk }) => ({ ref, risk }));
  if (Buffer.byteLength(JSON.stringify(refsOnly), "utf8") <= MAX_INFO_CATALOG_BYTES) return refsOnly;

  const refs: string[] = [];
  let bytes = 2; // []
  for (const { ref } of actions) {
    const added = Buffer.byteLength(JSON.stringify(ref), "utf8") + (refs.length ? 1 : 0);
    if (bytes + added > MAX_INFO_CATALOG_BYTES) break;
    refs.push(ref);
    bytes += added;
  }
  return refs;
};
