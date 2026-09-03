import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { createKiroArtifactStore } from "../src/kiro/artifacts.js";
import { KiroPowerArtifactsProvider } from "../src/kiro/power/artifacts-provider.js";
import { createKiroRuntime } from "../src/kiro/runtime.js";
import { StateProvider } from "../src/providers/state-provider.js";

const roots: string[] = [];
const temporary = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-private-")); roots.push(root); return root; };
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

describe("private artifacts and state", () => {
  it("creates private bounded artifacts", () => {
    const root = temporary();
    const store = createKiroArtifactStore({ root, maxArtifactChars: 20 });
    const id = store.write("private");
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(root, id)).mode & 0o777).toBe(0o600);
    expect(store.read(id).text).toBe("private");
    expect(() => store.write("x".repeat(21))).toThrow("bounds");
    store.close();
  });

  it("serves opaque artifact IDs through registry schema validation", async () => {
    const root = temporary();
    const store = createKiroArtifactStore({ root });
    const id = store.write("registry-result");
    const registry = new ActionRegistry();
    registry.register(new KiroPowerArtifactsProvider(store));
    await expect(registry.invoke("artifacts.read", { id }, {
      cwd: root,
      audits: [],
      maxResultChars: 10_000,
      async approve() {},
    })).resolves.toMatchObject({ id, text: "registry-result" });
    await registry.close();
    store.close();
  });

  it("expires idle artifacts on read", () => {
    const root = temporary();
    let now = 1_000;
    const store = createKiroArtifactStore({ root, ttlMs: 100, now: () => now });
    const id = store.write("ephemeral");
    now += 101;
    expect(() => store.read(id)).toThrow("unavailable or expired");
    expect(fs.existsSync(path.join(root, id))).toBe(false);
    store.close();
  });

  it("removes crash residue and rejects foreign artifact-root entries", () => {
    const staleRoot = temporary();
    const staleId = `ka_${"a".repeat(48)}`;
    const staleFile = path.join(staleRoot, staleId);
    fs.writeFileSync(staleFile, "stale", { mode: 0o600 });
    const old = new Date(Date.now() - 86_400_001);
    fs.utimesSync(staleFile, old, old);
    const store = createKiroArtifactStore({ root: staleRoot });
    expect(fs.existsSync(staleFile)).toBe(false);
    store.close();

    const foreignRoot = temporary();
    fs.writeFileSync(path.join(foreignRoot, "foreign"), "do not delete", { mode: 0o600 });
    expect(() => createKiroArtifactStore({ root: foreignRoot })).toThrow("unsupported entry");
    expect(fs.readFileSync(path.join(foreignRoot, "foreign"), "utf8")).toBe("do not delete");
  });

  it("does not delete artifacts owned by another live store", () => {
    const root = temporary();
    const first = createKiroArtifactStore({ root });
    const firstId = first.write("first");
    const second = createKiroArtifactStore({ root });
    const secondId = second.write("second");
    expect(first.read(firstId).text).toBe("first");
    first.close();
    expect(second.read(secondId).text).toBe("second");
    expect(fs.existsSync(path.join(root, secondId))).toBe(true);
    second.close();
  });

  it("uses revision checks and private atomic state", async () => {
    const root = temporary();
    const provider = new StateProvider(root);
    const context = { cwd: root };
    expect(await provider.invoke("set", { key: "release", value: 1 }, context)).toEqual({ key: "release", revision: 1 });
    await expect(provider.invoke("set", { key: "release", value: 2, expectedRevision: 0 }, context)).rejects.toThrow("revision conflict");
    expect(await provider.invoke("set", { key: "__proto__", value: { safe: true } }, context)).toEqual({ key: "__proto__", revision: 2 });
    expect(await provider.invoke("set", { key: "constructor", value: "stored" }, context)).toEqual({ key: "constructor", revision: 3 });
    expect(await provider.invoke("get", { key: "__proto__" }, context)).toMatchObject({ value: { safe: true }, revision: 2 });
    expect(await provider.invoke("get", { key: "constructor" }, context)).toMatchObject({ value: "stored", revision: 3 });
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
    expect(fs.statSync(path.join(root, "state.json")).mode & 0o777).toBe(0o600);
  });

  it("shares durable memory and state safely across independent runtimes for one workspace", async () => {
    const root = temporary();
    const workspace = path.join(root, "workspace");
    const memoryRoot = path.join(root, "memory");
    const stateRoot = path.join(root, "state");
    fs.mkdirSync(workspace, { mode: 0o700 });
    const config = {
      ...DEFAULT_FABRIC_CONFIG,
      approvals: { read: "allow", write: "allow", execute: "deny", network: "deny" } as const,
      mcp: { ...DEFAULT_FABRIC_CONFIG.mcp, enabled: false },
    };
    const runtime = (name: string) => createKiroRuntime({
      cwd: workspace,
      configFile: path.join(root, "unused-config.json"),
      mcpConfigPath: path.join(root, "unused-mcp.json"),
      artifactsRoot: path.join(root, `artifacts-${name}`),
      memoryRoot,
      memoryNamespace: "project:shared-runtime-test",
      stateRoot,
      config,
    });
    const first = runtime("first");
    const second = runtime("second");
    const invoke = (owner: ReturnType<typeof runtime>, ref: string, args: Record<string, unknown>) =>
      owner.registry.invoke(ref, args, {
        cwd: workspace,
        audits: [],
        maxResultChars: 100_000,
        async approve() {},
      });
    try {
      await invoke(first, "memory.set", { key: "shared", value: { nonce: "memory-visible" } });
      await expect(invoke(second, "memory.get", { key: "shared" })).resolves.toMatchObject({ value: { nonce: "memory-visible" } });
      await invoke(second, "memory.set", { key: "second", value: true });
      await expect(invoke(first, "memory.get", { key: "second" })).resolves.toMatchObject({ value: true });

      await expect(invoke(first, "state.set", { key: "shared", value: "initial" })).resolves.toEqual({ key: "shared", revision: 1 });
      await expect(invoke(second, "state.get", { key: "shared" })).resolves.toMatchObject({ value: "initial", revision: 1 });
      const competing = await Promise.allSettled([
        invoke(first, "state.set", { key: "shared", value: "first", expectedRevision: 1 }),
        invoke(second, "state.set", { key: "shared", value: "second", expectedRevision: 1 }),
      ]);
      expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(competing.filter((result) => result.status === "rejected")).toHaveLength(1);
      await expect(invoke(first, "state.get", { key: "shared" })).resolves.toMatchObject({ revision: 2 });
      await expect(invoke(second, "state.get", { key: "shared" })).resolves.toMatchObject({ revision: 2 });
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  it("bounds the full state document and fails closed on malformed persistence", async () => {
    const root = temporary();
    const context = { cwd: root };
    const bounded = new StateProvider(root, { maxValueChars: 1_000, maxTotalChars: 200 });
    await expect(bounded.invoke("set", { key: "large", value: "x".repeat(150) }, context)).rejects.toThrow("document exceeds");

    fs.writeFileSync(path.join(root, "state.json"), JSON.stringify({ schemaVersion: 1, revision: 1, entries: [] }), { mode: 0o600 });
    await expect(bounded.invoke("get", { key: "large" }, context)).rejects.toThrow("malformed");
  });
});
