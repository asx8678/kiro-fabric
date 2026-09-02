import { describe, expect, it } from "vitest";
import { uniquePackageRecords } from "../scripts/package-identity.mjs";

describe("closure dependency identity", () => {
  it("keeps two versions of the same package as separate SBOM inputs", () => {
    const records = uniquePackageRecords([
      { name: "fixture", version: "1.0.0", license: "MIT", root: "/one" },
      { name: "fixture", version: "2.0.0", license: "MIT", root: "/two" },
      { name: "fixture", version: "1.0.0", license: "MIT", root: "/one" },
    ]);
    expect(records.map(({ name, version }) => [name, version])).toEqual([
      ["fixture", "1.0.0"],
      ["fixture", "2.0.0"],
    ]);
  });
});
