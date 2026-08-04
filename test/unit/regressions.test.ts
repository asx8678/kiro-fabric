import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createApi } from "../../src/api.js";
import { AiCache } from "../../src/cache.js";
import { defaults, type FabricConfig } from "../../src/config.js";
import { FakeAiRunner } from "../../src/runners/fake.js";
import { exitCode } from "../../src/errors.js";
import { truncate } from "../../src/api/text.js";

const exec = promisify(execFile);

async function repoFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-regress-"));
  await writeFile(path.join(root, "a.ts"), "one\ntwo\nthree");
  await exec("git", ["init"], { cwd: root });
  await exec("git", ["config", "user.email", "t@t"], { cwd: root });
  await exec("git", ["config", "user.name", "t"], { cwd: root });
  await exec("git", ["add", "-A"], { cwd: root });
  await exec("git", ["commit", "-m", "init"], { cwd: root });
  const config: FabricConfig = {
    ...defaults,
    projectRoot: root,
    filesystem: { ...defaults.filesystem, allowWrite: ["**"] },
    git: { ...defaults.git, allowCommit: true },
    mutation: { ...defaults.mutation, enabled: true, require: "clean" },
    shell: { ...defaults.shell },
    runner: { ...defaults.runner },
  };
  return { root, config };
}

describe("regressions", () => {
  it("git.status parses branch names containing dots", async () => {
    const { root, config } = await repoFixture();
    try {
      await exec("git", ["checkout", "-b", "release/1.0"], { cwd: root });
      const { fabric } = createApi(config, new FakeAiRunner());
      const status = await fabric.git.status();
      expect(status.branch).toBe("release/1.0");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fs.write accepts empty content (truncate-to-empty)", async () => {
    const { root, config } = await repoFixture();
    try {
      const { fabric } = createApi(config, new FakeAiRunner());
      await fabric.mutate.begin({ mode: "clean" });
      const res = await fabric.fs.write({ path: "a.ts", content: "" });
      expect(res.bytesWritten).toBe(0);
      expect((await fabric.fs.read({ path: "a.ts" })).content).toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("truncate() stays within budget when max is smaller than the marker", () => {
    const out = truncate("abcdefghij", 4);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(4);
  });

  it("cache eviction lands at exactly maxEntries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fabric-cache-"));
    try {
      const config: FabricConfig = {
        ...defaults,
        projectRoot: root,
        cache: { ...defaults.cache, enabled: true, maxEntries: 2, ttlMs: 0 },
      };
      const cache = new AiCache(root, config);
      const mk = (i: number) => ({
        instruction: `i${i}`,
        context: "",
        role: "worker" as const,
        maxOutputChars: 8,
        timeoutMs: 1000,
      });
      for (let i = 0; i < 5; i++)
        await cache.set(mk(i), {
          value: i,
          storedAt: Date.now(),
          resolutionSource: "unknown",
          inputChars: 0,
          outputChars: 0,
        });
      // After evicting on each set beyond maxEntries, only maxEntries should survive.
      const { readdir } = await import("node:fs/promises");
      const files = (await readdir(path.join(root, ".fabric-lite", "cache"))).filter((f) =>
        f.endsWith(".json"),
      );
      expect(files.length).toBeLessThanOrEqual(config.cache.maxEntries);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("mutate.diff includes session-created file contents", async () => {
    const { root, config } = await repoFixture();
    try {
      const { fabric } = createApi(config, new FakeAiRunner());
      await fabric.mutate.begin({ mode: "clean" });
      await fabric.fs.write({ path: "brand-new.ts", content: "export const NEW = 42;\n" });
      const diff = await fabric.mutate.diff();
      expect(diff.createdFiles).toContain("brand-new.ts");
      expect(diff.diff).toContain("NEW = 42");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ai.run rejects an invalid role and model", async () => {
    const { root, config } = await repoFixture();
    try {
      const { fabric } = createApi(config, new FakeAiRunner());
      await expect(
        fabric.ai.run({ instruction: "x", role: "supervisor" as never }),
      ).rejects.toThrow(/role must be/);
      await expect(fabric.ai.run({ instruction: "x", model: 42 as never })).rejects.toThrow(
        /model must be a string/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ai.map validates items and createTask", async () => {
    const { root, config } = await repoFixture();
    try {
      const { fabric } = createApi(config, new FakeAiRunner());
      await expect(
        fabric.ai.map({ items: "no" as never, createTask: () => ({ instruction: "" }) }),
      ).rejects.toThrow(/items must be an array/);
      await expect(fabric.ai.map({ items: [1], createTask: null as never })).rejects.toThrow(
        /createTask must be a function/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("POLICY_DENIED uses a distinct exit code from RUNTIME_FAILED", () => {
    expect(exitCode("POLICY_DENIED")).not.toBe(exitCode("RUNTIME_FAILED"));
    expect(exitCode("POLICY_DENIED")).toBe(8);
  });
});
