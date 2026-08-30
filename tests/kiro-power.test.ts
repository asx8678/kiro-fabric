import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isKiroIntegrationMode, parseKiroIntegrationMode } from "../src/kiro/integration-mode.js";
import { resolveKiroMcpLaunchEnvironment } from "../src/kiro/mcp-environment.js";
import { KiroPowerApprover, type KiroPowerElicitationAdapter } from "../src/kiro/power/approver.js";
import { kiroPowerWorkspaceId, prepareKiroPowerDataPaths, prepareKiroPowerProjectPaths } from "../src/kiro/power/data-paths.js";
import { KiroPowerWorkspaceBinding } from "../src/kiro/power/workspace-binding.js";
import { createKiroRuntime } from "../src/kiro/runtime.js";

const roots: string[] = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-power-test-")); roots.push(root); return root; };
afterEach(() => { vi.restoreAllMocks(); while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

describe("Kiro Power security boundaries", () => {
  it("parses only the three explicit modes", () => {
    for (const mode of ["power", "strict", "internal-child"]) expect(isKiroIntegrationMode(mode)).toBe(true);
    expect(() => parseKiroIntegrationMode("managed-main")).toThrow("must be one of");
  });

  it("requires canonical separate plugin roots and never uses process cwd", () => {
    const root = temp(); const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data");
    fs.mkdirSync(pluginRoot); fs.mkdirSync(pluginData);
    expect(resolveKiroMcpLaunchEnvironment({ KIRO_FABRIC_INTEGRATION: "power", PLUGIN_ROOT: pluginRoot, PLUGIN_DATA: pluginData }))
      .toEqual({ mode: "power", pluginRoot, pluginData });
    expect(() => resolveKiroMcpLaunchEnvironment({ KIRO_FABRIC_INTEGRATION: "power", PLUGIN_ROOT: pluginRoot })).toThrow("PLUGIN_DATA");
    expect(() => resolveKiroMcpLaunchEnvironment({ KIRO_FABRIC_INTEGRATION: "unknown", PLUGIN_ROOT: pluginRoot, PLUGIN_DATA: pluginData })).toThrow("KIRO_FABRIC_INTEGRATION");
  });

  it("creates private deterministic isolated project data", () => {
    const root = temp(); const data = prepareKiroPowerDataPaths(root);
    expect(fs.statSync(data.root).mode & 0o777).toBe(0o700);
    expect(kiroPowerWorkspaceId("/a")).toBe(kiroPowerWorkspaceId("/a"));
    expect(kiroPowerWorkspaceId("/a")).not.toBe(kiroPowerWorkspaceId("/b"));
    expect(prepareKiroPowerProjectPaths(data.projects, "/a").root).not.toBe(prepareKiroPowerProjectPaths(data.projects, "/b").root);
  });

  it("auto-binds one client root and requires selection for multiple roots", async () => {
    const root = temp(); const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data"); const a = path.join(root, "a"); const b = path.join(root, "b");
    for (const dir of [pluginRoot, pluginData, a, b]) fs.mkdirSync(dir);
    const binding = new KiroPowerWorkspaceBinding({ pluginRoot, pluginData });
    binding.updateClientRoots([{ uri: pathToFileURL(a).href }]);
    expect(binding.status().status).toBe("bound");
    await binding.handle({ action: "detach" });
    binding.updateClientRoots([{ uri: pathToFileURL(a).href }, { uri: pathToFileURL(b).href }]);
    expect(binding.status()).toMatchObject({ status: "unbound", requiresSelection: true });
    const listed = binding.list();
    await binding.handle({ action: "select", rootId: listed.roots[1]!.rootId });
    expect(binding.status()).toMatchObject({ status: "bound", source: "client-roots" });
  });

  it("manual attachment fails closed without elicitation and rejects storage ancestors", async () => {
    const root = temp(); const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data"); const workspace = path.join(root, "workspace");
    for (const dir of [pluginRoot, pluginData, workspace]) fs.mkdirSync(dir);
    const binding = new KiroPowerWorkspaceBinding({ pluginRoot, pluginData });
    await expect(binding.handle({ action: "attach", path: workspace })).rejects.toThrow("elicitation");
    await expect(binding.handle({ action: "attach", path: root })).rejects.toThrow("must not contain one another");
  });

  it("approval accepts only explicit approve-once and redacts secret-looking previews", async () => {
    let message = "";
    const request: KiroPowerElicitationAdapter["request"] = async (options) => { message = options.message; return { action: "accept", approved: true }; };
    const approver = new KiroPowerApprover({ supported: () => true, request });
    await expect(approver.approveOnce({ risk: "network", provider: "mcp", action: "call", summary: "token=abc" })).resolves.toBe(true);
    expect(message).toContain("token=<redacted>");
    const deny = new KiroPowerApprover({ supported: () => false, request });
    await expect(deny.approveOnce({ risk: "write", provider: "x", action: "y", summary: "z" })).resolves.toBe(false);
  });

  it("does not mount k.* and mounts state only for a bound Power runtime", async () => {
    const root = temp();
    const unbound = createKiroRuntime({ cwd: root, integration: "power", memoryRoot: path.join(root, "memory") });
    try {
      expect(unbound.registry.providers().map((entry) => entry.name)).not.toContain("k");
      expect(unbound.registry.providers().map((entry) => entry.name)).not.toContain("state");
      expect(unbound.registry.unavailableProviders()).toContainEqual(expect.objectContaining({ name: "k" }));
    } finally { await unbound.close(); }
    const bound = createKiroRuntime({
      cwd: root,
      integration: "power",
      memoryRoot: path.join(root, "memory-bound"),
      stateRoot: path.join(root, "state-bound"),
    });
    try {
      expect(bound.registry.providers().map((entry) => entry.name)).toContain("state");
      expect(bound.registry.providers().map((entry) => entry.name)).not.toContain("k");
    } finally { await bound.close(); }
  });
});
