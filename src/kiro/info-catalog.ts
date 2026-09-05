import type { ResolvedFabricAction } from "../protocol.js";

export const MAX_INFO_CATALOG_BYTES = 20_000;

interface FabricInfoCatalogMetadata {
  total: number;
  returned: number;
  complete: boolean;
  representation: "descriptors" | "refs-risk" | "refs";
  digestComplete: boolean;
  recovery: { search: "tools.search({ query, limit })"; describe: "tools.describe({ ref })" };
}

export interface FabricInfoCatalog {
  actions: unknown[];
  catalog: FabricInfoCatalogMetadata;
}

const recovery = (): FabricInfoCatalogMetadata["recovery"] => ({
  search: "tools.search({ query, limit })",
  describe: "tools.describe({ ref })",
});
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");
const packageCatalog = (
  actions: unknown[],
  total: number,
  representation: FabricInfoCatalogMetadata["representation"],
): FabricInfoCatalog => ({
  actions,
  catalog: {
    total,
    returned: actions.length,
    complete: actions.length === total,
    representation,
    digestComplete: representation === "descriptors" && actions.length === total,
    recovery: recovery(),
  },
});

/** Produce a backwards-compatible actions array plus bounded completeness
 * metadata. The byte budget applies to their combined serialized envelope. */
export const fabricInfoCatalog = (
  actions: readonly Pick<ResolvedFabricAction, "ref" | "risk" | "descriptorDigest">[],
): FabricInfoCatalog => {
  const summarized = actions.map(({ ref, risk, descriptorDigest }) => ({ ref, risk, descriptorDigest }));
  let result = packageCatalog(summarized, actions.length, "descriptors");
  if (bytes(result) <= MAX_INFO_CATALOG_BYTES) return result;

  result = packageCatalog(actions.map(({ ref, risk }) => ({ ref, risk })), actions.length, "refs-risk");
  if (bytes(result) <= MAX_INFO_CATALOG_BYTES) return result;

  const refs: string[] = [];
  let refsBytes = 2; // []
  const emptyEnvelopeBytes = bytes(packageCatalog([], actions.length, "refs"));
  for (const { ref } of actions) {
    const encodedBytes = bytes(ref);
    const candidateRefsBytes = refsBytes + encodedBytes + (refs.length ? 1 : 0);
    const candidateCount = refs.length + 1;
    const metadataAdjustment = String(candidateCount).length - 1 + (candidateCount === actions.length ? -1 : 0);
    // Replace the empty [] and account for returned's digits (and false→true
    // completeness when the final reference fits).
    if (emptyEnvelopeBytes - 2 + candidateRefsBytes + metadataAdjustment > MAX_INFO_CATALOG_BYTES) break;
    refs.push(ref);
    refsBytes = candidateRefsBytes;
  }
  return packageCatalog(refs, actions.length, "refs");
};

/** Legacy helper retained for callers that only consume the array. */
export const fabricInfoActions = (
  actions: readonly Pick<ResolvedFabricAction, "ref" | "risk" | "descriptorDigest">[],
): unknown[] => fabricInfoCatalog(actions).actions;
