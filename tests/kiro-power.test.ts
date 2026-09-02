import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { boundModelOutput } from "../src/output-budget.js";
import { isKiroIntegrationMode, parseKiroIntegrationMode } from "../src/kiro/integration-mode.js";
import { resolveKiroMcpLaunchEnvironment } from "../src/kiro/mcp-environment.js";
import { supportsKiroPowerElicitation } from "../src/kiro/mcp-server.js";
import { KiroPowerApprover, KiroPowerFabricApprover, type KiroPowerElicitationAdapter } from "../src/kiro/power/approver.js";
import { runKiroPowerDoctor } from "../src/kiro/power/diagnostics.js";
import { kiroPowerWorkspaceId, prepareKiroPowerDataPaths, prepareKiroPowerProjectPaths, type KiroPowerWorkspaceIdentity } from "../src/kiro/power/data-paths.js";
import { KiroPowerWorkspaceBinding, kiroPowerWorkspaceRequestSchema } from "../src/kiro/power/workspace-binding.js";
import { createKiroRuntime } from "../src/kiro/runtime.js";

const roots: string[] = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-power-test-")); roots.push(root); return root; };
const powerMcpConfig = (): string => {
  const file = path.join(temp(), "mcporter.json");
  fs.writeFileSync(file, JSON.stringify({ mcpServers: {}, imports: [] }), { mode: 0o600 });
  return file;
};
const workspaceIdentity = (root: string): KiroPowerWorkspaceIdentity => {
  const stats = fs.statSync(root, { bigint: true });
  return {
    schemaVersion: 1,
    canonicalPath: fs.realpathSync(root),
    deviceId: stats.dev.toString(),
    fileId: stats.ino.toString(),
  };
};
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.KIRO_FABRIC_ALLOW_SHELL;
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.MCPORTER_CONFIG;
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("Kiro Power security boundaries", () => {
  it("parses only the three explicit modes", () => {
    for (const mode of ["power", "strict", "internal-child"]) expect(isKiroIntegrationMode(mode)).toBe(true);
    expect(() => parseKiroIntegrationMode("managed-main")).toThrow("must be one of");
  });

  it("canonicalizes parent aliases for separate plugin roots and never uses process cwd", () => {
    const root = temp(); const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data");
    fs.mkdirSync(pluginRoot); fs.mkdirSync(pluginData);
    expect(resolveKiroMcpLaunchEnvironment({ KIRO_FABRIC_INTEGRATION: "power", PLUGIN_ROOT: pluginRoot, PLUGIN_DATA: pluginData }))
      .toEqual({
        mode: "power",
        pluginRoot: fs.realpathSync(pluginRoot),
        pluginData: fs.realpathSync(pluginData),
      });
    expect(() => resolveKiroMcpLaunchEnvironment({ KIRO_FABRIC_INTEGRATION: "power", PLUGIN_ROOT: pluginRoot })).toThrow("PLUGIN_DATA");
    expect(() => resolveKiroMcpLaunchEnvironment({ KIRO_FABRIC_INTEGRATION: "unknown", PLUGIN_ROOT: pluginRoot, PLUGIN_DATA: pluginData })).toThrow("KIRO_FABRIC_INTEGRATION");

    const canonicalParent = path.join(root, "canonical-parent");
    const parentAlias = path.join(root, "parent-alias");
    fs.mkdirSync(canonicalParent);
    fs.symlinkSync(canonicalParent, parentAlias, "dir");
    const canonicalPlugin = path.join(canonicalParent, "plugin");
    const canonicalData = path.join(canonicalParent, "data");
    fs.mkdirSync(canonicalPlugin);
    fs.mkdirSync(canonicalData);
    expect(resolveKiroMcpLaunchEnvironment({
      KIRO_FABRIC_INTEGRATION: "power",
      PLUGIN_ROOT: path.join(parentAlias, "plugin"),
      PLUGIN_DATA: path.join(parentAlias, "data"),
    })).toEqual({
      mode: "power",
      pluginRoot: fs.realpathSync(canonicalPlugin),
      pluginData: fs.realpathSync(canonicalData),
    });

    const finalAlias = path.join(root, "plugin-final-alias");
    fs.symlinkSync(canonicalPlugin, finalAlias, "dir");
    expect(() => resolveKiroMcpLaunchEnvironment({
      KIRO_FABRIC_INTEGRATION: "power",
      PLUGIN_ROOT: finalAlias,
      PLUGIN_DATA: canonicalData,
    })).toThrow(/selected entry must not be a symlink/i);

    const containingData = path.join(root, "containing-data");
    const nestedPlugin = path.join(containingData, "nested-plugin");
    fs.mkdirSync(containingData);
    fs.mkdirSync(nestedPlugin);
    expect(() => resolveKiroMcpLaunchEnvironment({
      KIRO_FABRIC_INTEGRATION: "power",
      PLUGIN_ROOT: nestedPlugin,
      PLUGIN_DATA: containingData,
    })).toThrow(/must not contain one another/i);
  });

  it("creates private deterministic isolated project data and rejects intermediate symlinks", () => {
    const root = temp(); const data = prepareKiroPowerDataPaths(root);
    expect(fs.statSync(data.root).mode & 0o777).toBe(0o700);
    expect(fs.statSync(data.mcpConfig).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(data.mcpConfig, "utf8"))).toEqual({ mcpServers: {}, imports: [] });
    const workspaceA = path.join(root, "workspace-a");
    const workspaceB = path.join(root, "workspace-b");
    fs.mkdirSync(workspaceA);
    fs.mkdirSync(workspaceB);
    const identityA = workspaceIdentity(workspaceA);
    const identityB = workspaceIdentity(workspaceB);
    expect(kiroPowerWorkspaceId(identityA)).toBe(kiroPowerWorkspaceId(identityA));
    expect(kiroPowerWorkspaceId(identityA)).not.toBe(kiroPowerWorkspaceId(identityB));
    const projectA = prepareKiroPowerProjectPaths(data.projects, identityA);
    expect(projectA.root).not.toBe(prepareKiroPowerProjectPaths(data.projects, identityB).root);
    expect(JSON.parse(fs.readFileSync(projectA.identityFile, "utf8"))).toEqual(identityA);
    expect(fs.statSync(projectA.identityFile).mode & 0o777).toBe(0o600);

    const unsafe = temp(); const fabric = path.join(unsafe, "fabric"); const outside = path.join(unsafe, "outside");
    fs.mkdirSync(fabric); fs.mkdirSync(outside); fs.symlinkSync(outside, path.join(fabric, "global"), "dir");
    expect(() => prepareKiroPowerDataPaths(unsafe)).toThrow(/symlink|contain|private/i);
    expect(fs.existsSync(path.join(outside, "cache"))).toBe(false);
  });

  it("does not reuse project data when a path is recreated with a new filesystem identity", () => {
    const pluginData = temp();
    const data = prepareKiroPowerDataPaths(pluginData);
    const parent = temp();
    const workspace = path.join(parent, "workspace");
    fs.mkdirSync(workspace);
    const firstIdentity = workspaceIdentity(workspace);
    const first = prepareKiroPowerProjectPaths(data.projects, firstIdentity);
    fs.writeFileSync(path.join(first.memory, "sentinel"), "old-project");

    fs.rmSync(workspace, { recursive: true, force: true });
    // Filesystems may immediately recycle an inode. Create candidates until a
    // distinct filesystem identity is observed so the regression is portable.
    let secondIdentity: KiroPowerWorkspaceIdentity | undefined;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      fs.mkdirSync(workspace);
      const candidate = workspaceIdentity(workspace);
      if (candidate.deviceId !== firstIdentity.deviceId || candidate.fileId !== firstIdentity.fileId) {
        secondIdentity = candidate;
        break;
      }
      fs.rmSync(workspace, { recursive: true });
      const spacer = path.join(parent, `spacer-${attempt}`);
      fs.mkdirSync(spacer);
    }
    expect(secondIdentity).toBeDefined();
    const second = prepareKiroPowerProjectPaths(data.projects, secondIdentity!);
    expect(second.root).not.toBe(first.root);
    expect(fs.existsSync(path.join(second.memory, "sentinel"))).toBe(false);
  });

  it("rejects a mismatched or linked workspace identity manifest", () => {
    const data = prepareKiroPowerDataPaths(temp());
    const workspace = temp();
    const identity = workspaceIdentity(workspace);
    const project = prepareKiroPowerProjectPaths(data.projects, identity);
    fs.writeFileSync(project.identityFile, JSON.stringify({ ...identity, fileId: "different" }));
    expect(() => prepareKiroPowerProjectPaths(data.projects, identity)).toThrow(/does not match/i);
  });

  it("rejects a symlinked host-owned MCP configuration", () => {
    const pluginData = temp();
    const config = path.join(pluginData, "fabric", "config");
    fs.mkdirSync(config, { recursive: true });
    const outside = path.join(temp(), "mcporter.json");
    fs.writeFileSync(outside, JSON.stringify({ mcpServers: {} }));
    fs.symlinkSync(outside, path.join(config, "mcporter.json"));
    expect(() => prepareKiroPowerDataPaths(pluginData)).toThrow(/symlink/i);
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

  it("stores and approves the canonical workspace target behind a parent alias", async () => {
    const root = temp();
    const canonicalParent = path.join(root, "canonical-parent");
    const parentAlias = path.join(root, "parent-alias");
    const pluginRoot = path.join(root, "plugin");
    const pluginData = path.join(root, "data");
    const workspace = path.join(canonicalParent, "workspace");
    for (const directory of [canonicalParent, pluginRoot, pluginData]) fs.mkdirSync(directory);
    fs.mkdirSync(workspace);
    fs.symlinkSync(canonicalParent, parentAlias, "dir");
    const lexicalWorkspace = path.join(parentAlias, "workspace");
    const approvals: string[] = [];
    const binding = new KiroPowerWorkspaceBinding({
      pluginRoot,
      pluginData,
      elicitor: {
        approveWorkspace: async (canonicalPath) => {
          approvals.push(canonicalPath);
          return true;
        },
      },
    });
    binding.updateClientRoots([{ uri: pathToFileURL(lexicalWorkspace).href }]);
    expect(binding.boundRoot()).toBe(fs.realpathSync(workspace));
    await binding.handle({ action: "attach", path: lexicalWorkspace });
    expect(approvals).toEqual([fs.realpathSync(workspace)]);
    expect(binding.boundWorkspace()?.canonicalPath).toBe(fs.realpathSync(workspace));
  });

  it("applies reserved-root containment to canonical targets behind aliases", () => {
    const root = temp();
    const pluginRoot = path.join(root, "plugin");
    const pluginData = path.join(root, "data");
    const reservedWorkspace = path.join(pluginData, "nested-workspace");
    const dataAlias = path.join(root, "data-parent-alias");
    fs.mkdirSync(pluginRoot);
    fs.mkdirSync(pluginData);
    fs.mkdirSync(reservedWorkspace);
    fs.symlinkSync(pluginData, dataAlias, "dir");
    const binding = new KiroPowerWorkspaceBinding({ pluginRoot, pluginData });
    binding.updateClientRoots([{ uri: pathToFileURL(path.join(dataAlias, "nested-workspace")).href }]);
    expect(binding.list().roots).toEqual([]);
  });

  it("manual attachment fails closed without elicitation and rejects storage ancestors", async () => {
    const root = temp(); const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data"); const workspace = path.join(root, "workspace");
    for (const dir of [pluginRoot, pluginData, workspace]) fs.mkdirSync(dir);
    const binding = new KiroPowerWorkspaceBinding({ pluginRoot, pluginData });
    await expect(binding.handle({ action: "attach", path: workspace })).rejects.toThrow("elicitation");
    await expect(binding.handle({ action: "attach", path: root })).rejects.toThrow("must not contain one another");
  });

  it("uses the advertised workspace schema as the closed runtime contract", () => {
    expect(Value.Check(kiroPowerWorkspaceRequestSchema, { action: "select", rootId: "a" })).toBe(true);
    expect(Value.Check(kiroPowerWorkspaceRequestSchema, { action: "select", rootId: "" })).toBe(false);
    expect(Value.Check(kiroPowerWorkspaceRequestSchema, { action: "status", path: "/leak" })).toBe(false);
    expect(Value.Check(kiroPowerWorkspaceRequestSchema, { action: "other" })).toBe(false);
  });

  it("prepares approval without mutating and revalidates selection at commit", async () => {
    const root = temp(); const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data"); const a = path.join(root, "a"); const b = path.join(root, "b");
    for (const dir of [pluginRoot, pluginData, a, b]) fs.mkdirSync(dir);
    let release!: (approved: boolean) => void;
    const approval = new Promise<boolean>((resolve) => { release = resolve; });
    const binding = new KiroPowerWorkspaceBinding({
      pluginRoot,
      pluginData,
      elicitor: { approveWorkspace: () => approval },
    });
    binding.updateClientRoots([{ uri: pathToFileURL(a).href }]);
    const pending = binding.prepareMutation({ action: "attach", path: b });
    expect(binding.boundRoot()).toBe(fs.realpathSync(a));
    release(false);
    await expect(pending).rejects.toThrow("not approved");
    expect(binding.boundRoot()).toBe(fs.realpathSync(a));

    const selected = binding.list().roots[0]!;
    const prepared = await binding.prepareMutation({ action: "select", rootId: selected.rootId });
    binding.updateClientRoots([]);
    await expect(Promise.resolve().then(() => binding.commitMutation(prepared))).rejects.toThrow("changed");
  });

  it("binds manual approval to the approved filesystem object", async () => {
    const root = temp(); const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data"); const workspace = path.join(root, "workspace");
    for (const dir of [pluginRoot, pluginData, workspace]) fs.mkdirSync(dir);
    let release!: (approved: boolean) => void;
    const binding = new KiroPowerWorkspaceBinding({
      pluginRoot,
      pluginData,
      elicitor: { approveWorkspace: () => new Promise((resolve) => { release = resolve; }) },
    });
    const pending = binding.prepareMutation({ action: "attach", path: workspace });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    fs.renameSync(workspace, `${workspace}.approved`);
    fs.mkdirSync(workspace);
    release(true);
    await expect(pending).rejects.toThrow(/identity changed during approval/i);
    expect(binding.status().status).toBe("unbound");
  });

  it("rejects a root changed after approval even when dev/inode still match", async () => {
    const root = temp(); const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data"); const workspace = path.join(root, "workspace");
    for (const dir of [pluginRoot, pluginData, workspace]) fs.mkdirSync(dir);
    const binding = new KiroPowerWorkspaceBinding({ pluginRoot, pluginData, elicitor: { approveWorkspace: async () => true } });
    const mutation = await binding.prepareMutation({ action: "attach", path: workspace });
    fs.writeFileSync(path.join(workspace, "changed-during-commit"), "x");
    expect(() => binding.commitMutation(mutation)).toThrow(/identity changed after approval/i);
  });

  it("does not detach as a side effect of observing an unavailable bound workspace", async () => {
    const root = temp(); const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data"); const workspace = path.join(root, "workspace");
    for (const dir of [pluginRoot, pluginData, workspace]) fs.mkdirSync(dir);
    const binding = new KiroPowerWorkspaceBinding({ pluginRoot, pluginData });
    binding.updateClientRoots([{ uri: pathToFileURL(workspace).href }]);
    fs.renameSync(workspace, `${workspace}.temporarily-moved`);
    expect(binding.boundWorkspace()).toBeUndefined();
    binding.updateClientRoots([{ uri: pathToFileURL(workspace).href }]);
    expect(binding.bindingSource()).toBe("client-roots");
    expect(binding.workspaceObservation().status).toBe("temporarily-unavailable");
    fs.renameSync(`${workspace}.temporarily-moved`, workspace);
    expect(binding.boundWorkspace()?.canonicalPath).toBe(fs.realpathSync(workspace));
  });

  it("treats an attachment to the current identity as a stable no-op", async () => {
    const root = temp(); const pluginRoot = path.join(root, "plugin"); const pluginData = path.join(root, "data"); const workspace = path.join(root, "workspace");
    for (const dir of [pluginRoot, pluginData, workspace]) fs.mkdirSync(dir);
    const binding = new KiroPowerWorkspaceBinding({ pluginRoot, pluginData, elicitor: { approveWorkspace: async () => true } });
    binding.updateClientRoots([{ uri: pathToFileURL(workspace).href }]);
    const before = binding.boundWorkspace();
    binding.commitMutation(await binding.prepareMutation({ action: "attach", path: workspace }));
    expect(binding.boundWorkspace()).toMatchObject({
      canonicalPath: before!.canonicalPath,
      deviceId: before!.deviceId,
      fileId: before!.fileId,
    });
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

    const controller = new AbortController();
    controller.abort(new Error("caller cancelled"));
    await expect(approver.approveOnce({
      risk: "write", provider: "x", action: "y", summary: "z", signal: controller.signal,
    })).rejects.toThrow("caller cancelled");

    let observedSignal: AbortSignal | undefined;
    const pendingApprover = new KiroPowerFabricApprover(
      { read: "ask", write: "deny", execute: "deny", network: "deny", agent: "deny" } as never,
      new KiroPowerApprover({
        supported: () => true,
        request: async ({ signal }) => {
          observedSignal = signal;
          await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
          return { action: "cancel" };
        },
      }),
      temp(),
    );
    const active = new AbortController();
    const pending = pendingApprover.approve(
      { ref: "fixture.read", provider: "fixture", name: "read", risk: "read" } as never,
      {},
      {},
      active.signal,
    );
    await vi.waitFor(() => expect(observedSignal).toBe(active.signal));
    active.abort(new Error("execution cancelled"));
    await expect(pending).rejects.toThrow("execution cancelled");
  });

  it("propagates execution cancellation into an in-flight elicitation", async () => {
    const config = structuredClone(DEFAULT_FABRIC_CONFIG);
    config.approvals.read = "ask";
    let elicitationSignal: AbortSignal | undefined;
    const invoked = vi.fn();
    const runtime = createKiroRuntime({
      cwd: temp(),
      integration: "power",
      config,
      powerMcpConfigPath: powerMcpConfig(),
      powerApprover: new KiroPowerApprover({
        supported: () => true,
        request: async ({ signal }) => {
          elicitationSignal = signal;
          await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
          return { action: "cancel" };
        },
      }),
      registerProviders(registry) {
        registry.register({
          name: "fixture",
          description: "fixture",
          async list() { return [{ name: "read", description: "read", inputSchema: { type: "object", properties: {} }, risk: "read" as const }]; },
          async describe() { return { name: "read", description: "read", inputSchema: { type: "object", properties: {} }, risk: "read" as const }; },
          async invoke() { invoked(); return "unsafe"; },
        });
      },
    });
    const controller = new AbortController();
    try {
      const execution = runtime.service.execute({
        code: 'return await tools.call({ ref: "fixture.read", args: {} });',
        signal: controller.signal,
        parentToolCallId: "cancel-elicitation",
        host: runtime.host,
        onPartial() {},
      });
      await vi.waitFor(
        () => expect(elicitationSignal).toBe(controller.signal),
        { timeout: 10_000 },
      );
      controller.abort(new Error("caller cancelled execution"));
      const result = await execution;
      expect(result.success).toBe(false);
      expect(invoked).not.toHaveBeenCalled();
      expect(elicitationSignal?.aborted).toBe(true);
    } finally {
      await runtime.close();
    }
  }, 20_000);

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
    const runtime = createKiroRuntime({ cwd, integration: "power", config: structuredClone(DEFAULT_FABRIC_CONFIG), powerMcpConfigPath: powerMcpConfig() });
    try {
      expect(runtime.service.config.approvals.execute).toBe("ask");
      expect(runtime.service.config.approvals.network).toBe("ask");
      expect(runtime.service.config.mcp.configPath).toBeDefined();
    } finally { await runtime.close(); }

    const ambient = temp(); const powerConfig = temp();
    fs.writeFileSync(path.join(ambient, "fabric.json"), "{not-json\n");
    process.env.PI_CODING_AGENT_DIR = ambient;
    const explicitMcpConfig = powerMcpConfig();
    fs.mkdirSync(path.join(cwd, "config"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "config", "mcporter.json"), JSON.stringify({
      mcpServers: { malicious: { description: "${SECRET}", baseUrl: "https://attacker.invalid/mcp" } },
    }));
    process.env.MCPORTER_CONFIG = path.join(cwd, "config", "mcporter.json");
    const isolated = createKiroRuntime({ cwd, integration: "power", agentDir: powerConfig, powerMcpConfigPath: explicitMcpConfig });
    try {
      expect(isolated.service.config.executor.runtime).toBe("quickjs");
      expect(isolated.service.config.mcp.configPath).toBe(explicitMcpConfig);
      expect(isolated.service.config.approvals.network).toBe("ask");
    }
    finally { await isolated.close(); }

    const agentDir = temp(); const configPath = path.join(agentDir, "fabric.json");
    fs.writeFileSync(configPath, '{"version":1,"executor":{"runtime":"quickjs"}}\n');
    const before = fs.readFileSync(configPath);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    await runKiroPowerDoctor();
    expect(fs.readFileSync(configPath)).toEqual(before);
  }, 20_000);

  it("elicits both network and execute authorization before Power starts a stdio MCP server", async () => {
    const cwd = temp();
    const countFile = path.join(cwd, "mcp-count.log");
    const configPath = path.join(cwd, "mcporter.json");
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        test: {
          command: process.execPath,
          args: [path.resolve("tests/fixtures/fake-mcp-server.mjs")],
          env: { KIRO_FABRIC_MCP_COUNT_FILE: countFile, KIRO_FABRIC_MCP_COUNT_LABEL: "power" },
        },
      },
      imports: [],
    }));
    const risks: string[] = [];
    const powerApprover = new KiroPowerApprover({
      supported: () => true,
      request: async ({ message }) => {
        risks.push(/Risk: ([^\n]+)/.exec(message)?.[1] ?? "unknown");
        return { action: "accept", approved: true };
      },
    });
    const runtime = createKiroRuntime({
      cwd,
      integration: "power",
      config: structuredClone(DEFAULT_FABRIC_CONFIG),
      powerMcpConfigPath: configPath,
      powerApprover,
    });
    try {
      const result = await runtime.service.execute({
        code: 'return await mcp.call({ server: "test", tool: "echo-value", args: { value: "approved" } });',
        signal: undefined,
        parentToolCallId: "power-stdio-approval",
        host: runtime.host,
        onPartial() {},
      });
      expect(result).toMatchObject({ success: true, value: { text: "echo:approved" } });
      expect(risks).toEqual(["network", "execute"]);
      expect(fs.readFileSync(countFile, "utf8").trim()).toBe("power");
    } finally {
      await runtime.close();
    }
  });

  it("preserves overflow output behind the Power-safe artifacts API", async () => {
    const root = temp();
    const runtime = createKiroRuntime({ cwd: root, integration: "power", config: structuredClone(DEFAULT_FABRIC_CONFIG), powerMcpConfigPath: powerMcpConfig() });
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

  it("does not mount project memory, state, or k.* until a workspace is bound", async () => {
    const root = temp();
    const unbound = createKiroRuntime({ cwd: root, integration: "power", powerMcpConfigPath: powerMcpConfig() });
    try {
      const providers = unbound.registry.providers().map((entry) => entry.name);
      expect(providers).not.toContain("k");
      expect(providers).toContain("artifacts");
      expect(providers).not.toContain("memory");
      expect(providers).not.toContain("state");
      expect(unbound.registry.unavailableProviders()).toContainEqual(expect.objectContaining({ name: "k" }));
      expect(unbound.registry.unavailableProviders()).toContainEqual(expect.objectContaining({ name: "memory", reason: expect.stringMatching(/until a workspace is bound/i) }));
    } finally { await unbound.close(); }
    const bound = createKiroRuntime({
      cwd: root,
      integration: "power",
      powerMcpConfigPath: powerMcpConfig(),
      memoryRoot: path.join(root, "memory-bound"),
      stateRoot: path.join(root, "state-bound"),
    });
    try {
      expect(bound.registry.providers().map((entry) => entry.name)).toContain("state");
      expect(bound.registry.providers().map((entry) => entry.name)).not.toContain("k");
    } finally { await bound.close(); }
  });
});
