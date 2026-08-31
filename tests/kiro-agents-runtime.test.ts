import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { createKiroRuntime } from "../src/kiro/runtime.js";

const fakeWorker = resolve("tests/fixtures/fake-worker.mjs");
const routedModelIds = [
  "auto",
  "claude-haiku-4.5",
  "qwen3-coder-next",
  "claude-opus-4.8",
] as const;
const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "kiro-fabric-kiro-agents-"));
  roots.push(root);
  const project = join(root, "project");
  const agentDir = join(root, "agent");
  const runRoot = join(root, "runs");
  mkdirSync(project);
  mkdirSync(agentDir);
  mkdirSync(runRoot);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  return { project, runRoot };
};

const execute = async (
  runtime: ReturnType<typeof createKiroRuntime>,
  code: string,
) => runtime.service.execute({
  code,
  signal: undefined,
  parentToolCallId: `kiro-agents-${Date.now()}`,
  host: runtime.host,
  onPartial() {},
});

describe("managed Kiro ACP agents", () => {
  it("keeps the agents provider disabled in the managed runtime", async () => {
    const { project } = fixture();
    const runtime = createKiroRuntime({ cwd: project });
    try {
      const providers = await execute(runtime, "return await tools.providers();");
      expect(providers.success).toBe(true);
      expect(providers.value).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "agents" }),
      ]));

      const run = await execute(
        runtime,
        'return await agents.run({ task: "Do not spawn", tools: [] });',
      );
      expect(run.success).toBe(false);
      expect(run.typeErrors?.map((error) => error.message).join("\n"))
        .toMatch(/cannot find name 'agents'.*subagents require/i);
    } finally {
      await runtime.close();
    }
  });

  it("rejects incompatible accounting before creating a managed Kiro runtime", () => {
    const { project } = fixture();
    const config = structuredClone(DEFAULT_FABRIC_CONFIG);
    config.agents.budgetUsd = 0.25;
    expect(() => createKiroRuntime({
      cwd: project,
      config,
      allowExecute: true,
      enableSubagents: true,
    })).toThrow(/agents.budgetUsd/);
  });

  it("requires shell access and caps trusted subagent fan-out", async () => {
    const { project, runRoot } = fixture();
    expect(() => createKiroRuntime({ cwd: project, enableSubagents: true }))
      .toThrow(/require.*shell/i);
    const runtime = createKiroRuntime({
      cwd: project,
      allowExecute: true,
      enableSubagents: true,
      agentWorkerPath: fakeWorker,
      agentRunRoot: runRoot,
      kiroBinary: "kiro-cli-test-sentinel",
      agentAvailableModelIds: routedModelIds,
    });
    try {
      expect(runtime.service.config.agents.maxConcurrent).toBe(4);
      expect(runtime.service.config.agents.maxPerExecution).toBe(4);
      expect(runtime.service.config.agents.maxDepth).toBe(1);
      expect(runtime.service.config.executor.timeoutMs).toBe(900_000);
      const providers = await execute(runtime, "return await tools.providers();");
      expect(providers.success).toBe(true);
      expect(providers.value).toEqual(expect.arrayContaining([
        { name: "k", description: expect.any(String) },
        { name: "agents", description: expect.stringContaining("Kiro CLI ACP") },
      ]));

      const actions = await execute(
        runtime,
        'return (await tools.list({ provider: "agents" })).map((action) => action.ref);',
      );
      expect(actions.success).toBe(true);
      expect(actions.value).toEqual(expect.arrayContaining([
        "agents.run",
        "agents.spawn",
        "agents.wait",
        "agents.status",
        "agents.stop",
        "agents.log",
      ]));
      expect(actions.value).not.toContain("agents.create");
      expect(actions.value).not.toContain("agents.handoff");

      const run = await execute(
        runtime,
        'return await agents.run({ task: "Summarize the README in one sentence", tools: [] });',
      );
      expect(run.success).toBe(true);
      expect(run.value).toMatchObject({
        status: "completed",
        runner: "kiro",
        model: "claude-haiku-4.5",
        cwd: realpathSync(project),
        text: "fake worker complete",
      });
    } finally {
      await runtime.close();
    }
  });

  it("omits usage-accounted orchestration before it can launch a Kiro child", async () => {
    const { project, runRoot } = fixture();
    const runtime = createKiroRuntime({
      cwd: project,
      allowExecute: true,
      enableSubagents: true,
      agentWorkerPath: fakeWorker,
      agentRunRoot: runRoot,
      kiroBinary: "kiro-cli-test-sentinel",
      agentAvailableModelIds: routedModelIds,
    });
    try {
      // Casts deliberately bypass the declaration gate. The runtime surface
      // must still omit both helpers, so neither can reach agents.run.
      const workflowRun = await execute(
        runtime,
        'return await (workflow as any).agent("must not launch", { tools: [] });',
      );
      expect(workflowRun.success).toBe(false);
      expect(workflowRun.error).toMatch(/not a function/i);

      const councilRun = await execute(
        runtime,
        'return await (globalThis as any).council.run({ task: "must not launch", roles: ["reviewer"] });',
      );
      expect(councilRun.success).toBe(false);
      expect(councilRun.error).toMatch(/council|undefined/i);
      expect(readdirSync(runRoot)).toEqual([]);
    } finally {
      await runtime.close();
    }
  });

  it("routes cheap/code, complex, and ambiguous tasks by capability", async () => {
    const { project, runRoot } = fixture();
    const runtime = createKiroRuntime({
      cwd: project,
      allowExecute: true,
      enableSubagents: true,
      agentWorkerPath: fakeWorker,
      agentRunRoot: runRoot,
      kiroBinary: "kiro-cli-test-sentinel",
      agentAvailableModelIds: routedModelIds,
    });
    try {
      const coding = await execute(
        runtime,
        'return await agents.run({ task: "Implement a parser and add unit tests", tools: [] });',
      );
      expect(coding.success).toBe(true);
      expect(coding.value).toMatchObject({ model: "qwen3-coder-next", thinking: "low" });

      const complex = await execute(
        runtime,
        'return await agents.run({ task: "Design a secure architecture and compare trade-offs", tools: [] });',
      );
      expect(complex.success).toBe(true);
      expect(complex.value).toMatchObject({
        model: "claude-opus-4.8",
        thinking: "medium",
      });

      const ambiguous = await execute(
        runtime,
        'return await agents.run({ task: "Evaluate the available alternatives and provide a balanced recommendation based on the supplied context. ".repeat(7), tools: [] });',
      );
      expect(ambiguous.success).toBe(true);
      expect(ambiguous.value).toMatchObject({
        model: "claude-opus-4.8",
        thinking: "medium",
      });

      const explicit = await execute(
        runtime,
        'return await agents.run({ task: "Design a secure architecture", model: "claude-sonnet-4.6", tools: [] });',
      );
      expect(explicit.success).toBe(true);
      expect(explicit.value).toMatchObject({
        model: "claude-sonnet-4.6",
        thinking: "medium",
      });

      const explicitThinking = await execute(
        runtime,
        'return await agents.run({ task: "Design a secure architecture", thinking: "high", tools: [] });',
      );
      expect(explicitThinking.success).toBe(true);
      expect(explicitThinking.value).toMatchObject({
        model: "claude-opus-4.8",
        thinking: "high",
      });

      const automatic = await execute(
        runtime,
        'return await agents.run({ task: "Design a secure architecture", model: "auto", tools: [] });',
      );
      expect(automatic.success).toBe(true);
      expect(automatic.value).not.toHaveProperty("model");
      // `auto` must not inherit the Fabric-wide medium default either: Kiro
      // picks both the model and the effort for an auto run.
      expect(automatic.value).not.toHaveProperty("thinking");
    } finally {
      await runtime.close();
    }
  });

  it("does not probe the model list on the first run when inventory is unknown", async () => {
    const { project, runRoot } = fixture();
    const runtime = createKiroRuntime({
      cwd: project,
      allowExecute: true,
      enableSubagents: true,
      agentWorkerPath: fakeWorker,
      agentRunRoot: runRoot,
      // Discovery would fail if the first run tried to execute this sentinel.
      kiroBinary: "kiro-cli-model-probe-must-not-run",
    });
    try {
      const run = await execute(
        runtime,
        'return await agents.run({ task: "Implement a parser and add unit tests", tools: [] });',
      );
      expect(run.success).toBe(true);
      expect(run.value).not.toHaveProperty("model");
      expect(run.value).not.toHaveProperty("thinking");
    } finally {
      await runtime.close();
    }
  });

  it("allows an explicit child cwd inside the managed project", async () => {
    const { project, runRoot } = fixture();
    mkdirSync(join(project, "packages"), { recursive: true });
    const runtime = createKiroRuntime({
      cwd: project,
      allowExecute: true,
      enableSubagents: true,
      agentWorkerPath: fakeWorker,
      agentRunRoot: runRoot,
      kiroBinary: "kiro-cli-test-sentinel",
      agentAvailableModelIds: routedModelIds,
    });
    try {
      const run = await execute(
        runtime,
        'return await agents.run({ task: "Work in package", cwd: "packages", tools: [] });',
      );
      expect(run.success).toBe(true);
      expect(run.value).toMatchObject({ cwd: realpathSync(join(project, "packages")) });
    } finally {
      await runtime.close();
    }
  });

  it("falls back to true Kiro auto when a preferred route is not advertised", async () => {
    const { project, runRoot } = fixture();
    const runtime = createKiroRuntime({
      cwd: project,
      allowExecute: true,
      enableSubagents: true,
      agentWorkerPath: fakeWorker,
      agentRunRoot: runRoot,
      kiroBinary: "kiro-cli-test-sentinel",
      agentAvailableModelIds: ["auto"],
    });
    try {
      const run = await execute(
        runtime,
        'return await agents.run({ task: "Implement a parser and add unit tests", tools: [] });',
      );
      expect(run.success).toBe(true);
      expect(run.value).not.toHaveProperty("model");
      expect(run.value).not.toHaveProperty("thinking");
    } finally {
      await runtime.close();
    }
  });

  it("runs one-shot children without a resident steer channel", async () => {
    const { project, runRoot } = fixture();
    const runtime = createKiroRuntime({
      cwd: project,
      allowExecute: true,
      enableSubagents: true,
      agentWorkerPath: fakeWorker,
      agentRunRoot: runRoot,
      kiroBinary: "kiro-cli-test-sentinel",
      agentAvailableModelIds: routedModelIds,
    });
    try {
      const result = await execute(
        runtime,
        'return await agents.run({ task: "Summarize the README", tools: [] });',
      );
      expect(result.success).toBe(true);
      const id = (result.value as { id: string }).id;
      const steerFile = join(runRoot, id, "steer.jsonl");
      // A one-shot run must not create or reference a steer file: that file is
      // what made every `agents.run` wait out the 5s resident idle tail.
      expect(readFileSync(join(runRoot, id, "status.json"), "utf8")).toContain('"status"');
      expect(existsSync(steerFile)).toBe(false);
    } finally {
      await runtime.close();
    }
  });

  it("transfers validated semantic context to the ACP child", async () => {
    const { project, runRoot } = fixture();
    const runtime = createKiroRuntime({
      cwd: project,
      allowExecute: true,
      enableSubagents: true,
      agentWorkerPath: fakeWorker,
      agentRunRoot: runRoot,
      kiroBinary: "kiro-cli-test-sentinel",
      agentAvailableModelIds: routedModelIds,
    });
    try {
      const result = await execute(
        runtime,
        `return await agents.run({
          task: "Review the parser",
          tools: [],
          context: {
            objective: "  Preserve streaming transcript history  ",
            facts: ["Updates are deltas", "The parser previously replaced text"],
            relevantFiles: ["src/ui/transcript-parser.ts"],
            constraints: ["Do not claim native transcript continuity"],
            exclusions: ["Unrelated UI changes"]
          }
        });`,
      );

      expect(result.success).toBe(true);
      const id = (result.value as { id: string }).id;
      expect(JSON.parse(readFileSync(join(runRoot, id, "kiro-context.json"), "utf8")))
        .toEqual({
          objective: "Preserve streaming transcript history",
          facts: ["Updates are deltas", "The parser previously replaced text"],
          relevantFiles: ["src/ui/transcript-parser.ts"],
          constraints: ["Do not claim native transcript continuity"],
          exclusions: ["Unrelated UI changes"],
        });

      const rejected = await execute(
        runtime,
        `return await agents.run({
          task: "Must not launch",
          tools: [],
          context: { objective: "Valid", secrets: ["not an allowed field"] }
        });`,
      );
      expect(rejected.success).toBe(false);
      expect(rejected.typeErrors?.map((error) => error.message).join("\n"))
        .toMatch(/secrets.*does not exist/i);
      expect(readdirSync(runRoot)).toEqual([id]);
    } finally {
      await runtime.close();
    }
  });

  it("keeps a steer channel for detached resident spawns", async () => {
    const { project, runRoot } = fixture();
    const runtime = createKiroRuntime({
      cwd: project,
      allowExecute: true,
      enableSubagents: true,
      agentWorkerPath: fakeWorker,
      agentRunRoot: runRoot,
      kiroBinary: "kiro-cli-test-sentinel",
      agentAvailableModelIds: routedModelIds,
    });
    try {
      const spawned = await execute(
        runtime,
        'return await agents.spawn({ task: "HANG", tools: [] });',
      );
      expect(spawned.success).toBe(true);
      const id = (spawned.value as { id: string }).id;
      const stopped = await execute(
        runtime,
        `return await agents.stop({ id: ${JSON.stringify(id)} });`,
      );
      expect(stopped.success).toBe(true);
    } finally {
      await runtime.close();
    }
  });

  it("supports detached spawn, status, and stop without exposing recursive runners", async () => {
    const { project, runRoot } = fixture();
    const runtime = createKiroRuntime({
      cwd: project,
      allowExecute: true,
      enableSubagents: true,
      agentWorkerPath: fakeWorker,
      agentRunRoot: runRoot,
    });
    try {
      const rejected = await execute(
        runtime,
        'return await agents.run({ task: "wrong runner", runner: "pi", tools: [] });',
      );
      expect(rejected.success).toBe(false);
      expect(rejected.error).toMatch(/allowed values/i);

      const spawned = await execute(
        runtime,
        'return await agents.spawn({ task: "HANG", tools: [] });',
      );
      expect(spawned.success).toBe(true);
      const id = (spawned.value as { id: string }).id;

      const status = await execute(
        runtime,
        `return await agents.status({ id: ${JSON.stringify(id)} });`,
      );
      expect(status.success).toBe(true);
      expect(status.value).toMatchObject({ id, runner: "kiro", status: "running" });

      const stopped = await execute(
        runtime,
        `return await agents.stop({ id: ${JSON.stringify(id)} });`,
      );
      expect(stopped.success).toBe(true);
      expect(stopped.value).toMatchObject({ id, status: "stopped" });
    } finally {
      await runtime.close();
    }
  }, 20_000);
});
