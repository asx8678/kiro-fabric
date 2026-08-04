import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createApi } from "../../src/api.js";
import { defaults, type FabricConfig } from "../../src/config.js";
import { FakeAiRunner } from "../../src/runners/fake.js";

it("provides deterministic seeded audit evidence", async () => {
  const root = path.resolve("test/fixtures/seeded-project");
  const config: FabricConfig = {
    ...defaults,
    projectRoot: root,
    runner: { ...defaults.runner },
    budgets: { ...defaults.budgets },
    filesystem: { ...defaults.filesystem },
    git: { ...defaults.git },
    shell: { ...defaults.shell },
    output: { ...defaults.output },
  };
  const { fabric } = createApi(config, new FakeAiRunner());
  expect(await fabric.fs.glob({ pattern: "**/*.ts" })).toEqual([
    "src/pricing.ts",
    "test/pricing.check.ts",
    "test/pricing.failing.ts",
  ]);
  expect(
    (await fabric.fs.grep({ query: "export function", glob: "src/**/*.ts" })).matches,
  ).toHaveLength(2);
  expect(await readFile(path.join(root, "designs.md"), "utf8")).toContain("Batch");
});
