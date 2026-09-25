import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateAgentProfile } from "../scripts/agent-profile.mjs";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { REVIEW_GUEST_DECLARATIONS } from "../src/providers/review-contract.js";
import { PROBE_GUEST_DECLARATIONS } from "../src/providers/probe-contract.js";
import { ReviewProvider } from "../src/providers/review-provider.js";
import { ProbeProvider } from "../src/providers/probe-provider.js";
import type { LocalEvidenceMetadata } from "../src/providers/local-contract.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";

const options = {
  nodePath: path.resolve("/runtime/node"), runtimeRoot: path.resolve("/runtime/app"),
  dataRoot: path.resolve("/runtime/data"), skillPath: path.resolve("/runtime/skills/SKILL.md"),
  steeringPath: path.resolve("/runtime/steering/fabric.md"),
};
const modes = ["standard", "review", "minimal"] as const;
const fixtures: Array<{ root: string; service: FabricExecutionService }> = [];
afterEach(async () => {
  for (const { root, service } of fixtures.splice(0)) {
    await service.close();
    removeFixtureSync(root, { recursive: true, force: true });
  }
});

describe("explicit profile guidance modes", () => {
  it("keeps omitted/explicit standard identical and selects immutable public prompts", () => {
    const standard = generateAgentProfile(options);
    expect(standard).toEqual(generateAgentProfile({ ...options, guidanceMode: "standard" }));
    const profiles = modes.map(guidanceMode => generateAgentProfile({ ...options, guidanceMode }));
    expect(new Set(profiles.map(profile => profile.prompt)).size).toBe(modes.length);
    for (const [index, mode] of modes.entries()) {
      expect(generateAgentProfile({ ...options, guidanceMode: mode }).prompt).toBe(profiles[index]!.prompt);
    }
    // Public prompts are stable values; a returned profile cannot poison later generation.
    const first = generateAgentProfile(options) as unknown as { prompt: string; resources: string[] };
    first.prompt = "poisoned";
    first.resources.push("file:///poisoned");
    expect(generateAgentProfile(options)).toEqual(standard);
  });

  it.each(["", "automatic", "toString", "__proto__", null, 0, {}, ["standard"]])("rejects invalid mode %j without fallback", value => {
    const mode = value as "standard";
    expect(() => generateAgentProfile({ ...options, guidanceMode: mode })).toThrow(/guidanceMode/);
  });

  it.each(modes)("keeps strict tools, approvals, transport and path validation in %s", guidanceMode => {
    const standard = generateAgentProfile(options);
    const profile = generateAgentProfile({ ...options, guidanceMode });
    for (const key of ["tools", "allowedTools", "permissions", "includePowers", "includeMcpJson"] as const) {
      expect(profile[key]).toEqual(standard[key]);
    }
    expect(profile.mcpServers).toEqual({ fabric: {
      ...standard.mcpServers.fabric,
      env: { ...standard.mcpServers.fabric.env, KIRO_FABRIC_FOVEA_CALL_CONTEXT: guidanceMode === "minimal" ? "0" : "1" },
    } });
    expect(profile.prompt.match(/@fabric\/\w+/g)).toEqual(["@fabric/fabric_exec"]);
    expect(() => generateAgentProfile({ ...options, guidanceMode, nodePath: "relative" })).toThrow(/absolute/);
    expect(() => generateAgentProfile({ ...options, guidanceMode, dataRoot: "/bad\npath" })).toThrow(/control characters/);
  });

  it("makes code navigation Navigator-first without enabling native hooks or minimal steering", () => {
    for (const guidanceMode of ["standard", "review"] as const) {
      const profile = generateAgentProfile({ ...options, guidanceMode });
      expect(profile.prompt).toContain("use Navigator first inside fabric_exec without being asked");
      for (const api of ["repo.focus(", "repo.sketch(", "repo.impact(", "repo.focusRead({query})", "fresh:true"]) {
        expect(profile.prompt).toContain(api);
      }
      expect(profile.prompt).toContain("never bypassing denial");
      expect(profile.prompt).toContain("Skip non-code chat and forbidden tools");
      expect(profile.hooks).toHaveLength(1);
      expect(profile.hooks[0]?.action.command).toContain("--first-prompt-hook");
      expect(JSON.stringify(profile.hooks)).not.toContain("--fovea-hook");
      expect(profile.mcpServers.fabric.env.KIRO_FABRIC_FOVEA_CALL_CONTEXT).toBe("1");
    }
    expect(generateAgentProfile({ ...options, guidanceMode: "minimal" }).prompt).not.toMatch(/Navigator|repo\./u);
  });

  it("never attaches resources, first-prompt hooks, or hidden review advice in minimal", () => {
    const profile = generateAgentProfile({ ...options, guidanceMode: "minimal" });
    expect(profile.resources).toEqual([]);
    expect(profile.hooks).toEqual([]);
    expect(profile.mcpServers.fabric.env.KIRO_FABRIC_FOVEA_CALL_CONTEXT).toBe("0");
    expect(profile.prompt.length).toBeGreaterThan(0);
    expect(profile.prompt).not.toMatch(/review|finding|coverage ledger|fabric\.help|bootstrap.*help/i);
    expect(profile.prompt).not.toMatch(/task contract|acceptance ledger|plan privately|simplest credible method|next unresolved check|stop and deliver/i);
    expect(JSON.stringify(profile)).not.toMatch(/first-prompt-hook|skill:\/\/|file:\/\//);
    const bundleRoot = path.resolve("/generation");
    const bundled = {
      ...options, bundleRoot, nodePath: path.join(bundleRoot, "tools", "node"),
      rgPath: path.join(bundleRoot, "tools", "rg"), runtimeRoot: path.join(bundleRoot, "app"),
      skillPath: path.join(bundleRoot, "resources", "skills", "fabric-exec", "SKILL.md"),
      steeringPath: path.join(bundleRoot, "resources", "steering", "fabric.md"),
      guidanceMode: "minimal" as const,
    };
    expect(generateAgentProfile(bundled)).toMatchObject({ resources: [], hooks: [] });
    expect(() => generateAgentProfile({ ...bundled, rgPath: "/other/rg" })).toThrow(/complete generation/);
    const { steeringPath: _steering, ...withoutSteering } = options;
    expect(generateAgentProfile({ ...withoutSteering, guidanceMode: "minimal" }).hooks).toEqual([]);
  });

  it("opts into a short review core without automatic help or a finding quota", () => {
    const standard = generateAgentProfile(options);
    const review = generateAgentProfile({ ...options, guidanceMode: "review" });
    expect(review.prompt.startsWith(`${standard.prompt}\n\n`)).toBe(true);
    const core = review.prompt.slice(standard.prompt.length + 2);
    expect(core.length).toBeLessThan(1000);
    expect(core).toContain("Explicit review mode");
    expect(core).toContain("No finding quota");
    expect(standard.prompt).not.toContain("Explicit review mode");
    expect(review.resources).toEqual(standard.resources);
    expect(review.hooks).toEqual(standard.hooks);
    expect(review.hooks).toHaveLength(1);
    expect(review.hooks[0]?.trigger).toBe("UserPromptSubmit");
  });

  it("bounds the review reference to one default help page", () => {
    const review = fs.readFileSync(new URL("../skills/fabric-exec/references/review.md", import.meta.url), "utf8");
    expect(review.length).toBeLessThanOrEqual(16000); // Default help page, not semantic coverage.
  });

  it("type-checks optional recipes against actual provider declarations", () => {
    // Main owns mounting these declarations; standalone contracts let this worker
    // check exact shapes before the serialized runtime integration/build.
    const declarations = fabricGuestDeclarations
      + (fabricGuestDeclarations.includes("declare const review:") ? "" : REVIEW_GUEST_DECLARATIONS)
      + (fabricGuestDeclarations.includes("declare const probe:") ? "" : PROBE_GUEST_DECLARATIONS);
    const text = ["review", "api"].map(name => fs.readFileSync(new URL(`../skills/fabric-exec/references/${name}.md`, import.meta.url), "utf8")).join("\n");
    const recipes = [...text.matchAll(/```ts\n(\/\/ Recipe:[\s\S]*?)\n```/g)].map(match => match[1]!);
    for (const name of ["explicit review ledger", "explicit review update", "compact review evidence", "explicit SDK availability",
      "explicit illustrative probe project", "explicit retained probe run"]) expect(recipes.some(code => code.includes("// Recipe: " + name))).toBe(true);
    for (const code of recipes) expect(typeCheckFabricCode(code, declarations).errors, code.split("\n")[0]).toEqual([]);
  });

  it("executes opt-in ledger and retained probe recipes without pretending they prove semantics", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-typed-recipes-")));
    const workspace = path.join(root, "workspace"); fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, "input.txt"), "source evidence\n");
    const registry = new ActionRegistry();
    registry.register(new ReviewProvider({ root: workspace }));
    registry.register(new ProbeProvider({ root: workspace, probesRoot: path.join(root, "probes"),
      discoveryEnvironment: { PATH: path.dirname(process.execPath) }, sdkDirectories: [] }));
    const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 10000 } }), workspace);
    fixtures.push({ root, service });
    const text = fs.readFileSync(new URL("../skills/fabric-exec/references/api.md", import.meta.url), "utf8");
    const programs = [...text.matchAll(/```ts\n(\/\/ Recipe:[\s\S]*?)\n```/g)].map(match => match[1]!);
    const recipe = (name: string) => programs.find(code => code.startsWith(`// Recipe: ${name}\n`))!;
    // Explicit fixture approval is not evidence of a human client approval UI.
    const approver = { prepareApproval: () => ({ decision: "allow" as const }), async approve() {} };
    const begun = await service.execute({ code: recipe("explicit review ledger"), approver,
      payloads: { objective: "Trace input read", paths: '["read-input"]', scenarios: '["normal"]' } });
    expect(begun.success, begun.error).toBe(true);
    expect(begun.value).toMatchObject({ ready: false, semanticValidation: false });
    const task = begun.value as { taskId: string; entries: { id: string; status: string }[] };
    expect(task.entries.length).toBeGreaterThan(0);
    expect(task.entries.every(entry => entry.status === "unknown")).toBe(true);
    const updated = await service.execute({ code: recipe("explicit review update"), approver, payloads: { update: JSON.stringify({
      taskId: task.taskId, obligationId: task.entries[0]!.id, status: "retrieved",
      evidence: [{ path: "input.txt", startLine: 1, endLine: 1, kind: "source", rationale: "Fetched, not traced" }],
    }) } });
    expect(updated.success, updated.error).toBe(true);
    expect(updated.value).toMatchObject({ taskId: task.taskId, status: "retrieved" });
    const discovery = await service.execute({ code: recipe("explicit SDK availability"), approver,
      payloads: { executables: JSON.stringify([path.basename(process.execPath)]) } });
    expect(discovery.success, discovery.error).toBe(true);
    expect(discovery.value).toMatchObject({ executed: false, versionsObserved: false, credentialsAssumed: false });
    const created = await service.execute({ code: recipe("explicit illustrative probe project"), approver,
      payloads: { path: "note.txt", content: "illustration only\n" } });
    expect(created.success, created.error).toBe(true);
    expect(created.value).toMatchObject({ kind: "illustrative", productionProof: false, retained: true });
    const handle = created.value as { id: string; cwd: string; manifestPath: string };
    expect(fs.readFileSync(path.join(handle.cwd, "note.txt"), "utf8")).toBe("illustration only\n");
    const run = await service.execute({ code: recipe("explicit retained probe run"), approver,
      payloads: { id: handle.id, executable: process.execPath, args: JSON.stringify(["-e", "process.stdout.write(process.versions.node)"]) } });
    expect(run.success, run.error).toBe(true);
    expect(run.value).toMatchObject({ ok: true, exitCode: 0, stdout: process.versions.node, productionProof: false });
    expect(fs.existsSync(handle.manifestPath)).toBe(true);
    expect(fs.existsSync((run.value as { recordPath: string }).recordPath)).toBe(true);
  });

  it("executes tool-only reads with no guidance provider and still rejects invalid TypeScript and unauthorized effects", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-profile-probe-")));
    const workspace = path.join(root, "workspace"); fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, "input.txt"), "actual evidence\n");
    const registry = new ActionRegistry();
    registry.register(new LocalCodingProvider({ root: workspace, lockRoot: path.join(root, "locks") }));
    const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 10000 } }), workspace);
    fixtures.push({ root, service });
    const approver = {
      prepareApproval(action: { risk: string }) { return action.risk === "read" ? { decision: "allow" as const } : { decision: "deny" as const, reason: "No interactive approval available" }; },
      async approve() { throw new Error("No interactive approval available"); },
    };
    const read = await service.execute({ code: 'return await local.read({path:"input.txt"});', approver });
    expect(read.success, read.error).toBe(true);
    expect(read.value).toMatchObject({ text: "actual evidence\n" });
    const text = ["review", "api"].map(name => fs.readFileSync(new URL(`../skills/fabric-exec/references/${name}.md`, import.meta.url), "utf8")).join("\n");
    const code = text.match(/```ts\n(\/\/ Recipe: compact review evidence\n[\s\S]*?)\n```/)![1]!;
    const packet = await service.execute({ code, payloads: { windows: JSON.stringify([{ path: "input.txt", limit: 1 }]) }, approver });
    expect(packet.success, packet.error).toBe(true);
    expect(typeof packet.value).toBe("string");
    const evidence = packet.value as string;
    expect(evidence.startsWith("KIRO_LOCAL_EVIDENCE/1\n")).toBe(true);
    const footer = JSON.parse(evidence.slice(evidence.lastIndexOf("\nMETA ") + 6)) as LocalEvidenceMetadata;
    expect(footer).toMatchObject({ complete: true, remaining: [], failures: [], scope: "requested windows only; not proof of inspection" });
    const file = footer.files[0]!;
    expect(evidence.slice(file.sourceOffset, file.sourceOffset + file.sourceChars)).toBe("1: actual evidence");
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    const bad = await service.execute({ code: 'await local.write({path:"bad.txt",content:"no"}); const n:number = "invalid"; return n;', approver });
    expect(bad).toMatchObject({ success: false, error: "TypeScript validation failed", audits: [] });
    expect(fs.existsSync(path.join(workspace, "bad.txt"))).toBe(false);
    const denied = await service.execute({ code: 'return await local.write({path:"denied.txt",content:"no"});', approver });
    expect(denied.success).toBe(false);
    expect(fs.existsSync(path.join(workspace, "denied.txt"))).toBe(false);
    // This validates execution boundaries, not model adherence or launcher integration.
  });
});
