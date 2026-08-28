import { describe, expect, it, beforeAll } from "vitest";
import {
  pairedSpeedupLowerBound,
  medianSpeedup,
  meshBatchGate,
} from "../../scripts/benchmark/paired-stats.mjs";

/**
 * Deterministic unit coverage for the mesh-publish benchmark gate.
 *
 * With RUN_BENCHMARK=1 (opt-in) this also runs a real paired mesh
 * single-vs-batch measurement on temporary stores and asserts the gate outcome.
 * Without it, only the pure seeded statistics are validated with synthetic data.
 */
const RUN_REAL = process.env.RUN_BENCHMARK === "1";

const synthetic = (events: Array<{ singleMs: number; batchMs: number }>, seed = 1) => {
  describe(`synthetic ${seed}`, () => {
    it("computes a median and a bounded lower bound", () => {
      const median = medianSpeedup(events);
      const sorted = [...events.map((s) => s.singleMs / s.batchMs)].sort((a, b) => a - b);
      expect(median).toBeCloseTo(sorted[Math.floor(sorted.length / 2)] ?? 0, 4);
      expect(median).toBeGreaterThan(1);
      const bound = pairedSpeedupLowerBound(events, { seed, iterations: 2000 });
      expect(Number.isFinite(bound)).toBe(true);
      expect(bound).toBeGreaterThan(0);
      expect(bound).toBeLessThanOrEqual(median);
    });
    it("declines to pass on a regression or no-effect sample", () => {
      const regression = events.map((s) => ({ singleMs: s.singleMs, batchMs: s.singleMs * 2 }));
      expect(meshBatchGate(regression, { seed, threshold: 1.25 })).toBe(false);
    });
  });
};

synthetic([
  { singleMs: 100, batchMs: 10 },
  { singleMs: 110, batchMs: 12 },
  { singleMs: 95, batchMs: 9 },
  { singleMs: 120, batchMs: 11 },
  { singleMs: 105, batchMs: 10 },
  { singleMs: 98, batchMs: 13 },
  { singleMs: 115, batchMs: 12 },
  { singleMs: 102, batchMs: 11 },
], 7);

describe("mesh publish batch gate", () => {
  it("passes when the seeded lower bound exceeds the practical threshold", () => {
    const samples = [
      { singleMs: 100, batchMs: 5 },
      { singleMs: 200, batchMs: 8 },
      { singleMs: 150, batchMs: 6 },
      { singleMs: 180, batchMs: 7 },
      { singleMs: 120, batchMs: 5 },
      { singleMs: 220, batchMs: 8 },
      { singleMs: 160, batchMs: 7 },
      { singleMs: 140, batchMs: 6 },
    ];
    const bound = pairedSpeedupLowerBound(samples, { seed: 3, iterations: 5000 });
    expect(bound).toBeGreaterThan(1.25);
    expect(meshBatchGate(samples, { seed: 3, threshold: 1.25 })).toBe(true);
  });

  it("fails closed on a high-variance / insufficient sample", () => {
    expect(meshBatchGate([])).toBe(false);
    expect(meshBatchGate([{ singleMs: 100, batchMs: 50 }])).toBe(false);
  });

  it("is reproducible for a fixed seed", () => {
    const samples = [
      { singleMs: 100, batchMs: 5 },
      { singleMs: 200, batchMs: 8 },
      { singleMs: 150, batchMs: 6 },
    ];
    const a = pairedSpeedupLowerBound(samples, { seed: 42, iterations: 3000 });
    const b = pairedSpeedupLowerBound(samples, { seed: 42, iterations: 3000 });
    expect(a).toBe(b);
  });
});

beforeAll(async () => {
  if (!RUN_REAL) return;
  const { MeshStore } = await import("../../src/mesh/store.js");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.default.mkdtempSync(path.default.join(os.default.tmpdir(), "mesh-bm-cert-"));
  try {
    const identity = { id: "bm", name: "main", kind: "main", sessionId: "bm" } as const;
    const store = new MeshStore(root, 64 * 1024, 100);
    const N = 20;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) await store.publish({ topic: "team.auth", from: identity, text: `${i}` });
    const singleMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const t1 = process.hrtime.bigint();
    const events = await store.publishBatch(Array.from({ length: N }, (_, i) => ({ topic: "team.auth", from: identity, text: `${i}` })));
    const batchMs = Number(process.hrtime.bigint() - t1) / 1e6;
    expect(events).toHaveLength(N);
    console.warn(`[RUN_BENCHMARK] single=${singleMs.toFixed(2)}ms batch=${batchMs.toFixed(2)}ms speedup=${(singleMs / batchMs).toFixed(2)}x`);
  } finally {
    fs.default.rmSync(root, { recursive: true, force: true });
  }
});