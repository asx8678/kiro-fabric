import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import {
  KiroPowerWorkspaceBinding,
  kiroPowerWorkspaceRequestSchema,
} from "../src/kiro/power/workspace-binding.js";
import { installedKiroHomeFor } from "../src/kiro/mcp-server.js";
import { CachedWorkspaceContextProvider } from "../src/kiro/power/workspace-context.js";

const roots: string[] = [];
const temporary = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-workspace-")); roots.push(root); return root; };
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });
const fixture = () => {
  const root = temporary();
  const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data");
  fs.mkdirSync(pluginRoot); fs.mkdirSync(pluginData);
  return { root, pluginRoot, pluginData, binding: new KiroPowerWorkspaceBinding({ pluginRoot, pluginData }) };
};

describe("canonical workspace binding", () => {
  it("publishes a strict MCP object schema while preserving action variants", () => {
    expect(Reflect.get(kiroPowerWorkspaceRequestSchema, "type")).toBe("object");
    expect(Value.Check(kiroPowerWorkspaceRequestSchema, { action: "status" })).toBe(true);
    expect(Value.Check(kiroPowerWorkspaceRequestSchema, { action: "select", rootId: "root-1" })).toBe(true);
    expect(Value.Check(kiroPowerWorkspaceRequestSchema, { action: "select" })).toBe(false);
    expect(Value.Check(kiroPowerWorkspaceRequestSchema, { action: "status", rootId: "root-1" })).toBe(false);
  });

  it("turns oversized client root inventories into unavailable context", async () => {
    const context = new CachedWorkspaceContextProvider({
      supported: () => true,
      async load() {
        return Array.from({ length: 129 }, (_, index) => ({
          uri: pathToFileURL(`/workspace-${index}`).href,
        }));
      },
    });
    const snapshot = await context.current();
    expect(snapshot.status).toBe("temporarily-unavailable");
    expect(snapshot.roots).toEqual([]);
    expect(snapshot.error).toContain("count exceeds");
  });

  it("fails closed on ambiguous roots and requires exact selection", async () => {
    const { root, binding } = fixture();
    const a = path.join(root, "a"); const b = path.join(root, "b"); fs.mkdirSync(a); fs.mkdirSync(b);
    binding.updateClientRoots([a, b].map((entry) => ({ uri: pathToFileURL(entry).href })));
    expect(binding.status()).toEqual({ status: "unbound", requiresSelection: true });
    const listed = binding.list();
    await expect(binding.handle({ action: "select", rootId: "unknown" })).rejects.toThrow("unknown workspace rootId");
    await binding.handle({ action: "select", rootId: listed.roots[0]!.rootId });
    expect(binding.status().status).toBe("bound");
  });

  it("detaches a removed root before rebinding", async () => {
    const { root, binding } = fixture();
    const a = path.join(root, "a"); const b = path.join(root, "b"); fs.mkdirSync(a); fs.mkdirSync(b);
    binding.updateClientRoots([{ uri: pathToFileURL(a).href }]);
    expect(binding.boundRoot()).toBe(fs.realpathSync(a));
    binding.updateClientRoots([{ uri: pathToFileURL(b).href }]);
    expect(binding.status().status).toBe("unbound");
  });

  it("fails closed when an advertised parent alias becomes unverifiable", () => {
    if (process.platform === "win32") return;
    const { root, binding } = fixture();
    const parent = path.join(root, "real");
    const workspace = path.join(parent, "workspace");
    const alias = path.join(root, "parent-alias");
    fs.mkdirSync(parent);
    fs.mkdirSync(workspace);
    fs.symlinkSync(parent, alias);
    const advertised = path.join(alias, "workspace");
    binding.updateClientRoots([{ uri: pathToFileURL(advertised).href }]);
    expect(binding.workspaceObservation().status).toBe("verified");

    fs.unlinkSync(alias);
    binding.updateClientRoots([{ uri: pathToFileURL(advertised).href }]);
    expect(binding.workspaceObservation().status).toBe("temporarily-unavailable");
    expect(binding.boundRoot()).toBeUndefined();
  });

  it("rejects final-entry aliases and reserved storage", async () => {
    const { root, pluginRoot, binding } = fixture();
    const workspace = path.join(root, "workspace"); const alias = path.join(root, "alias"); fs.mkdirSync(workspace); fs.symlinkSync(workspace, alias);
    await expect(binding.handle({ action: "attach", path: alias })).rejects.toThrow();
    await expect(binding.handle({ action: "attach", path: pluginRoot })).rejects.toThrow("too broad or reserved");
  });

  it("reserves an explicit non-default Kiro home from workspace selection", async () => {
    const root = temporary();
    const kiroContainer = path.join(root, "custom-kiro-container");
    const kiroHome = path.join(kiroContainer, "home");
    const agents = path.join(kiroHome, "agents");
    const pluginRoot = path.join(root, "runtime");
    const pluginData = path.join(root, "data");
    const workspace = path.join(root, "workspace");
    for (const directory of [kiroContainer, kiroHome, agents, pluginRoot, pluginData, workspace]) fs.mkdirSync(directory);
    const binding = new KiroPowerWorkspaceBinding({ pluginRoot, pluginData, kiroHome });

    binding.updateClientRoots([{ uri: pathToFileURL(agents).href }]);
    expect(binding.list().roots).toEqual([]);
    await expect(binding.handle({ action: "attach", path: agents })).rejects.toThrow("too broad or reserved");

    binding.updateClientRoots([{ uri: pathToFileURL(kiroContainer).href }]);
    expect(binding.list().roots).toEqual([]);
    await expect(binding.handle({ action: "attach", path: kiroContainer })).rejects.toThrow("too broad or reserved");

    binding.updateClientRoots([{ uri: pathToFileURL(workspace).href }]);
    expect(binding.boundRoot()).toBe(fs.realpathSync(workspace));
  });

  it("derives and validates the installed custom Kiro home from Agent storage", () => {
    const root = temporary();
    const kiroHome = path.join(root, "elsewhere", ".kiro-custom");
    const installRoot = path.join(kiroHome, "kiro-fabric");
    const data = path.join(installRoot, "data");
    const runtime = path.join(installRoot, "runtime", "a".repeat(64));
    fs.mkdirSync(data, { recursive: true });
    fs.mkdirSync(runtime, { recursive: true });
    expect(installedKiroHomeFor(runtime, data)).toBe(fs.realpathSync(kiroHome));

    const unrelatedRuntime = path.join(root, "unrelated-runtime");
    fs.mkdirSync(unrelatedRuntime);
    expect(() => installedKiroHomeFor(unrelatedRuntime, data)).toThrow("digest-named runtime layout");
    const unrelatedData = path.join(root, "library-data");
    fs.mkdirSync(unrelatedData);
    expect(installedKiroHomeFor(unrelatedRuntime, unrelatedData)).toBeUndefined();
  });
});
