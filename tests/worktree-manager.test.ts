import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WorktreeManager,
  WorktreeContaminationError,
  acquireWriterLease,
  captureIntegrity,
  describeDrift,
  type WorktreeLease,
} from "../src/agents/worktree-manager.js";

let repo: string;
let manager: WorktreeManager;
const ids: string[] = [];

const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: repo, encoding: "utf8" });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "wt-test-"));
  sh("git", ["init", "-q"]);
  sh("git", ["config", "user.email", "t@t"]);
  sh("git", ["config", "user.name", "t"]);
  writeFileSync(join(repo, "file.txt"), "v1\n");
  sh("git", ["add", "."]);
  sh("git", ["commit", "-q", "-m", "init"]);
  manager = new WorktreeManager();
});

afterEach(() => {
  for (const id of ids.reverse()) {
    try { void manager.cleanup(id); } catch { /* ignore */ }
  }
  try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("WorktreeManager", () => {
  it("creates a read-only worktree lease by default", async () => {
    const lease = await manager.create("agent-1", repo, "scout");
    ids.push("agent-1");
    expect(lease.writeMode).toBe("read");
    expect(lease.gitRoot).toBeTruthy();
    expect(lease.path).toContain("kiro-fabric-worktrees");
  });

  it("enforces exactly one writer per patch (single-writer rule)", async () => {
    ids.push("writerA");
    const writerA = await manager.create("writerA", repo, "writer", { writeMode: "write" });
    expect(writerA.writeMode).toBe("write");

    await expect(
      manager.create("writerB", repo, "writer", { writeMode: "write" }),
    ).rejects.toThrow(/Single-writer/);

    // After the first writer releases, a second writer may proceed.
    await manager.cleanup("writerA");
    ids.push("writerB");
    const writerB = await manager.create("writerB", repo, "writer", { writeMode: "write" });
    expect(writerB.writeMode).toBe("write");
  });

  it("captures integrity and detects contamination when HEAD moves", async () => {
    ids.push("w1");
    await manager.create("w1", repo, "w", { writeMode: "write" });
    const before = await manager.markStarted("w1");
    expect(before.commit).toBeTruthy();

    // Simulate an external process moving HEAD on the source repo.
    sh("git", ["commit", "-q", "--allow-empty", "-m", "external"]);
    await expect(manager.rejectContamination("w1")).rejects.toBeInstanceOf(WorktreeContaminationError);
  });

  it("reports drift on dirty/uncommitted changes", async () => {
    ids.push("w2");
    const lease = await manager.create("w2", repo, "w", { writeMode: "write" });
    const before = await manager.markStarted("w2");
    writeFileSync(join(lease.cwd, "file.txt"), "v2\n");
    const { clean, notes } = await manager.diffAfter("w2");
    expect(clean).toBe(false);
    expect(notes.join(" ")).toMatch(/file\.txt/);
    // drift description is a pure function of the two snapshots
    const after = await captureIntegrity(lease.cwd);
    expect(describeDrift(before, after).length).toBeGreaterThan(0);
  });

  it("captureIntegrity records the tracked tree hash and porcelain status", async () => {
    const integrity = await captureIntegrity(repo);
    expect(integrity.commit).toBeTruthy();
    expect(integrity.treeHash).toBeTruthy();
    expect(integrity.cwd).toBe(repo);
  });

  it("cross-process writer lease blocks a second writer on the same repo", () => {
    // Two independent acquire calls emulate two separate Kiro/Fabric processes
    // sharing one checkout. The second must be refused until the first releases.
    const first = acquireWriterLease(repo, { owner: "run-1", branch: "b1" });
    expect(() => acquireWriterLease(repo, { owner: "run-2", branch: "b2" })).toThrow(
      /Single-writer/,
    );
    // Release frees the lease so a new writer may proceed.
    first.release();
    const second = acquireWriterLease(repo, { owner: "run-3", branch: "b3" });
    second.release();
  });
});