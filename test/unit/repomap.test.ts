import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApi } from "../../src/api.js";
import { defaults, type FabricConfig } from "../../src/config.js";
import { FakeAiRunner } from "../../src/runners/fake.js";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-repomap-"));
  await mkdir(path.join(root, "src/api"), { recursive: true });
  await mkdir(path.join(root, "src/runners"), { recursive: true });
  await mkdir(path.join(root, "test/unit"), { recursive: true });
  await mkdir(path.join(root, "node_modules/pkg"), { recursive: true });
  await writeFile(
    path.join(root, "src/api/parser.ts"),
    [
      'import { helper } from "../runners/helper";',
      'import { ai } from "./ai";',
      "",
      "export function parseFramed(stdout: string): unknown {",
      "  return helper(stdout);",
      "}",
      "",
      "export class FrameError extends Error {}",
      "",
      "export const MAX_CHARS = 16000;",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "src/api/ai.ts"),
    [
      'import { parseFramed } from "./parser";',
      "",
      "export function ai(): void {",
      "  parseFramed;",
      "}",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "src/runners/helper.ts"),
    ["export function helper(text: string): string {", "  return text;", "}"].join("\n"),
  );
  await writeFile(
    path.join(root, "test/unit/parser.test.ts"),
    'import { parseFramed } from "x";\n',
  );
  await writeFile(path.join(root, "node_modules/pkg/index.ts"), "export const hidden = 1;");
  const config: FabricConfig = {
    ...defaults,
    projectRoot: root,
    budgets: { ...defaults.budgets },
    filesystem: { ...defaults.filesystem, allowWrite: [] },
    git: { ...defaults.git },
    shell: { ...defaults.shell },
    runner: { ...defaults.runner },
    output: { ...defaults.output },
    mutation: { ...defaults.mutation, enabled: false },
  };
  return { root, config };
}

describe("fabric.context", () => {
  it("sketch returns a production-first bounded silhouette", async () => {
    const { root, config } = await fixture();
    try {
      const { fabric } = createApi(config, new FakeAiRunner());
      const sketch = await fabric.context.sketch({ maxChars: 4000 });
      expect(sketch.repoHash).toMatch(/^[0-9a-f]{16}$/);
      expect(sketch.filesScanned).toBe(4); // node_modules excluded
      expect(sketch.testFiles).toBe(1);
      expect(sketch.outline).toContain("src/api/parser.ts");
      expect(sketch.outline).toContain("function parseFramed");
      expect(sketch.outline).not.toContain("test/unit/parser.test.ts");
      expect(sketch.outline).not.toContain("node_modules");
      expect(sketch.outline.length).toBeLessThanOrEqual(4000);
      const withTests = await fabric.context.sketch({ maxChars: 4000, includeTests: true });
      expect(withTests.outline).toContain("test/unit/parser.test.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("sketch degrades deterministically under a tight budget", async () => {
    const { root, config } = await fixture();
    try {
      const { fabric } = createApi(config, new FakeAiRunner());
      const tight = await fabric.context.sketch({ maxChars: 200 });
      expect(tight.outline.length).toBeLessThanOrEqual(200);
      expect(tight.truncated).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("focus ranks symbol matches and suggests read ranges", async () => {
    const { root, config } = await fixture();
    try {
      const { fabric } = createApi(config, new FakeAiRunner());
      const focused = await fabric.context.focus({ query: "parseFramed" });
      expect(focused.files.length).toBeGreaterThan(0);
      const top = focused.files[0]!;
      expect(top.path).toBe("src/api/parser.ts");
      expect(top.symbols[0]).toMatchObject({ name: "parseFramed", kind: "function", line: 4 });
      expect(top.imports).toContain("src/runners/helper");
      expect(top.suggestedReads[0]).toMatchObject({ path: "src/api/parser.ts", startLine: 1 });
      expect(focused.repoHash).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("impact computes reverse imports and symbol references", async () => {
    const { root, config } = await fixture();
    try {
      const { fabric } = createApi(config, new FakeAiRunner());
      const byPath = await fabric.context.impact({ path: "src/runners/helper.ts" });
      expect(byPath.direct).toEqual(["src/api/parser.ts"]);
      // test/unit/parser.test.ts imports "x", not the parser, so only ai.ts is one hop out.
      expect(byPath.transitive).toEqual(["src/api/ai.ts"]);
      const bySymbol = await fabric.context.impact({ symbol: "parseFramed" });
      expect(bySymbol.direct).toContain("src/api/ai.ts");
      const directOnly = await fabric.context.impact({
        path: "src/runners/helper.ts",
        transitive: false,
      });
      expect(directOnly.transitive).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("validates arguments and denies traversal", async () => {
    const { root, config } = await fixture();
    try {
      const { fabric } = createApi(config, new FakeAiRunner());
      await expect(fabric.context.focus({ query: "" })).rejects.toThrow(/query/);
      await expect(fabric.context.focus({ query: "a" })).rejects.toThrow(/2 characters/);
      await expect(fabric.context.impact({})).rejects.toThrow(/path or symbol/);
      await expect(fabric.context.impact({ path: "../outside.ts" })).rejects.toThrow(
        /inside the project/,
      );
      await expect(fabric.context.impact({ path: "node_modules/pkg/index.ts" })).rejects.toThrow(
        /denied/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
