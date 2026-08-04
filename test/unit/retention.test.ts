import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sweepRunArtifacts } from "../../src/runtime/executor.js";

async function makeRun(root: string, name: string, ageMs: number): Promise<void> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "final.json"), "{}");
  const atime = new Date(Date.now() - ageMs);
  await utimes(dir, atime, atime);
}

describe("run artifact retention", () => {
  it("sweeps runs older than the retention window and keeps newer ones", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fabric-retention-"));
    try {
      await makeRun(root, "run_old", 48 * 3600_000);
      await makeRun(root, "run_new", 60_000);
      await writeFile(path.join(root, "not-a-run"), "keep");
      const result = await sweepRunArtifacts(root, { runRetentionMs: 24 * 3600_000, maxRuns: 0 });
      expect(result.removed).toBe(1);
      expect((await readdir(root)).sort()).toEqual(["not-a-run", "run_new"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("caps the run count regardless of age, keeping the newest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fabric-retention-"));
    try {
      await makeRun(root, "run_a", 30_000);
      await makeRun(root, "run_b", 20_000);
      await makeRun(root, "run_c", 10_000);
      const result = await sweepRunArtifacts(root, { runRetentionMs: 0, maxRuns: 2 });
      expect(result.removed).toBe(1);
      expect((await readdir(root)).sort()).toEqual(["run_b", "run_c"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps everything when both bounds are disabled and tolerates a missing directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fabric-retention-"));
    try {
      await makeRun(root, "run_a", 365 * 24 * 3600_000);
      expect(await sweepRunArtifacts(root, { runRetentionMs: 0, maxRuns: 0 })).toEqual({
        removed: 0,
      });
      expect(await readdir(root)).toEqual(["run_a"]);
      expect(
        await sweepRunArtifacts(path.join(root, "missing"), { runRetentionMs: 1, maxRuns: 1 }),
      ).toEqual({ removed: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
