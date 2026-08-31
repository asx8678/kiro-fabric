import { describe, expect, it } from "vitest";
import { GUEST_TYPE_DECLARATIONS, guestTypeDeclarations } from "../src/runtime/guest-types.js";
import {
  normalizeTypeScriptPath,
  typeCheckFabricCode,
  typeCheckFabricCodeInWorker,
} from "../src/runtime/type-checker.js";

describe("Fabric guest type checker", () => {
  it("normalizes Windows paths for TypeScript compiler host comparisons", () => {
    expect(normalizeTypeScriptPath("C:\\work\\__kiro_fabric_guest_1.ts")).toBe(
      "C:/work/__kiro_fabric_guest_1.ts",
    );
  });

  it("accepts typed Fabric code with top-level return", () => {
    const result = typeCheckFabricCode(
      'const text = await pi.read({ path: "README.md" });\nreturn text.length;',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
    expect(result.javascript).toContain("async function __kiroFabricMain()");
    expect(result.javascript).not.toContain("path: string");
  });

  it("accepts kiro in model-visible Fabric agent runner types", () => {
    const result = typeCheckFabricCode(
      `
const run = await agents.run({
  runner: "kiro",
  task: "Inspect the Kiro profile",
});
return run.status;
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("accepts a Veda persona and backend model on agents.run", () => {
    const result = typeCheckFabricCode(
      `
const run = await agents.run({
  runner: "veda",
  persona: "frontend",
  model: "claude-opus-4-6-thinking",
  task: "Polish the landing page",
});
return run.status;
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("types cwd through one-shot helpers but not handoff or actors", () => {
    const accepted = typeCheckFabricCode(
      `
await agents.run({ task: "run elsewhere", cwd: "../other" });
await agents.spawn({ task: "spawn elsewhere", cwd: "/tmp/other" });
return workflow.agent("workflow elsewhere", { cwd: "worktree" });
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(accepted.errors).toEqual([]);

    const rejected = typeCheckFabricCode(
      `
await agents.handoff({ model: "provider/model", cwd: "other" });
await agents.create({ name: "actor", instructions: "watch", cwd: "other" });
return "never";
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(rejected.errors.length).toBeGreaterThan(0);
    expect(rejected.errors.map((error) => error.message).join(" ")).toMatch(/cwd|known properties/i);
  });

  it("accepts dynamic MCP namespaces and orchestration helpers", () => {
    const result = typeCheckFabricCode(
      `
const mcpResult = await mcp.context7.resolve_library_id({ libraryName: "react" });
const review = await agents.run({ task: "Review it", transport: "localterm" });
console.log(review.status);
return { mcpResult, review };
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("accepts immediate and predicate-gated trajectory handoff", () => {
    const result = typeCheckFabricCode(
      `
await pi.edit({ path: "src/a.ts", old: "a", new: "b" });
const migrated = await agents.setModel({ id: "reviewer", model: "anthropic/executor" });
return agents.handoff({
  model: "anthropic/executor",
  task: migrated.name,
  when: ({ count, calls }) =>
    count(["pi.edit", "mcp.docs.lookup"]) >= 1 && calls[0]?.ref === "pi.edit",
});
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("accepts scoped actor bindings and per-activation overrides", () => {
    const result = typeCheckFabricCode(
      `
const session = await agents.setModel({
  id: "reviewer",
  model: "anthropic/session-model",
});
await agents.setThinking({ id: session.id, thinking: "low", scope: "session" });
const answer = await agents.ask({
  id: session.id,
  message: "Review once",
  model: "anthropic/one-off",
  thinking: "high",
});
await agents.setModel({ id: session.id, model: "anthropic/project", scope: "project" });
return { answer, binding: session.binding, defaults: session.projectDefaults };
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });
  it("accepts typed first-class Fabric provider calls", () => {
    const result = typeCheckFabricCode(
      `
const recalled = await memory.recall({ query: "proxy", branches: "active" });
const current = await state.get();
const status = await schema.status();
const hypothesis = await schema.hypothesize({
  label: "proxy-surface",
  summary: "The direct provider surface is available",
  evidence: [{ kind: "file_exists", path: "package.json" }],
});
const pending = await compact.status();
return { recalled, current, mode: status.mode, hypothesis: hypothesis.hypothesisId, pending };
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("rejects misspelled first-class provider argument keys", () => {
    const result = typeCheckFabricCode(
      'await compact.request({ reasno: "context pressure" }); return "never";',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.message).toMatch(/reasno|known properties/i);
  });

  it("keeps first-class Fabric providers typed in orchestration-only mode", () => {
    const declarations = guestTypeDeclarations(false);
    expect(declarations).not.toContain("declare const pi: PiToolsApi");
    expect(declarations).not.toContain("declare const extensions: FabricExtensionsApi");
    expect(declarations).toContain("declare const schema: FabricSchemaApi");

    const result = typeCheckFabricCode(
      'const mode = (await schema.status()).mode; const matches = await memory.recall({ query: "x" }); return { mode, matches };',
      declarations,
    );
    expect(result.errors).toEqual([]);
  });

  it("excludes globals for unavailable providers", () => {
    const declarations = guestTypeDeclarations(false, { excludeGlobals: ["memory", "state"] });
    expect(declarations).not.toContain("declare const memory: FabricMemoryApi;");
    expect(declarations).not.toContain("declare const state: FabricStateApi;");
    expect(declarations).toContain("declare const schema: FabricSchemaApi");

    const typed = typeCheckFabricCode(
      'return memory.recall({ query: "x" });',
      declarations,
    );
    expect(typed.errors.some((error) => /Cannot find name 'memory'/.test(error.message))).toBe(
      true,
    );

    const untouched = typeCheckFabricCode(
      'return (await schema.status()).mode;',
      declarations,
    );
    expect(untouched.errors).toEqual([]);
  });

  it("omits agent-backed orchestration when the host cannot account for child usage", () => {
    const declarations = guestTypeDeclarations(true, {
      agentBackedOrchestration: false,
    });
    expect(declarations).not.toContain("declare const council: FabricCouncilApi;");
    expect(declarations).not.toContain("declare const rlm:");
    expect(declarations).not.toContain("declare function agent<");
    expect(declarations).not.toContain(
      "agent<T = string>(prompt: string, options?: FabricWorkflowAgentOptions)",
    );

    const typed = typeCheckFabricCode(
      `
await workflow.agent("review");
await council.run({ task: "review", roles: ["security"] });
return rlm.query({ task: "recurse" });
`,
      declarations,
    );
    const messages = typed.errors.map((error) => error.message).join(" ");
    expect(messages).toMatch(/Cannot find name 'council'/);
    expect(messages).toMatch(/Cannot find name 'rlm'/);

    const directAgent = typeCheckFabricCode(
      'return agents.run({ task: "explicit child" });',
      declarations,
    );
    expect(directAgent.errors).toEqual([]);
  });

  it("keeps semantic context and the reduced MCP/artifact surface Kiro-only", () => {
    const piDeclarations = guestTypeDeclarations(true, { coreToolNamespace: "pi" });
    expect(piDeclarations).not.toContain("KiroFabricAgentRequest");
    const piContext = typeCheckFabricCode(
      'return agents.run({ task: "review", context: { objective: "x" } });',
      piDeclarations,
    );
    expect(piContext.errors.map((error) => error.message).join(" ")).toMatch(/context/i);

    const kiroDeclarations = guestTypeDeclarations(true, { coreToolNamespace: "k" });
    expect(kiroDeclarations).toContain("declare const mcp: KiroFabricMcpApi;");
    expect(kiroDeclarations).not.toContain("declare const mcp: FabricMcpApi;");
    expect(typeCheckFabricCode(`
await agents.run({ task: "review", context: { objective: "x" } });
await k.readArtifact({ id: "ka_${"a".repeat(48)}", offset: 0, limit: 100 });
return mcp.call({ server: "docs", tool: "search", args: {} });
`, kiroDeclarations).errors).toEqual([]);
  });

  it("accepts workflow, actor, and mesh primitives", () => {
    const result = typeCheckFabricCode(
      `
const captured = await extensions.project_status({ verbose: true });
console.log(captured.text);
const main = await agents.main();
await agents.followUp({ id: main.id, message: "review the result" });
const watcher = await agents.create({
  name: "advisor",
  instructions: "Review each turn",
  events: ["turn_end"],
  responseMode: "directive",
});
await agents.setTools({ id: watcher.id, tools: ["read", "grep", "find", "ls"] });
await agents.setDeliveryPolicy({ id: watcher.id, delivery: "mailbox", triggerTurn: false });
await agents.clearMessages({ id: watcher.id });
const template = await agents.export({ id: watcher.id, overwrite: true });
await agents.import({ id: template.id, as: "advisor-copy" });
await mesh.publish({ topic: "team.review", to: watcher.id, text: "start" });
await phase("Review");
const findings = await parallel([
  () => agent<{ issues: string[] }>("Find issues", {
    label: "issue scan",
    schema: {
      type: "object",
      properties: { issues: { type: "array", items: { type: "string" } } },
      required: ["issues"],
    },
  }),
]);
return findings;
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("accepts parallel(items, mapper, concurrency) and infers item types", () => {
    const result = typeCheckFabricCode(
      `
const items = [{ q: "a", n: 3 }, { q: "b", n: 2 }];
const out = await parallel(items, ({ q, n }) => agent(q + ":" + n, { label: q }), 2);
return out;
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("makes strict versus runtime-schema-relaxed checking explicit", () => {
    const code = 'await pi.read({ path: 42 }); return "never";';
    expect(typeCheckFabricCode(code, GUEST_TYPE_DECLARATIONS, "schema-relaxed").errors).toEqual([]);
    expect(typeCheckFabricCode(code, GUEST_TYPE_DECLARATIONS, "strict").errors)
      .toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/number/) })]));
  });

  it("enables TypeScript strictness diagnostics in strict mode", () => {
    const code = "const value: string | undefined = undefined; return value.length;";
    expect(typeCheckFabricCode(code, GUEST_TYPE_DECLARATIONS, "schema-relaxed").errors).toEqual([]);
    expect(typeCheckFabricCode(code, GUEST_TYPE_DECLARATIONS, "strict").errors)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/possibly 'undefined'/) }),
      ]));
  });

  it("runs checking in a bounded worker", async () => {
    const result = await typeCheckFabricCodeInWorker({
      code: 'return "ok";',
      declarations: GUEST_TYPE_DECLARATIONS,
      mode: "strict",
    }, {
      workerUrl: new URL("../dist/runtime/compiler-worker-entry.js", import.meta.url),
    });
    expect(result.errors).toEqual([]);
    expect(result.javascript).toContain("__kiroFabricMain");
  });

  it("terminates compiler workers on timeout, abort, and worker failure", async () => {
    const hangingWorker = new URL("data:text/javascript," + encodeURIComponent("setInterval(() => {}, 1000)"));
    await expect(typeCheckFabricCodeInWorker(
      { code: "", declarations: "", mode: "strict" },
      { timeoutMs: 10, workerUrl: hangingWorker },
    )).rejects.toThrow(/timed out/);

    const controller = new AbortController();
    const pending = typeCheckFabricCodeInWorker(
      { code: "", declarations: "", mode: "strict" },
      { signal: controller.signal, workerUrl: hangingWorker },
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);

    const brokenWorker = new URL("data:text/javascript," + encodeURIComponent("throw new Error('boom')"));
    await expect(typeCheckFabricCodeInWorker(
      { code: "", declarations: "", mode: "strict" },
      { workerUrl: brokenWorker },
    )).rejects.toThrow(/worker failed.*boom/i);
  });

  it("reports user-facing line numbers for functional errors", () => {
    // Wrong arg type (path: 42) is now deferred to runtime (functional-errors-only);
    // an undefined name is a genuine breakage still caught at type-check.
    const result = typeCheckFabricCode(
      'await pi.read({ path: missingFile });\nreturn "never";',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.line).toBe(1);
    expect(result.errors[0]?.message).toContain("Cannot find name");
  });
});
