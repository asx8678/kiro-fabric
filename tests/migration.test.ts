import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openKiroMemory } from "../src/kiro/memory.js";
import {
  prepareKiroPowerDataPaths,
  prepareKiroPowerProjectPaths,
  type KiroPowerWorkspaceIdentity,
} from "../src/kiro/power/data-paths.js";

const roots: string[] = [];
const temporary = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-migration-"));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  return root;
};
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });
const workspaceId = (identity: KiroPowerWorkspaceIdentity, generation: 2 | 3): string => createHash("sha256")
  .update(`kiro-fabric-power-workspace-v${generation}\0`).update(identity.canonicalPath).update("\0")
  .update(identity.deviceId).update("\0").update(identity.fileId).digest("hex");
const memoryNamespace = (identity: KiroPowerWorkspaceIdentity): string =>
  `project:${createHash("sha256").update(identity.canonicalPath).digest("hex")}`;
const encodedName = (value: string): string => encodeURIComponent(value)
  .replace(/[!'()*]/gu, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const memoryNamespaceDirectory = (namespace: string): string =>
  `${encodedName(namespace)}-${createHash("sha256").update(namespace).digest("hex").slice(0, 16)}`;
const writePrivateJson = (target: string, value: unknown): void => {
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
};
const seedIdentity = (root: string, identity: KiroPowerWorkspaceIdentity): void => {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  writePrivateJson(path.join(root, "workspace-identity.json"), identity);
};
const seedMemory = (memoryRoot: string, namespace: string, key: string, value: unknown): string => {
  const scopedRoot = path.join(memoryRoot, "memory");
  const namespaceRoot = path.join(scopedRoot, memoryNamespaceDirectory(namespace));
  fs.mkdirSync(namespaceRoot, { recursive: true, mode: 0o700 });
  for (const directory of [memoryRoot, scopedRoot, namespaceRoot]) fs.chmodSync(directory, 0o700);
  writePrivateJson(path.join(scopedRoot, ".kiro-fabric-owner"), {
    format: 1, owner: "kiro-fabric", kind: "memory-root", root: memoryRoot,
  });
  writePrivateJson(path.join(namespaceRoot, ".kiro-fabric-owner"), {
    format: 1, owner: "kiro-fabric", kind: "memory-namespace", root: memoryRoot, namespace,
  });
  const entry = path.join(namespaceRoot, `${encodedName(key)}.json`);
  writePrivateJson(entry, {
    format: 1, owner: "kiro-fabric", kind: "memory-entry", namespace, key, value,
    updatedAt: "2026-01-02T03:04:05.000Z",
  });
  return entry;
};

const verifiedIdentity = (workspace: string): KiroPowerWorkspaceIdentity => {
  const stats = fs.statSync(workspace);
  return {
    schemaVersion: 1,
    canonicalPath: fs.realpathSync(workspace),
    deviceId: String(stats.dev),
    fileId: String(stats.ino),
  };
};

describe("retained Power data migration", () => {
  it("migrates the prior MCP filename once with private permissions", () => {
    const pluginData = temporary();
    const config = path.join(pluginData, "fabric", "config");
    fs.mkdirSync(config, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(pluginData, "fabric"), 0o700);
    const legacy = { mcpServers: { fixture: { command: "fixture", args: [] } }, imports: [] };
    fs.writeFileSync(path.join(config, "mcporter.json"), `${JSON.stringify(legacy)}\n`, { mode: 0o600 });
    const first = prepareKiroPowerDataPaths(pluginData);
    expect(JSON.parse(fs.readFileSync(first.mcpConfig, "utf8"))).toEqual(legacy);
    expect(fs.statSync(first.mcpConfig).mode & 0o777).toBe(0o600);
    const second = prepareKiroPowerDataPaths(pluginData);
    expect(second.mcpConfig).toBe(first.mcpConfig);
    expect(fs.existsSync(path.join(first.root, "migration-report.json"))).toBe(true);
  });

  it("preserves distinct successive legacy fabric configurations in private quarantine files", () => {
    const pluginData = temporary();
    const config = path.join(pluginData, "fabric", "config");
    fs.mkdirSync(config, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(pluginData, "fabric"), 0o700);
    const first = '{"memory":{"maxEntries":11}}\n';
    const second = '{"memory":{"maxEntries":22}}\n';
    fs.writeFileSync(path.join(config, "fabric.json"), first, { mode: 0o600 });
    const data = prepareKiroPowerDataPaths(pluginData);
    fs.writeFileSync(path.join(config, "fabric.json"), second, { mode: 0o600 });
    prepareKiroPowerDataPaths(pluginData);

    const quarantineFiles = fs.readdirSync(path.join(data.root, "quarantine"))
      .filter(name => name.startsWith("legacy-fabric") && name.endsWith(".json"));
    expect(quarantineFiles).toHaveLength(2);
    expect(quarantineFiles.map(name => fs.readFileSync(path.join(data.root, "quarantine", name), "utf8")))
      .toEqual(expect.arrayContaining([first, second]));
    for (const name of quarantineFiles) {
      expect(fs.statSync(path.join(data.root, "quarantine", name)).mode & 0o777).toBe(0o600);
    }
  });

  it("maps identity-verified v2 memory into the v3 runtime layout with final ownership markers", async () => {
    const pluginData = temporary();
    const data = prepareKiroPowerDataPaths(pluginData);
    const workspace = temporary();
    const identity = verifiedIdentity(workspace);
    const namespace = memoryNamespace(identity);
    const legacy = path.join(data.projects, workspaceId(identity, 2));
    seedIdentity(legacy, identity);
    fs.mkdirSync(path.join(legacy, "state"), { mode: 0o700 });
    fs.writeFileSync(path.join(legacy, "state", "preserved.fixture"), "retained", { mode: 0o600 });
    seedMemory(legacy, namespace, "fixture", { retained: true });

    const migrated = prepareKiroPowerProjectPaths(data.projects, identity);
    expect(path.basename(migrated.root)).toBe(workspaceId(identity, 3));
    expect(fs.existsSync(path.join(migrated.state, "preserved.fixture"))).toBe(false);
    const runtimeMemory = openKiroMemory<{ retained: boolean }>(migrated.memoryNamespace, migrated.memory);
    expect(await runtimeMemory.get("fixture")).toMatchObject({
      namespace, key: "fixture", value: { retained: true },
    });
    expect((await runtimeMemory.list()).map(entry => entry.key)).toEqual(["fixture"]);

    const physicalMemory = path.join(migrated.memory, "memory");
    const rootMarker = JSON.parse(fs.readFileSync(path.join(physicalMemory, ".kiro-fabric-owner"), "utf8"));
    const namespaceMarker = JSON.parse(fs.readFileSync(path.join(physicalMemory, memoryNamespaceDirectory(namespace), ".kiro-fabric-owner"), "utf8"));
    expect(rootMarker.root).toBe(migrated.memory);
    expect(namespaceMarker).toMatchObject({ root: migrated.memory, namespace });

    expect(fs.existsSync(legacy)).toBe(false);
    const quarantined = path.join(data.projects, ".quarantine", `workspace-v2-${workspaceId(identity, 2)}`);
    expect(fs.readFileSync(path.join(quarantined, "state", "preserved.fixture"), "utf8")).toBe("retained");
    expect(JSON.parse(fs.readFileSync(path.join(quarantined, "memory", memoryNamespaceDirectory(namespace), "fixture.json"), "utf8")))
      .toMatchObject({ key: "fixture", value: { retained: true } });
    expect(prepareKiroPowerProjectPaths(data.projects, identity).root).toBe(migrated.root);
  });

  it("keeps existing v3 memory when a verified v2 generation is quarantined", async () => {
    const data = prepareKiroPowerDataPaths(temporary());
    const workspace = temporary();
    const identity = verifiedIdentity(workspace);
    const namespace = memoryNamespace(identity);
    const current = path.join(data.projects, workspaceId(identity, 3));
    const legacy = path.join(data.projects, workspaceId(identity, 2));
    seedIdentity(current, identity);
    seedMemory(path.join(current, "memory"), namespace, "current", { generation: 3 });
    seedIdentity(legacy, identity);
    seedMemory(legacy, namespace, "legacy", { generation: 2 });

    const prepared = prepareKiroPowerProjectPaths(data.projects, identity);
    const runtimeMemory = openKiroMemory<{ generation: number }>(prepared.memoryNamespace, prepared.memory);
    expect(await runtimeMemory.get("current")).toMatchObject({ value: { generation: 3 } });
    expect(await runtimeMemory.get("legacy")).toBeNull();
    const quarantined = path.join(data.projects, ".quarantine", `workspace-v2-${workspaceId(identity, 2)}`);
    expect(JSON.parse(fs.readFileSync(path.join(quarantined, "memory", memoryNamespaceDirectory(namespace), "legacy.json"), "utf8")))
      .toMatchObject({ value: { generation: 2 } });
  });

  it("fails closed when the prior workspace identity does not match", () => {
    const data = prepareKiroPowerDataPaths(temporary());
    const identity: KiroPowerWorkspaceIdentity = { schemaVersion: 1, canonicalPath: "/verified", deviceId: "1", fileId: "2" };
    const legacy = path.join(data.projects, workspaceId(identity, 2));
    fs.mkdirSync(legacy, { mode: 0o700 });
    fs.writeFileSync(path.join(legacy, "workspace-identity.json"), JSON.stringify({ ...identity, fileId: "foreign" }), { mode: 0o600 });
    expect(() => prepareKiroPowerProjectPaths(data.projects, identity)).toThrow("does not match");
    expect(fs.existsSync(legacy)).toBe(true);
  });
});
