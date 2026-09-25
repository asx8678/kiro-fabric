import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFacts, parseTask, snapshot, taskHash, type ContinuityTask } from "../src/continuity/records.js";
import { renderContinuity } from "../src/continuity/render.js";

const task = (count = 12): ContinuityTask => ({ schemaVersion: 1, taskId: `ct_${"a".repeat(32)}`, publications: [],
  records: Array.from({ length: count }, (_, index) => ({ sequence: index + 1, provenance: "declared",
    kind: index === 0 ? "objective" : "next-step", text: index === 0 ? "Original objective" : `Fact ${index}: 😀 ${'"\\\n'.repeat(20)}` })),
});
afterEach(() => vi.restoreAllMocks());
describe("deterministic continuity projection", () => {
  it("normalizes key order and produces identical bytes without consulting the clock", () => {
    const original = task(), reordered = JSON.parse(JSON.stringify(original, Object.keys({ text: 0, kind: 0, provenance: 0, sequence: 0, records: 0, publications: 0, taskId: 0, schemaVersion: 0 })));
    expect(taskHash(parseTask(reordered))).toBe(taskHash(original));
    const source = snapshot(original, 4);
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("renderer consulted the clock"); });
    const first = JSON.stringify(renderContinuity(source));
    for (let cycle = 0; cycle < 100; cycle++) expect(JSON.stringify(renderContinuity(source))).toBe(first);
    expect(clock).not.toHaveBeenCalled();
    expect(original.records[0]!.text).toBe("Original objective");
  });
  it("bounds escaped envelopes and complete Unicode records, with exact omission addresses", () => {
    const source = snapshot(task(60), 7);
    const result = renderContinuity(source, 1400, 2000);
    expect(Buffer.byteLength(result.summary)).toBeLessThanOrEqual(1400);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(2000);
    expect(Buffer.from(result.summary).toString("utf8")).toBe(result.summary);
    expect(result.coverage.shownRecords).toBeGreaterThan(0);
    expect(result.coverage.omittedRecords).toBeGreaterThan(0);
    const omitted = result.omittedRange!;
    expect(omitted.throughSequence - omitted.fromSequence + 1).toBe(result.coverage.omittedRecords);
    for (const record of source.task.records) {
      const shown = record.sequence < omitted.fromSequence || record.sequence > omitted.throughSequence;
      expect(result.summary.includes(`[${record.sequence}] ${JSON.stringify(record.text)}`)).toBe(shown);
    }
    expect(result.coverage).toMatchObject({ conversation: "not-captured", operations: "not-captured" });
    expect(result.summary).toContain(source.hash);
    expect(result.summary).toContain("work after the last checkpoint is unknown");
  });
  it("renders all records when they fit and never drops the footer to fit a tiny budget", () => {
    const source = snapshot(task(2), 1);
    expect(renderContinuity(source).omittedRange).toBeNull();
    expect(() => renderContinuity(source, 10)).toThrow("budget too small");
    expect(() => renderContinuity(source, 8192, 300)).toThrow("budget too small");
    expect(() => renderContinuity(source, 16385)).toThrow("invalid");
    expect(() => renderContinuity({ ...source, hash: "b".repeat(64) })).toThrow("hash mismatch");
  });
  it("accepts exact-fit complete output even when omission metadata would exceed that budget", () => {
    const source = snapshot(task(1), 1);
    const complete = renderContinuity(source);
    const summaryBytes = Buffer.byteLength(complete.summary);
    const envelopeBytes = Buffer.byteLength(JSON.stringify(complete));
    expect(renderContinuity(source, summaryBytes, envelopeBytes)).toEqual(complete);
  });
  it("can retain a small recent record when a large objective does not fit", () => {
    const original = task(2); original.records[0]!.text = "😀".repeat(512); original.records[1]!.text = "Recent next step";
    const result = renderContinuity(snapshot(original, 1), 1024, 1800);
    expect(result.summary).toContain("Recent next step");
    expect(result.omittedRange).toEqual({ fromSequence: 1, throughSequence: 1 });
  });
  it("accepts valid declarations through the public parser", () => {
    const facts = [{ kind: "objective", text: "Valid objective" }];
    expect(parseFacts(facts)).toEqual(facts);
  });
  it.each([
    { kind: "decision", text: "test passed", provenance: "host-observed" },
    { kind: "decision", text: "test passed", verified: true },
    { kind: "observed-operation", text: "test passed" },
    { kind: "objective", text: "\ud800" },
    { kind: "objective", text: "😀".repeat(513) },
    { kind: "objective", text: " " },
  ])("rejects forged or malformed declarations %#", value => expect(() => parseFacts([value])).toThrow());
  it("rejects old summaries, unknown versions, duplicate sequences and forged stored provenance", () => {
    expect(() => parseTask({ ...task(), summary: "POISON PREVIOUS SUMMARY" })).toThrow();
    expect(() => parseTask({ ...task(), schemaVersion: 2 })).toThrow();
    const duplicate = task(); duplicate.records[1]!.sequence = 1;
    expect(() => parseTask(duplicate)).toThrow();
    const forged = JSON.parse(JSON.stringify(task())); forged.records[0].provenance = "host-observed";
    expect(() => parseTask(forged)).toThrow();
  });
});
