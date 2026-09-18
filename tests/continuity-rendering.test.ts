import { describe, expect, it, vi } from "vitest";
import { renderContinuity } from "../src/continuity/render.js";
import { assessChecks, renderTaskView } from "../src/continuity/task-view.js";
import { snapshot } from "../src/continuity/records.js";
import { SummaryBudget, summaryLine } from "../src/continuity/summary-budget.js";
import { projectionFingerprint, renderingFixture, RENDERING_FIXTURES } from "./fixtures/continuity-rendering.js";

// Recorded from the original renderers before optimization. Each fingerprint
// covers 40 budget combinations plus exact-fit and one-byte boundary cases.
const fingerprints = [
  ["d3637583c6d5af1910e020227c228637d7f244bc50e757a60b04775bdc329fb2", "acc2a7dbf921bbe2a02343b825f76126f3f3cb63d729e929f7cb17071ad630c4"],
  ["2dbc701be163bd6480473ddf8a1d952de8f4d51fe106252458e67754cf97db18", "176614dbc4046df883d351949add2192e064f3b6760a9ebd32717d886e1df9ae"],
  ["0874124f86dffae83bb04429399c1b285cb3494e7d2af740079c1fe06b8fdda3", "6367c5b5ce558110d20d6fb7f4ab3b2e18515c0e1257d0f30f6cc08d95591595"],
  ["06f6adf299e1cbfe5c80430284b27932c875dd9063c45971a5aa5efc21fb306f", "ebbb45a44a3623d914df5d9863e88c2b0fa98670e01ecb87caca2e2bb6aa269e"],
  ["20e2af913bcb3583a87371f728d7c9b9eab695db6d382ab419cbda2a45b2c14b", "942a954c54c12b6e74fed89cd174b6d3a84c6af0cffb22d8753e46fb9abb3267"],
  ["1eb417610e20cb1bcfc74b6d94e95ee72f91eed3e3ddf83773606e9fc299c899", "b6f4f4f57ac3e4363f473e8455e8b05f11b4846ee2d6d887638ee3c58b9a578a"],
  ["fe0f3ce1996c3e67dd25ad88757e546018de66618c14c98c981eeb9bad7962d5", "4e79db475eca4e2ca3d43a4eea8c9a12584a88068fd6aea4223f1e9c76424fd1"],
  ["6f21d67cc85869158f5d4e811bbceeaef6821ccb4b6a1be4f7207cd8ac387bc1", "495414b92dcce96f7a428761b3c1aff6986afe2ccf50276d5287845a2b019107"],
] as const;

describe("continuity rendering compatibility and work bounds", () => {
  it.each(RENDERING_FIXTURES.map(([version, count], index) => ({ version, count, expected: fingerprints[index]! })))
  ("preserves v$version output/error bytes for $count facts across output budgets", ({ version, count, expected }) => {
    const source = renderingFixture(version, count), checks = assessChecks(source, () => "c".repeat(64));
    expect(projectionFingerprint((summary, result) => renderContinuity(source, summary, result))).toBe(expected[0]);
    expect(projectionFingerprint((summary, result) => renderTaskView(source, checks, summary, result))).toBe(expected[1]);
  });

  it.each(["task", "continuity"] as const)("serializes records once rather than once per candidate in %s views", view => {
    const source = snapshot({ schemaVersion: 1, taskId: `ct_${"a".repeat(32)}`, publications: [],
      records: Array.from({ length: 512 }, (_, i) => ({ sequence: i + 1, provenance: "declared", kind: i === 0 ? "objective" : "next-step", text: `step ${i}` })),
    }, 1);
    const stringify = vi.spyOn(JSON, "stringify");
    let result;
    try {
      result = view === "task" ? renderTaskView(source, [], 4096, 24000) : renderContinuity(source, 4096, 24000);
      expect(stringify.mock.calls.length).toBeLessThan(6 * source.task.records.length + 80);
      if (view === "task") expect(stringify.mock.calls.filter(([value]) => value && typeof value === "object" && "sequence" in value)).toHaveLength(512);
    } finally { stringify.mockRestore(); }
    expect(Buffer.byteLength(result.summary)).toBeLessThanOrEqual(4096);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
    expect(result.coverage.omittedRecords).toBeGreaterThan(0);
  });

  it("counts escaped UTF-8, separators, removals and changing footers exactly", () => {
    const lines = ["", "😀雪", '"\\\n\t\u0000', "\ud800", "\udc00"].map(summaryLine);
    const budget = new SummaryBudget();
    const envelope = { summary: "", metadata: { text: '"😀' } };
    const check = (selected: typeof lines, extra: typeof lines = []) => {
      const text = [...selected, ...extra].map(line => line.text).join("\n");
      const summaryBytes = Buffer.byteLength(text), resultBytes = Buffer.byteLength(JSON.stringify({ ...envelope, summary: text }));
      expect(budget.fits(envelope, summaryBytes, resultBytes, extra)).toBe(true);
      expect(budget.fits(envelope, summaryBytes - 1, resultBytes, extra)).toBe(false);
      expect(budget.fits(envelope, summaryBytes, resultBytes - 1, extra)).toBe(false);
    };
    check([]);
    for (let i = 0; i < lines.length; i++) { budget.add(lines[i]!); check(lines.slice(0, i + 1), [summaryLine("footer\n😀")]); }
    for (let i = lines.length - 1; i >= 0; i--) { budget.remove(lines[i]!); check(lines.slice(0, i)); }
  });
});
