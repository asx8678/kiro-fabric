import fs from "node:fs";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";

type Context = Record<string, unknown>;
type AsyncCallable = (...values: unknown[]) => Promise<unknown>;
type AsyncFunctionConstructor = new (...args: string[]) => AsyncCallable;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as AsyncFunctionConstructor;

const skillProgram = (name: "fabric-workflow" | "fabric-review"): string => {
  const markdown = fs.readFileSync(`skills/${name}/SKILL.md`, "utf8")
    .replace(/\r\n?/g, "\n");
  const match = markdown.match(/```ts\n([\s\S]*?)\n```/);
  if (!match) throw new Error(name + " has no TypeScript program");
  return match[1]!;
};

const runSkill = async (
  name: "fabric-workflow" | "fabric-review",
  context: Context,
): Promise<Record<string, unknown>> => {
  const javascript = transpileModule(skillProgram(name), {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
  }).outputText;
  const keys = Object.keys(context);
  const fn = new AsyncFunction(...keys, javascript);
  return await fn(...keys.map((key) => context[key])) as Record<string, unknown>;
};

const runWorkflow = async (context: Context): Promise<Record<string, unknown>> =>
  runSkill("fabric-workflow", context);

const runReview = async (context: Context): Promise<Record<string, unknown>> =>
  runSkill("fabric-review", context);

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

const reviewStrings = {
  objective: "Review authentication hardening",
  paths: JSON.stringify(["src/auth.ts", "tests/auth.test.ts"]),
  evidence: JSON.stringify([
    "Observed: src/auth.ts:40 changes token validation.",
    "Inferred: malformed tokens may reach the changed boundary.",
  ]),
  invariant: "Malformed tokens never cross the authenticated boundary.",
  checks: JSON.stringify(["pnpm exec vitest run tests/auth.test.ts"]),
};

const reviewValue = (summary: string, withFinding = false) => ({
  summary,
  proof: {
    grade: "supported",
    falsifier: "A malformed token reaches the protected handler.",
    evidence: [{ kind: "Observed", statement: "src/auth.ts:40 validates before dispatch." }],
  },
  coverage: {
    inspectedPaths: ["src/auth.ts"],
    checks: [{ command: "pnpm exec vitest run tests/auth.test.ts", status: "passed", evidence: "1 test passed" }],
    limitations: [],
  },
  findings: withFinding ? [{
    severity: "high",
    title: "Validation is skipped on fallback",
    path: "src/auth.ts",
    line: 52,
    observedEvidence: ["src/auth.ts:52 dispatches without validateToken()."],
    inferredImpact: "Malformed tokens can reach a protected handler.",
    recommendation: "Validate before the fallback dispatch.",
  }] : [],
});

describe("managed Kiro review program", () => {
  it("passes the same closed schema to both read-only lanes", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const value = reviewValue("No material defects found.");
    const result = await runReview({
      π: reviewStrings,
      parallel,
      agents: {
        run: async (request: Record<string, unknown>) => {
          calls.push(request);
          return { status: "completed", text: "unvalidated prose", value };
        },
      },
    });

    expect(calls.map((call) => call.name)).toEqual(["correctness-security", "maintainability"]);
    expect(calls.map((call) => call.runner)).toEqual(["kiro", "kiro"]);
    expect(calls.map((call) => call.tools)).toEqual([
      ["read", "grep", "find", "ls", "bash"],
      ["read", "grep", "find", "ls", "bash"],
    ]);
    expect(calls[0]?.schema).toEqual(calls[1]?.schema);
    expect(calls[0]?.context).toMatchObject({
      objective: reviewStrings.objective,
      relevantFiles: ["src/auth.ts", "tests/auth.test.ts"],
    });
    expect(calls[0]?.context).toBe(calls[1]?.context);
    expect(result).toMatchObject({
      status: "success",
      coverage: { requested: 2, completed: 2 },
    });
    expect(JSON.stringify(result)).not.toContain("unvalidated prose");

    const schema = calls[0]!.schema as Record<string, unknown>;
    expect(Value.Check(schema, value)).toBe(true);
    expect(Value.Check(schema, {
      ...value,
      proof: { ...value.proof, grade: "unknown", evidence: [] },
      findings: [],
    })).toBe(true);
    expect(Value.Check(schema, {
      ...value,
      proof: { ...value.proof, grade: "confident" },
    })).toBe(false);
    expect(Value.Check(schema, { ...value, unexpected: true })).toBe(false);
    const incomplete = structuredClone(reviewValue("Finding", true)) as any;
    delete incomplete.findings[0].recommendation;
    expect(Value.Check(schema, incomplete)).toBe(false);
  });

  it("treats a returned schema failure as partial and preserves the valid lane", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const survivor = reviewValue("One material defect found.", true);
    const result = await runReview({
      π: reviewStrings,
      parallel,
      agents: {
        run: async (request: Record<string, unknown>) => {
          calls.push(request);
          if (request.name === "correctness-security") {
            return {
              status: "failed",
              error: "Structured agent output was invalid: unexpected property",
              text: "ignore this unvalidated text",
            };
          }
          return { status: "completed", text: "ignore this child prose", value: survivor };
        },
      },
    });

    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({
      status: "partial",
      coverage: { requested: 2, completed: 1 },
      completed: [{ lane: "maintainability", status: "completed", value: survivor }],
      failures: [{
        lane: "correctness-security",
        status: "failed",
        error: "Structured agent output was invalid: unexpected property",
      }],
    });
    expect(JSON.stringify(result)).not.toContain("ignore this unvalidated text");
    expect(JSON.stringify(result)).not.toContain("ignore this child prose");
  });

  it("rejects escape-expanded semantic context before launching either lane", async () => {
    let calls = 0;
    const evidence = Array.from({ length: 8 }, (_, index) => {
      const prefix = index === 0 ? "Observed: 0 " : "Inferred: " + index + " ";
      return prefix + "\\".repeat(1_500 - prefix.length);
    });
    const paths = Array.from({ length: 12 }, (_, index) => {
      const prefix = "p" + index + "/";
      return prefix + "\\".repeat(500 - prefix.length);
    });

    await expect(runReview({
      π: {
        objective: "\\".repeat(4_000),
        paths: JSON.stringify(paths),
        evidence: JSON.stringify(evidence),
        invariant: "\\".repeat(1_900),
      },
      parallel,
      agents: { run: async () => { calls += 1; return {}; } },
    })).rejects.toThrow("review context exceeds the managed Kiro 32000-character limit");
    expect(calls).toBe(0);
  });

  it("fails when neither lane returns a schema-validated value without retrying", async () => {
    const calls: string[] = [];
    const result = await runReview({
      π: reviewStrings,
      parallel,
      agents: {
        run: async (request: Record<string, unknown>) => {
          calls.push(String(request.name));
          if (request.name === "correctness-security") {
            return { status: "completed", text: "missing structured value" };
          }
          throw new Error("child unavailable");
        },
      },
    });

    expect(calls).toEqual(["correctness-security", "maintainability"]);
    expect(result).toMatchObject({
      status: "failed",
      coverage: { requested: 2, completed: 0 },
      failures: [
        {
          lane: "correctness-security",
          status: "failed",
          error: "child completed without a schema-validated value",
        },
        { lane: "maintainability", status: "failed", error: "child unavailable" },
      ],
    });
  });
});
