import { describe, expect, it } from "vitest";
import { getDocs } from "../../src/docs.js";
import { defaults } from "../../src/config.js";

describe("filesystem guidance", () => {
  it("documents project-relative paths, sensitive-path denial, and permission semantics", () => {
    const docs = getDocs(undefined, true);
    expect(docs).toContain("path, paths, and cwd values are project-root-relative");
    expect(docs).toContain("`..` escapes are denied");
    expect(docs).toContain("scannedFiles/skippedFiles");
    expect(docs).toContain("Allow session authorizes the entire permission category");
    // The dev-repo layout must never leak into shipped, user-facing docs.
    expect(docs).not.toContain("pi-fabric");
    // Writes are allowlisted, not human-approved per-write.
    expect(docs).toContain("never prompted per-write");
  });

  it("keeps docs and prompts consistent with the shipped defaults", () => {
    const docs = getDocs(undefined, true);
    // The default AI call budget in docs must match config.ts.
    expect(docs).toContain(`default AI call budget is ${defaults.budgets.maxAiCalls} calls`);
    // compactDocs must not claim writes are disabled when they default to allowed.
    expect(docs).not.toContain("policy-disabled by default");
    expect(defaults.filesystem.allowWrite).toEqual(["**"]);
    expect(defaults.mutation.enabled).toBe(true);
  });
});
