import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../../src/api.js";
import { defaults, type FabricConfig } from "../../src/config.js";
import { FakeAiRunner } from "../../src/runners/fake.js";

const roots: string[] = [];
const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };

async function fixture(cache: Partial<FabricConfig["cache"]> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-cache-"));
  roots.push(root);
  const config: FabricConfig = {
    ...defaults,
    projectRoot: root,
    cache: { ...defaults.cache, ...cache },
    runner: { ...defaults.runner, type: "fake" },
    budgets: { ...defaults.budgets },
    filesystem: { ...defaults.filesystem },
    git: { ...defaults.git },
    mutation: { ...defaults.mutation },
    shell: { ...defaults.shell },
    output: { ...defaults.output },
  };
  return { root, config };
}

async function cacheFiles(root: string): Promise<string[]> {
  try {
    return (await readdir(path.join(root, ".fabric-lite/cache"))).filter((file) =>
      file.endsWith(".json"),
    );
  } catch {
    return [];
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("AI call cache", () => {
  it("is disabled by default and does not create a cache directory", async () => {
    const { root, config } = await fixture();
    const runner = new FakeAiRunner();
    const { fabric } = createApi(config, runner);
    await fabric.ai.run({ instruction: "same" });
    await fabric.ai.run({ instruction: "same" });
    expect(runner.calls).toHaveLength(2);
    await expect(access(path.join(root, ".fabric-lite/cache"))).rejects.toBeDefined();
  });

  it("returns identical values from an enabled cache and records hits", async () => {
    const { root, config } = await fixture({ enabled: true });
    const runner = new FakeAiRunner(() => ({ ok: true }));
    const { fabric, metrics } = createApi(config, runner);
    const first = await fabric.ai.run({ instruction: "same", outputSchema: schema });
    const second = await fabric.ai.run({ instruction: "same", outputSchema: schema });
    expect(runner.calls).toHaveLength(1);
    expect(second.value).toEqual(first.value);
    expect(first.cached).toBeUndefined();
    expect(second.cached).toBe(true);
    expect(metrics.cacheHits).toBe(1);
    expect(await cacheFiles(root)).toHaveLength(1);
  });

  it("includes context, schema, and role in the key", async () => {
    const { config } = await fixture({ enabled: true });
    const runner = new FakeAiRunner(() => ({ ok: true, other: "value" }));
    const { fabric } = createApi(config, runner);
    await fabric.ai.run({ instruction: "same", context: "one", outputSchema: schema });
    await fabric.ai.run({ instruction: "same", context: "two", outputSchema: schema });
    await fabric.ai.run({
      instruction: "same",
      context: "one",
      outputSchema: { ...schema, required: ["ok", "other"] },
    });
    await fabric.ai.run({
      instruction: "same",
      context: "one",
      role: "planner",
      outputSchema: schema,
    });
    expect(runner.calls).toHaveLength(4);
  });

  it("does not spend an AI call budget on a cache hit", async () => {
    const { config } = await fixture({ enabled: true });
    config.budgets = { ...config.budgets, maxAiCalls: 1, maxWorkerCalls: 1 };
    const runner = new FakeAiRunner();
    const { fabric, metrics } = createApi(config, runner);
    await fabric.ai.run({ instruction: "budget" });
    await expect(fabric.ai.run({ instruction: "budget" })).resolves.toMatchObject({ cached: true });
    expect(metrics.aiCalls).toBe(1);
  });

  it("caches the final value after JSON repair, not the repair request", async () => {
    const { config } = await fixture({ enabled: true });
    const runner = new FakeAiRunner((_request, call) => (call === 1 ? "invalid" : { ok: true }));
    const { fabric } = createApi(config, runner);
    const first = await fabric.ai.run({ instruction: "repair me", outputSchema: schema });
    const second = await fabric.ai.run({ instruction: "repair me", outputSchema: schema });
    expect(first.repaired).toBe(true);
    expect(second).toMatchObject({ value: { ok: true }, repaired: false, cached: true });
    expect(runner.calls).toHaveLength(2);
  });

  it("treats corrupt entries as misses and overwrites them", async () => {
    const { root, config } = await fixture({ enabled: true });
    const runner = new FakeAiRunner();
    const { fabric } = createApi(config, runner);
    await fabric.ai.run({ instruction: "corrupt" });
    const file = path.join(root, ".fabric-lite/cache", (await cacheFiles(root))[0]!);
    await writeFile(file, "not json", "utf8");
    const result = await fabric.ai.run({ instruction: "corrupt" });
    expect(result.cached).toBeUndefined();
    expect(runner.calls).toHaveLength(2);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ value: { ok: true } });
  });

  it("refetches expired entries", async () => {
    const { root, config } = await fixture({ enabled: true, ttlMs: 1000 });
    const runner = new FakeAiRunner();
    const { fabric } = createApi(config, runner);
    await fabric.ai.run({ instruction: "expires" });
    const file = path.join(root, ".fabric-lite/cache", (await cacheFiles(root))[0]!);
    const entry = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    entry.storedAt = 0;
    await writeFile(file, JSON.stringify(entry), "utf8");
    const result = await fabric.ai.run({ instruction: "expires" });
    expect(result.cached).toBeUndefined();
    expect(runner.calls).toHaveLength(2);
  });

  it("keeps the cache bounded with eviction", async () => {
    const { root, config } = await fixture({ enabled: true, maxEntries: 2 });
    const runner = new FakeAiRunner();
    const { fabric } = createApi(config, runner);
    for (const instruction of ["one", "two", "three"]) await fabric.ai.run({ instruction });
    expect(await cacheFiles(root)).toHaveLength(2);
  });
});
