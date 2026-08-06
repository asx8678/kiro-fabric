import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createApi } from "../../src/api.js";
import { defaults, type FabricConfig } from "../../src/config.js";
import { FakeAiRunner } from "../../src/runners/fake.js";

const exec = promisify(execFile);

// The published contract (types/fabric-lite.d.ts) claims the worker's
// implementation is checked against it. This test exercises every fabric.*
// domain against a deterministic runner and asserts the runtime shapes match
// the declared interfaces, so the d.ts cannot silently drift.

const keys = (value: unknown): string[] => Object.keys(value as Record<string, unknown>).sort();

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-contract-"));
  await writeFile(path.join(root, "a.ts"), "one\ntwo\nthree");
  await mkdir(path.join(root, "sub"));
  await writeFile(path.join(root, "sub", "b.ts"), "hello token");
  // git init so git.* and the mutation workflow are exercisable.
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
    shell: { ...defaults.shell, enabled: false },
    runner: { ...defaults.runner },
  };
  return { root, config };
}

describe("published API contract", () => {
  it("fs.* and mutate.* return shapes matching the declaration", async () => {
    const { root, config } = await fixture();
    try {
      const { fabric } = createApi(config, new FakeAiRunner());
      expect(keys(await fabric.fs.read({ path: "a.ts" }))).toEqual([
        "chars",
        "content",
        "endLine",
        "path",
        "startLine",
        "truncated",
      ]);
      expect(Array.isArray(await fabric.fs.readMany({ paths: ["a.ts"] }))).toBe(true);
      expect(Array.isArray(await fabric.fs.glob({ pattern: "**/*.ts" }))).toBe(true);
      expect(keys(await fabric.fs.grep({ query: "two", paths: ["a.ts"] }))).toEqual([
        "files",
        "matches",
        "scannedFiles",
        "skippedFiles",
        "truncated",
      ]);
      expect(keys(await fabric.fs.stat({ path: "a.ts" }))).toEqual([
        "modifiedMs",
        "path",
        "size",
        "type",
      ]);
      const begin = await fabric.mutate.begin({ mode: "clean" });
      expect(keys(begin)).toEqual(["checkpoint", "guidance"]);
      expect(keys(begin.checkpoint)).toEqual(["baseHead", "id", "mode"]);
      expect(keys(await fabric.fs.write({ path: "new.ts", content: "" }))).toEqual([
        "bytesWritten",
        "path",
      ]);
      expect(
        keys(
          await fabric.fs.patch({
            path: "a.ts",
            patch: JSON.stringify({ old: "one", new: "ONE" }),
          }),
        ),
      ).toEqual(["applied", "path"]);
      const diff = await fabric.mutate.diff();
      expect(keys(diff)).toEqual(["changedFiles", "createdFiles", "diff", "truncated"]);
      expect(keys(await fabric.mutate.complete())).toEqual([
        "checkpoint",
        "createdFiles",
        "rollbackGuidance",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("git.* and ai.* return shapes matching the declaration", async () => {
    const { root, config } = await fixture();
    try {
      const { fabric } = createApi(config, new FakeAiRunner());
      expect(keys(await fabric.git.status())).toEqual(["branch", "clean", "entries"]);
      expect(keys(await fabric.git.diff({}))).toEqual(["diff", "truncated"]);
      expect(keys(await fabric.git.log({}))).toEqual(["text", "truncated"]);
      expect(keys(await fabric.git.show({}))).toEqual(["text", "truncated"]);
      expect(Array.isArray(await fabric.git.branches())).toBe(true);
      expect(Array.isArray(await fabric.git.remotes())).toBe(true);
      expect(Array.isArray(await fabric.git.changedFiles({}))).toBe(true);
      const run = await fabric.ai.run({ instruction: "say hi" });
      expect(keys(run)).toEqual([
        "inputChars",
        "outputChars",
        "repaired",
        "resolutionSource",
        "role",
        "value",
      ]);
      expect(Array.isArray(await fabric.ai.parallel({ tasks: [{ instruction: "x" }] }))).toBe(true);
      expect(
        Array.isArray(
          await fabric.ai.map({ items: [1], createTask: (i) => ({ instruction: String(i) }) }),
        ),
      ).toBe(true);
      expect(typeof fabric.util.chunk).toBe("function");
      expect(fabric.util.truncate("abcdef", 3)).toBe("ab…");
      expect(typeof fabric.util.compressText).toBe("function");
      expect(typeof fabric.util.toYaml).toBe("function");
      expect(fabric.payloads).toEqual({});
      await expect(fabric.shell.run({ command: "ls" })).rejects.toThrow(/disabled/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("context.* return shapes matching the declaration", async () => {
    const { root, config } = await fixture();
    try {
      const { fabric } = createApi(config, new FakeAiRunner());
      expect(keys(await fabric.context.sketch({}))).toEqual([
        "filesScanned",
        "outline",
        "repoHash",
        "testFiles",
        "totalFiles",
        "truncated",
      ]);
      const focused = await fabric.context.focus({ query: "token" });
      expect(keys(focused)).toEqual(["files", "filesScanned", "query", "repoHash", "truncated"]);
      expect(focused.files.length).toBeGreaterThan(0);
      expect(keys(focused.files[0])).toEqual([
        "hash",
        "imports",
        "path",
        "score",
        "suggestedReads",
        "symbols",
      ]);
      expect(keys(await fabric.context.impact({ path: "a.ts" }))).toEqual([
        "direct",
        "repoHash",
        "target",
        "transitive",
        "truncated",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
