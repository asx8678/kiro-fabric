import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaults, loadConfig } from "../../src/config.js";

const roots: string[] = [];

async function configRoot(value: unknown): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-config-"));
  roots.push(root);
  await mkdir(path.join(root, ".fabric-lite"));
  await writeFile(path.join(root, ".fabric-lite/config.json"), JSON.stringify(value));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("loadConfig validation", () => {
  it.each([
    { shell: { enabled: "yes" } },
    { git: { allowCommit: "yes" } },
    { mutation: { enabled: "yes" } },
    { mutation: { require: "dirty" } },
    { mutation: { maxDiffChars: 0 } },
    { cache: { enabled: "yes" } },
    { cache: { maxEntries: 0 } },
    { cache: { ttlMs: -1 } },
    { git: { surprise: true } },
    { permissions: { execute: "sometimes" } },
    { permissions: { commit: true } },
    { filesystem: { allowWrite: ["src/**", 1] } },
    { filesystem: { allowWrite: ["../outside/**"] } },
    { filesystem: { allowWrite: ["/tmp/**"] } },
    { budgets: { maxRetriesPerCall: -1 } },
    { budgets: { aiCallTimeoutMs: 0 } },
    { runner: { type: "other" } },
    { output: { includeMetrics: 1 } },
    { shell: { surprise: true } },
  ])("rejects malformed or unknown policy fields: %j", async (patch) => {
    const root = await configRoot(patch);
    await expect(loadConfig(root)).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  });

  it.each([
    '{"__proto__":{"polluted":true}}',
    '{"shell":{"constructor":{"polluted":true}}}',
    '{"runner":{"prototype":{"polluted":true}}}',
  ])("rejects dangerous keys at any depth", async (json) => {
    const root = await configRoot(JSON.parse(json));
    await expect(loadConfig(root)).rejects.toMatchObject({ code: "CONFIG_ERROR" });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("merges valid partial config with independent defaults", async () => {
    const root = await configRoot({
      version: 1,
      budgets: { maxConcurrency: 2, maxRetriesPerCall: 0 },
      shell: { enabled: true, allowedCommands: ["git status"] },
      mutation: { enabled: true, maxDiffChars: 123 },
      cache: { enabled: true, maxEntries: 4 },
    });
    const config = await loadConfig(root);
    expect(config.projectRoot).toBe(root);
    expect(config.budgets).toMatchObject({
      maxConcurrency: 2,
      maxRetriesPerCall: 0,
      maxAiCalls: defaults.budgets.maxAiCalls,
    });
    expect(config.git).toEqual({ allowCommit: false });
    expect(config.mutation).toMatchObject({ enabled: true, require: "clean", maxDiffChars: 123 });
    expect(config.cache).toEqual({ enabled: true, maxEntries: 4, ttlMs: defaults.cache.ttlMs });
    expect(config.permissions).toEqual(defaults.permissions);
    expect(config.shell).toMatchObject({
      enabled: true,
      allowedCommands: ["git status"],
      timeoutMs: defaults.shell.timeoutMs,
    });
    expect(defaults.mutation).toEqual({ enabled: false, require: "clean", maxDiffChars: 30000 });
    expect(defaults.cache).toEqual({ enabled: false, maxEntries: 200, ttlMs: 0 });
  });
});