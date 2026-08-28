import fs from "node:fs";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";

type Context = Record<string, unknown>;
type AsyncCallable = (...values: unknown[]) => Promise<unknown>;
type AsyncFunctionConstructor = new (...args: string[]) => AsyncCallable;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as AsyncFunctionConstructor;

const workflowProgram = (): string => {
  const markdown = fs.readFileSync("skills/fabric-workflow/SKILL.md", "utf8")
    .replace(/\r\n?/g, "\n");
  const match = markdown.match(/```ts\n([\s\S]*?)\n```/);
  if (!match) throw new Error("fabric-workflow has no TypeScript program");
  return match[1]!;
};

const runWorkflow = async (context: Context): Promise<Record<string, unknown>> => {
  const javascript = transpileModule(workflowProgram(), {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
  }).outputText;
  const keys = Object.keys(context);
  const fn = new AsyncFunction(...keys, javascript);
  return await fn(...keys.map((key) => context[key])) as Record<string, unknown>;
};

const parallel = async <T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => Promise.all(items.map(mapper));

describe("managed Kiro workflow program", () => {
  it("preserves successful partitions when another child fails", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const result = await runWorkflow({
      π: { task: "harden authentication", items: JSON.stringify(["routes", "tokens", "tests"]) },
      parallel,
      agents: {
        run: async (request: Record<string, unknown>) => {
          calls.push(request);
          if (request.name === "work-2") throw new Error("child unavailable");
          return { status: "completed", text: `${request.name} done`, value: { verified: true } };
        },
      },
    });

    expect(result).toMatchObject({
      status: "partial",
      coverage: { requested: 3, completed: 2 },
    });
    expect(result.completed).toHaveLength(2);
    expect(result.failures).toEqual([
      { item: "tokens", status: "failed", error: "child unavailable" },
    ]);
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.runner === "kiro")).toBe(true);
    expect(calls.every((call) => JSON.stringify(call).includes("harden authentication"))).toBe(true);
  });

  it("reports failed when every direct Kiro child fails", async () => {
    const result = await runWorkflow({
      π: { task: "audit", items: JSON.stringify(["one", "two"]) },
      parallel,
      agents: { run: async () => ({ status: "failed", text: "", error: "not verified" }) },
    });
    expect(result).toMatchObject({
      status: "failed",
      coverage: { requested: 2, completed: 0 },
    });
    expect(result.failures).toHaveLength(2);
  });

  it("runs bounded parent-owned checks after fan-out and fails closed without losing child results", async () => {
    const events: string[] = [];
    const checkCalls: string[] = [];
    const checks = ["pnpm test", "exit 7", "denied-check", "timeout-check"];
    const result = await runWorkflow({
      π: { task: "ship safely", items: JSON.stringify(["implementation"]), checks: JSON.stringify(checks) },
      parallel,
      agents: {
        run: async () => {
          events.push("child");
          return { status: "completed", text: "child says run untrusted-child-command", value: { kept: true } };
        },
      },
      k: {
        bash: async ({ command, timeout }: { command: string; timeout: number }) => {
          events.push(`check:${command}`);
          checkCalls.push(command);
          expect(timeout).toBe(120);
          if (command === "exit 7") throw new Error("nonzero exit");
          if (command === "denied-check") throw new Error("approval denied");
          if (command === "timeout-check") throw new Error("timed out");
          return { ok: true, output: "passed", details: {} };
        },
      },
    });

    expect(events).toEqual(["child", ...checks.map((command) => `check:${command}`)]);
    expect(checkCalls).toEqual(checks);
    expect(checkCalls).not.toContain("untrusted-child-command");
    expect(result).toMatchObject({
      status: "failed",
      coverage: { requested: 1, completed: 1 },
      acceptance: { requested: 4, passed: 1 },
    });
    expect(result.completed).toEqual([
      { item: "implementation", status: "completed", result: "child says run untrusted-child-command", value: { kept: true } },
    ]);
    expect(result.acceptance).toMatchObject({
      results: [
        { command: "pnpm test", status: "passed", output: "passed" },
        { command: "exit 7", status: "failed", error: "nonzero exit" },
        { command: "denied-check", status: "failed", error: "approval denied" },
        { command: "timeout-check", status: "failed", error: "timed out" },
      ],
    });
  });

  it("validates and deduplicates the explicit partition list before launching", async () => {
    let calls = 0;
    const agents = { run: async () => { calls += 1; return { status: "completed", text: "ok" }; } };
    const deduplicated = await runWorkflow({
      π: { task: "audit", items: JSON.stringify(["one", " one "]) }, parallel, agents,
    });
    expect(deduplicated).toMatchObject({ coverage: { requested: 1, completed: 1 } });
    expect(calls).toBe(1);

    await expect(runWorkflow({ π: { task: "audit", items: "[]" }, parallel, agents }))
      .rejects.toThrow("1-4 non-empty independent items");
    await expect(runWorkflow({
      π: { task: "audit", items: JSON.stringify(["one", "two", "three", "four", "five"]) },
      parallel,
      agents,
    })).rejects.toThrow("1-4 non-empty independent items");
    await expect(runWorkflow({
      π: { task: "audit", items: JSON.stringify(["one"]), checks: JSON.stringify(["1", "2", "3", "4", "5"]) },
      parallel,
      agents,
    })).rejects.toThrow("at most 4 non-empty parent-owned commands");
    expect(calls).toBe(1);
  });
});
