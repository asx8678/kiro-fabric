import { describe, expect, it } from "vitest";
import { getDocs } from "../../src/docs.js";

describe("filesystem guidance", () => {
  it("directs Kiro to the contained nested reference checkout", () => {
    const docs = getDocs(undefined, true);
    expect(docs).toContain("path, paths, and cwd values are project-root-relative");
    expect(docs).toContain("`..` escapes are denied");
    expect(docs).toContain("use `pi-fabric`, never `../pi-fabric`");
  });
});