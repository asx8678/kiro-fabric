import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { boundModelOutput } from "../src/output-budget.js";
import { isKiroIntegrationMode, parseKiroIntegrationMode } from "../src/kiro/integration-mode.js";
import { resolveKiroMcpLaunchEnvironment } from "../src/kiro/mcp-environment.js";
import { supportsKiroPowerElicitation } from "../src/kiro/mcp-server.js";
import { KiroPowerApprover, KiroPowerFabricApprover, type KiroPowerElicitationAdapter } from "../src/kiro/power/approver.js";
import { runKiroPowerDoctor } from "../src/kiro/power/diagnostics.js";
import { kiroPowerWorkspaceId, prepareKiroPowerDataPaths, prepareKiroPowerProjectPaths } from "../src/kiro/power/data-paths.js";
import { KiroPowerWorkspaceBinding } from "../src/kiro/power/workspace-binding.js";
import { createKiroRuntime } from "../src/kiro/runtime.js";

const roots: string[] = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-power-test-")); roots.push(root); return root; };
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.KIRO_FABRIC_ALLOW_SHELL;
  delete process.env.PI_CODING_AGENT_DIR;
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

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

  it("creates private deterministic isolated project data and rejects intermediate symlinks", () => {
    const root = temp(); const data = prepareKiroPowerDataPaths(root);
    expect(fs.statSync(data.root).mode & 0o777).toBe(0o700);
    expect(kiroPowerWorkspaceId("/a")).toBe(kiroPowerWorkspaceId("/a"));
    expect(kiroPowerWorkspaceId("/a")).not.toBe(kiroPowerWorkspaceId("/b"));
    expect(prepareKiroPowerProjectPaths(data.projects, "/a").root).not.toBe(prepareKiroPowerProjectPaths(data.projects, "/b").root);

    const unsafe = temp(); const fabric = path.join(unsafe, "fabric"); const outside = path.join(unsafe, "outside");
    fs.mkdirSync(fabric); fs.mkdirSync(outside); fs.symlinkSync(outside, path.join(fabric, "global"), "dir");
    expect(() => prepareKiroPowerDataPaths(unsafe)).toThrow(/symlink|contain|private/i);
    expect(fs.existsSync(path.join(outside, "cache"))).toBe(false);
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

  it("keeps detach and selected-root loss unbound until explicit selection", async () => {
    const root = temp(); const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data"); const a = path.join(root, "a"); const b = path.join(root, "b");
    for (const dir of [pluginRoot, pluginData, a, b]) fs.mkdirSync(dir);
    const binding = new KiroPowerWorkspaceBinding({ pluginRoot, pluginData });
    const one = [{ uri: pathToFileURL(a).href, name: "a" }];
    binding.updateClientRoots(one);
    await binding.handle({ action: "detach" });
    binding.updateClientRoots(one);
    expect(binding.status().status).toBe("unbound");

    const second = new KiroPowerWorkspaceBinding({ pluginRoot, pluginData });
    second.updateClientRoots([...one, { uri: pathToFileURL(b).href, name: "b" }]);
    const selected = second.list().roots[0]!;
    await second.handle({ action: "select", rootId: selected.rootId });
    const remaining = selected.name === "a" ? b : a;
    second.updateClientRoots([{ uri: pathToFileURL(remaining).href, name: "remaining" }]);
    expect(second.status().status).toBe("unbound");
  });

  it("rejects over-broad and symlink workspace roots", () => {
    const root = temp(); const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data"); const workspace = path.join(root, "workspace"); const alias = path.join(root, "alias");
    for (const dir of [pluginRoot, pluginData, workspace]) fs.mkdirSync(dir);
    fs.symlinkSync(workspace, alias, "dir");
    const binding = new KiroPowerWorkspaceBinding({ pluginRoot, pluginData });
    binding.updateClientRoots([
      { uri: pathToFileURL(os.homedir()).href, name: "home" },
      { uri: pathToFileURL(alias).href, name: "alias" },
    ]);
    expect(binding.list().roots).toHaveLength(0);
  });

  it("manual attachment fails closed without elicitation and rejects storage ancestors", async () => {
    const root = temp(); const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data"); const workspace = path.join(root, "workspace");
    for (const dir of [pluginRoot, pluginData, workspace]) fs.mkdirSync(dir);
    const binding = new KiroPowerWorkspaceBinding({ pluginRoot, pluginData });
    await expect(binding.handle({ action: "attach", path: workspace })).rejects.toThrow("elicitation");
    await expect(binding.handle({ action: "attach", path: root })).rejects.toThrow("must not contain one another");
  });

  it("approval accepts only explicit approve-once and redacts common credential forms", async () => {
    let message = "";
    const request: KiroPowerElicitationAdapter["request"] = async (options) => { message = options.message; return { action: "accept", approved: true }; };
    const approver = new KiroPowerApprover({ supported: () => true, request });
    const secrets = {
      authorization: "Bearer AUTHORIZATION_VALUE",
      access_token: "ACCESS_TOKEN_VALUE",
      refresh_token: "REFRESH_TOKEN_VALUE",
      client_secret: "CLIENT_SECRET_VALUE",
      accessToken: "CAMEL_ACCESS_TOKEN_VALUE",
    };
    await expect(approver.approveOnce({
      risk: "network",
      provider: "mcp",
      action: "call",
      summary: JSON.stringify({ ...secrets, safe: true }),
    })).resolves.toBe(true);
    for (const key of Object.keys(secrets)) expect(message).toContain(`${key}=<redacted>`);
    for (const value of Object.values(secrets)) expect(message).not.toContain(value);

    const fabricApprover = new KiroPowerFabricApprover(
      { read: "ask", write: "deny", execute: "deny", network: "deny", agent: "deny" } as never,
      approver,
      temp(),
    );
    await fabricApprover.approve(
      { ref: "fixture.read", provider: "fixture", name: "read", risk: "read" } as never,
      secrets,
    );
    for (const value of Object.values(secrets)) expect(message).not.toContain(value);

    const deny = new KiroPowerApprover({ supported: () => false, request });
    await expect(deny.approveOnce({ risk: "write", provider: "x", action: "y", summary: "z" })).resolves.toBe(false);
  });

  it("shows the exact workspace as dot and recognizes standard form elicitation", async () => {
    const cwd = temp(); let message = "";
    const elicitation = new KiroPowerApprover({ supported: () => true, request: async (options) => { message = options.message; return { action: "accept", approved: true }; } });
    const approver = new KiroPowerFabricApprover({ read: "ask", write: "deny", execute: "deny", network: "deny", agent: "deny" } as never, elicitation, cwd);
    await approver.approve({ ref: "fixture.read", provider: "fixture", name: "read", risk: "read" } as never, { path: cwd });
    expect(message).toContain('"path":"."');
    expect(supportsKiroPowerElicitation({ elicitation: {} })).toBe(true);
    expect(supportsKiroPowerElicitation({ elicitation: { form: {} } })).toBe(true);
    expect(supportsKiroPowerElicitation({ elicitation: { url: {} } })).toBe(false);
    expect(supportsKiroPowerElicitation({})).toBe(false);
  });

  it("ignores Strict shell grants and keeps doctor isolated from ambient config", async () => {
    const cwd = temp(); process.env.KIRO_FABRIC_ALLOW_SHELL = "1";
    const runtime = createKiroRuntime({ cwd, integration: "power", config: structuredClone(DEFAULT_FABRIC_CONFIG) });
    try { expect(runtime.service.config.approvals.execute).not.toBe("allow"); }
    finally { await runtime.close(); }

    const ambient = temp(); const powerConfig = temp();
    fs.writeFileSync(path.join(ambient, "fabric.json"), "{not-json\n");
    process.env.PI_CODING_AGENT_DIR = ambient;
    const isolated = createKiroRuntime({ cwd, integration: "power", agentDir: powerConfig });
    try { expect(isolated.service.config.executor.runtime).toBe("quickjs"); }
    finally { await isolated.close(); }

    const agentDir = temp(); const configPath = path.join(agentDir, "fabric.json");
    fs.writeFileSync(configPath, '{"version":1,"executor":{"runtime":"quickjs"}}\n');
    const before = fs.readFileSync(configPath);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    await runKiroPowerDoctor();
    expect(fs.readFileSync(configPath)).toEqual(before);
  }, 20_000);

  it("preserves overflow output behind the Power-safe artifacts API", async () => {
    const root = temp();
    const runtime = createKiroRuntime({ cwd: root, integration: "power", config: structuredClone(DEFAULT_FABRIC_CONFIG) });
    try {
      const content = "overflow-payload".repeat(100);
      const id = runtime.artifacts.write(content);
      const result = await runtime.service.execute({
        code: `return await tools.call({ ref: "artifacts.read", args: { id: ${JSON.stringify(id)}, limit: 16000 } })`,
        signal: undefined,
        parentToolCallId: "power-artifact-test",
        host: runtime.host,
        onPartial() {},
      });
      expect(result).toMatchObject({ success: true });
      expect(result.value).toMatchObject({ id, text: content, done: true });
      const bounded = await boundModelOutput(content, 500, content, async () => id, (artifactId) => `await tools.call({ ref: "artifacts.read", args: { id: "${artifactId}" } })`);
      expect(bounded.text).toContain(`tools.call({ ref: "artifacts.read", args: { id: "${id}" } })`);
      expect(bounded.text).not.toContain("k.readArtifact");
    } finally { await runtime.close(); }
  });

  it("does not mount k.* and mounts state only for a bound Power runtime", async () => {
    const root = temp();
    const unbound = createKiroRuntime({ cwd: root, integration: "power", memoryRoot: path.join(root, "memory") });
    try {
      expect(unbound.registry.providers().map((entry) => entry.name)).not.toContain("k");
      expect(unbound.registry.providers().map((entry) => entry.name)).toContain("artifacts");
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
