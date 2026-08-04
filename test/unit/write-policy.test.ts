import { expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { updateWritePolicy } from "../../src/write-policy.js";

type Config = {
  version: number;
  projectRoot: string;
  runner: { executable: string; defaultModel: string | null };
  budgets: { maxAiCalls: number };
  filesystem: { allowWrite: string[]; denySymlinkEscape: boolean };
  mutation: { enabled: boolean; require: "clean" | "checkpoint"; maxDiffChars: number };
  permissions: { destructive: string };
  shell: { enabled: boolean };
};

const customConfig: Config = {
  version: 1,
  projectRoot: ".",
  runner: { executable: "kiro-cli", defaultModel: null },
  budgets: { maxAiCalls: 42 },
  filesystem: { allowWrite: ["src/**"], denySymlinkEscape: true },
  mutation: { enabled: false, require: "clean", maxDiffChars: 54321 },
  permissions: { destructive: "deny" },
  shell: { enabled: true },
};

async function writeConfig(root: string, config: unknown) {
  await mkdir(path.join(root, ".fabric-lite"), { recursive: true });
  await writeFile(path.join(root, ".fabric-lite/config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

async function readConfig(root: string): Promise<Config> {
  return JSON.parse(await readFile(path.join(root, ".fabric-lite/config.json"), "utf8")) as Config;
}

it("migrates an existing read-only config to workspace-editable, preserving other settings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-policy-edit-"));
  try {
    await writeConfig(root, customConfig);
    const report = await updateWritePolicy({ root, writeAccess: "workspace", dryRun: false });
    expect(report.ok).toBe(true);
    expect(report.changed).toBe(true);

    const config = await readConfig(root);
    expect(config.filesystem.allowWrite).toEqual(["**"]);
    expect(config.mutation.enabled).toBe(true);
    expect(config.mutation.require).toBe("checkpoint");
    // Preserve unrelated settings.
    expect(config.budgets.maxAiCalls).toBe(42);
    expect(config.runner.executable).toBe("kiro-cli");
    expect(config.permissions.destructive).toBe("deny");
    expect(config.filesystem.denySymlinkEscape).toBe(true);
    expect(config.shell.enabled).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("migrates an existing editable config to read-only, preserving unrelated mutation limits", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-policy-read-"));
  try {
    const editable: Config = { ...customConfig, filesystem: { ...customConfig.filesystem, allowWrite: ["**"] }, mutation: { ...customConfig.mutation, enabled: true, require: "checkpoint" } };
    await writeConfig(root, editable);
    const report = await updateWritePolicy({ root, writeAccess: "read", dryRun: false });
    expect(report.ok).toBe(true);
    expect(report.changed).toBe(true);

    const config = await readConfig(root);
    expect(config.filesystem.allowWrite).toEqual([]);
    expect(config.mutation.enabled).toBe(false);
    // Preserve sensible unrelated mutation limits.
    expect(config.mutation.maxDiffChars).toBe(54321);
    expect(config.mutation.require).toBe("checkpoint");
    expect(config.budgets.maxAiCalls).toBe(42);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("is a no-op when the config already matches the requested mode", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-policy-noop-"));
  try {
    await writeConfig(root, { ...customConfig, filesystem: { ...customConfig.filesystem, allowWrite: ["**"] }, mutation: { ...customConfig.mutation, enabled: true, require: "checkpoint" } });
    const report = await updateWritePolicy({ root, writeAccess: "workspace", dryRun: false });
    expect(report.changed).toBe(false);
    const after = await readConfig(root);
    expect(after.filesystem.allowWrite).toEqual(["**"]);
    expect(after.mutation.enabled).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects an invalid/missing config before modifying anything", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-policy-invalid-"));
  try {
    await mkdir(path.join(root, ".fabric-lite"), { recursive: true });
    await writeFile(path.join(root, ".fabric-lite/config.json"), "{ not json ");
    await expect(updateWritePolicy({ root, writeAccess: "workspace", dryRun: false })).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects a missing config with CONFIG_ERROR", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-policy-missing-"));
  try {
    await expect(updateWritePolicy({ root, writeAccess: "workspace", dryRun: false })).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("dry-run reports the preview without writing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-policy-dry-"));
  try {
    await writeConfig(root, customConfig);
    const report = await updateWritePolicy({ root, writeAccess: "workspace", dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.changed).toBe(true);
    expect(report.filesystem.allowWrite).toEqual(["**"]);
    expect(report.mutation.enabled).toBe(true);
    // The file on disk is untouched.
    const config = await readConfig(root);
    expect(config.filesystem.allowWrite).toEqual(["src/**"]);
    expect(config.mutation.enabled).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});