import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApi } from "../../src/api.js";
import { defaults, type FabricConfig } from "../../src/config.js";
import { FakeAiRunner } from "../../src/runners/fake.js";

async function git(root: string, ...args: string[]): Promise<string> {
  return await new Promise((resolve, reject) =>
    execFile("git", args, { cwd: root }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr || error.message)) : resolve(stdout.trim()),
    ),
  );
}

async function fixture(require: "clean" | "checkpoint" = "clean", maxDiffChars = 30000) {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-mutation-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src/tracked.ts"), "before\n");
  await writeFile(path.join(root, "src/delete-me.ts"), "delete me\n");
  await git(root, "init", "-q");
  await git(root, "config", "user.name", "Fabric Test");
  await git(root, "config", "user.email", "fabric@example.invalid");
  await git(root, "add", ".");
  await git(root, "-c", "commit.gpgSign=false", "commit", "-q", "--no-verify", "-m", "initial");
  const config: FabricConfig = {
    ...defaults,
    projectRoot: root,
    runner: { ...defaults.runner },
    budgets: { ...defaults.budgets },
    filesystem: { ...defaults.filesystem, allowWrite: ["src/**"] },
    git: { ...defaults.git },
    mutation: { enabled: true, require, maxDiffChars },
    shell: { ...defaults.shell },
    output: { ...defaults.output },
  };
  return { root, config };
}

describe("safe mutation workflow", () => {
  it("denies disabled and unstarted writes, then allows writes in a clean session", async () => {
    const { root, config } = await fixture();
    try {
      const disabled = { ...config, mutation: { ...config.mutation, enabled: false } };
      await expect(
        createApi(disabled, new FakeAiRunner()).fabric.mutate.begin(),
      ).rejects.toMatchObject({ code: "POLICY_DENIED" });
      const { fabric } = createApi(config, new FakeAiRunner());
      await expect(
        fabric.fs.write({ path: "src/tracked.ts", content: "no\n" }),
      ).rejects.toMatchObject({ code: "POLICY_DENIED" });
      await expect(
        fabric.fs.patch({
          path: "src/tracked.ts",
          patch: JSON.stringify({ old: "before", new: "no" }),
        }),
      ).rejects.toMatchObject({ code: "POLICY_DENIED" });
      await fabric.mutate.begin();
      await expect(
        fabric.fs.write({ path: "src/tracked.ts", content: "after\n" }),
      ).resolves.toMatchObject({ path: "src/tracked.ts" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects dirty clean sessions and checkpoints dirty worktrees", async () => {
    const clean = await fixture();
    try {
      await writeFile(path.join(clean.root, "src/tracked.ts"), "dirty\n");
      const { fabric } = createApi(clean.config, new FakeAiRunner());
      await expect(fabric.mutate.begin()).rejects.toThrow(/src\/tracked\.ts/);
    } finally {
      await rm(clean.root, { recursive: true, force: true });
    }
    const checkpoint = await fixture("checkpoint");
    try {
      await writeFile(path.join(checkpoint.root, "src/tracked.ts"), "pre-existing\n");
      const { fabric } = createApi(checkpoint.config, new FakeAiRunner());
      const started = await fabric.mutate.begin({ label: "dirty test" });
      expect(started.checkpoint.mode).toBe("checkpoint");
      expect(started.checkpoint.id).toMatch(/^[0-9a-f]{40}$/);
      await fabric.fs.write({ path: "src/tracked.ts", content: "session\n" });
      await fabric.mutate.rollback();
      expect(await readFile(path.join(checkpoint.root, "src/tracked.ts"), "utf8")).toBe(
        "pre-existing\n",
      );
    } finally {
      await rm(checkpoint.root, { recursive: true, force: true });
    }
  });

  it("reports bounded diffs and created files", async () => {
    const { root, config } = await fixture("clean", 20);
    try {
      const { fabric } = createApi(config, new FakeAiRunner());
      await fabric.mutate.begin();
      await fabric.fs.write({ path: "src/tracked.ts", content: "a very long changed value\n" });
      await fabric.fs.write({ path: "src/created.ts", content: "created\n" });
      const result = await fabric.mutate.diff();
      expect(result.truncated).toBe(true);
      expect(result.diff.length).toBeLessThanOrEqual(20);
      expect(result.createdFiles).toEqual(["src/created.ts"]);
      expect(result.changedFiles).toEqual(["src/tracked.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back tracked modifications, deletions, and created files", async () => {
    const { root, config } = await fixture("checkpoint");
    try {
      const { fabric } = createApi(config, new FakeAiRunner());
      const started = await fabric.mutate.begin();
      await fabric.fs.write({ path: "src/tracked.ts", content: "changed\n" });
      await unlink(path.join(root, "src/delete-me.ts"));
      await fabric.fs.write({ path: "src/created.ts", content: "new\n" });
      const result = await fabric.mutate.rollback();
      expect(result).toMatchObject({
        restored: true,
        checkpoint: started.checkpoint.id,
        removedFiles: ["src/created.ts"],
      });
      expect(await readFile(path.join(root, "src/tracked.ts"), "utf8")).toBe("before\n");
      expect(await readFile(path.join(root, "src/delete-me.ts"), "utf8")).toBe("delete me\n");
      await expect(readFile(path.join(root, "src/created.ts"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        git(root, "rev-parse", `refs/fabric-lite/checkpoints/${started.checkpoint.id}`),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps checkpoint refs on complete, reviews as verifier, and rejects a second begin", async () => {
    const { root, config } = await fixture("checkpoint");
    try {
      const runner = new FakeAiRunner(() => ({ approved: true, issues: [], summary: "safe" }));
      const { fabric, metrics } = createApi(config, runner);
      const started = await fabric.mutate.begin();
      await expect(fabric.mutate.begin()).rejects.toMatchObject({ code: "RUNTIME_FAILED" });
      await fabric.fs.patch({
        path: "src/tracked.ts",
        patch: JSON.stringify({ old: "before", new: "after" }),
      });
      const review = await fabric.mutate.review();
      expect(review.value).toEqual({ approved: true, issues: [], summary: "safe" });
      expect(runner.calls[0]?.role).toBe("verifier");
      expect(metrics.aiCalls).toBe(1);
      const completed = await fabric.mutate.complete();
      expect(completed.rollbackGuidance).toContain(started.checkpoint.id);
      expect(completed.rollbackGuidance).toMatch(
        /git update-ref -d refs\/fabric-lite\/checkpoints\/cp_[a-z0-9]+_[0-9a-f]{8}/,
      );
      await expect(
        git(root, "for-each-ref", "--format=%(objectname)", "refs/fabric-lite/checkpoints"),
      ).resolves.toMatch(/^[0-9a-f]{40}$/);
      expect(await readFile(path.join(root, "src/tracked.ts"), "utf8")).toBe("after\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
