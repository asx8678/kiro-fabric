import { describe, expect, it } from "vitest";
import { fabricInfoActions, fabricInfoCatalog, MAX_INFO_CATALOG_BYTES } from "../src/kiro/info-catalog.js";

const action = (ref: string) => ({ ref, risk: "read" as const, descriptorDigest: "a".repeat(64) });
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

describe("fabric_info action catalog", () => {
  it("preserves complete small and empty catalogs with metadata", () => {
    expect(fabricInfoCatalog([])).toMatchObject({ actions: [], catalog: { total: 0, returned: 0, complete: true, representation: "descriptors", digestComplete: true } });
    const actions = [action("state.get"), action("state.list")];
    expect(fabricInfoCatalog(actions)).toMatchObject({ actions, catalog: { total: 2, returned: 2, complete: true, representation: "descriptors", digestComplete: true } });
  });

  it("degrades digests before references and declares digest loss", () => {
    const actions = Array.from({ length: 180 }, (_, i) => action(`catalog.action${i}`));
    const result = fabricInfoCatalog(actions);
    expect(result.actions).toEqual(actions.map(({ ref, risk }) => ({ ref, risk })));
    expect(result.catalog).toMatchObject({ total: 180, returned: 180, complete: true, representation: "refs-risk", digestComplete: false });
    expect(bytes(result)).toBeLessThanOrEqual(MAX_INFO_CATALOG_BYTES);
  });

  it("measures the combined envelope in UTF-8 and keeps its largest fitting prefix", () => {
    const actions = Array.from({ length: 100 }, (_, i) => action(`catalog.${"漢\\\"".repeat(100)}${i}`));
    const result = fabricInfoCatalog(actions);
    expect(result.catalog.representation).toBe("refs");
    expect(result.catalog.complete).toBe(false);
    expect(result.catalog.returned).toBe(result.actions.length);
    expect(result.actions).toEqual(actions.slice(0, result.actions.length).map(({ ref }) => ref));
    expect(fabricInfoActions(actions)).toEqual(result.actions);
    expect(bytes(result)).toBeLessThanOrEqual(MAX_INFO_CATALOG_BYTES);
    expect(bytes({ ...result, actions: [...result.actions, actions[result.actions.length]!.ref], catalog: { ...result.catalog, returned: result.actions.length + 1 } })).toBeGreaterThan(MAX_INFO_CATALOG_BYTES);
  });

  it("returns independent recovery hints that callers cannot poison", () => {
    const first = fabricInfoCatalog([action("state.get")]);
    (first.catalog.recovery as { search: string }).search = "poisoned";
    const second = fabricInfoCatalog([action("state.get")]);
    expect(second.catalog.recovery).toEqual({ search: "tools.search({ query, limit })", describe: "tools.describe({ ref })" });
    expect(bytes(second)).toBeLessThanOrEqual(MAX_INFO_CATALOG_BYTES);
  });

  it("excludes an oversized first reference while retaining bounded recovery metadata", () => {
    const result = fabricInfoCatalog([action("😀".repeat(MAX_INFO_CATALOG_BYTES))]);
    expect(result.actions).toEqual([]);
    expect(result.catalog).toMatchObject({ total: 1, returned: 0, complete: false, representation: "refs", digestComplete: false });
    expect(result.catalog.recovery).toEqual({ search: "tools.search({ query, limit })", describe: "tools.describe({ ref })" });
    expect(bytes(result)).toBeLessThanOrEqual(MAX_INFO_CATALOG_BYTES);
  });
});
