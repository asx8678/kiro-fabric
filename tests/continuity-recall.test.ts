import { describe, expect, it } from "vitest";
import { snapshot } from "../src/continuity/records.js";
import { recallContinuity } from "../src/continuity/recall.js";

const source = (text: string) => snapshot({ schemaVersion: 1, taskId: `ct_${"a".repeat(32)}`, publications: [], records: [
  { sequence: 1, provenance: "declared", kind: "objective", text: "Preserve exact Unicode recovery" },
  { sequence: 2, provenance: "declared", kind: "decision", text },
] }, 1);

describe("deterministic recall Unicode windows", () => {
  it.each([
    ["a context boundary inside a surrogate pair", `😀${"x".repeat(39)}needle`],
    ["case folding that expands UTF-16 offsets", `${"İ".repeat(150)}needle`],
    ["both case-fold expansion and astral context", `${"İ😀".repeat(90)}needle`],
  ])("keeps the match and well-formed text with %s", (_label, text) => {
    const original = source(text), before = JSON.stringify(original);
    const args = { taskId: original.task.taskId, query: "NEEDLE", snippetChars: 80 };
    const result = recallContinuity(original, args, 1600);
    expect(result.total).toBe(1);
    const hit = result.hits[0]!;
    expect(hit.snippet).toContain("needle");
    expect(Buffer.from(hit.snippet, "utf8").toString("utf8")).toBe(hit.snippet);
    expect(Array.from(hit.snippet).length).toBeLessThanOrEqual(80);
    expect(hit.truncated).toBe(true);
    expect(hit.follow.args).toEqual({ taskId: original.task.taskId, expectedRevision: 1, hash: original.hash, fromSequence: 2, limit: 1 });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1600);
    expect(recallContinuity(original, args, 1600)).toEqual(result);
    expect(JSON.stringify(original)).toBe(before);
  });
});
