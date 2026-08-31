import { describe, expect, it, vi } from "vitest";
import {
  boundModelOutput,
  MAX_FAILURE_MODEL_OUTPUT_CHARS,
  modelOutputBudget,
} from "../src/output-budget.js";
import { createKiroArtifactStore } from "../src/kiro/artifacts.js";

describe("modelOutputBudget", () => {
  it("caps failures without reducing successful or stricter configured budgets", () => {
    expect(modelOutputBudget(50_000, true)).toBe(50_000);
    expect(modelOutputBudget(50_000, false)).toBe(MAX_FAILURE_MODEL_OUTPUT_CHARS);
    expect(modelOutputBudget(10_000, false)).toBe(10_000);
  });
});

describe("boundModelOutput", () => {
  it("leaves output under budget untouched", async () => {
    const writer = vi.fn(async () => "/tmp/full.txt");
    await expect(boundModelOutput("small", 1_000, "small", writer)).resolves.toEqual({
      text: "small",
      originalChars: 5,
      omittedChars: 0,
    });
    expect(writer).not.toHaveBeenCalled();
  });

  it("bounds visible text and links the complete artifact", async () => {
    const full = `start-${"x".repeat(4_000)}-end`;
    const writer = vi.fn(async () => "/tmp/kiro-fabric-output/output.txt");
    const result = await boundModelOutput(full, 1_000, full, writer);

    expect(result.text.length).toBeLessThanOrEqual(1_000);
    expect(result.text).toContain("start-");
    expect(result.text).toContain("-end");
    expect(result.text).toContain("Full output (4010 chars) saved to:");
    expect(result.artifactPath).toBe("/tmp/kiro-fabric-output/output.txt");
    expect(result.omittedChars).toBeGreaterThan(0);
    expect(writer).toHaveBeenCalledWith(full);
  });

  it("does not retain successful truncated output in an unmanaged temp path", async () => {
    const result = await boundModelOutput("x".repeat(4_000), 1_000);
    expect(result.artifactPath).toBeUndefined();
    expect(result.text).toContain("characters omitted by Pi Fabric");
  });

  it("retains Kiro output in the bounded opaque artifact store", async () => {
    const store = createKiroArtifactStore();
    const result = await boundModelOutput(
      "x".repeat(4_000),
      1_000,
      undefined,
      async (content) => store.write(content),
    );

    expect(result.artifactPath).toMatch(/^ka_/);
    expect(result.text).toContain("available as artifact");
    expect(store.read(result.artifactPath!).totalChars).toBe(4_000);
    store.close();
    expect(() => store.read(result.artifactPath!)).toThrow(/closed/);
  });

  it("stays bounded if artifact persistence fails", async () => {
    const writer = vi.fn(async () => { throw new Error("disk full"); });
    const result = await boundModelOutput("x".repeat(4_000), 1_000, undefined, writer);

    expect(result.text.length).toBeLessThanOrEqual(1_000);
    expect(result.artifactPath).toBeUndefined();
    expect(result.text).toContain("characters omitted by Pi Fabric");
  });
});
