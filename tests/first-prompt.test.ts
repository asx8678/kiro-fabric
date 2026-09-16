import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { firstPromptContext } from "../src/kiro/first-prompt-hook.js";
import { FIRST_PROMPT_GUIDANCE } from "../src/kiro/first-prompt-guidance.js";
import { BUNDLED_GUIDANCE } from "../src/kiro/generated-guidance.js";
import { generateAgentProfile } from "../scripts/agent-profile.mjs";
import { createKiroRuntime, type KiroRuntime } from "../src/kiro/runtime.js";
import { normalizeFabricConfig } from "../src/config.js";
import { projectFabricExecutionText } from "../src/kiro/projection.js";
import type { LocalFindResult, LocalReadManyResult } from "../src/providers/local-contract.js";

const fixtures: string[] = [];
const runtimes: KiroRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-first-prompt-")));
  fixtures.push(root);
  const data = path.join(root, "data"); fs.mkdirSync(data, { mode: 0o700 });
  const workspace = path.join(root, "workspace"); fs.mkdirSync(workspace, { mode: 0o700 });
  return { root, data, workspace };
}
const event = (session = "session-one", prompt = "review this project") => ({ session_id: session, prompt, hook_event_name: "UserPromptSubmit", cwd: "/unused" });
const entry = path.resolve("dist/kiro-agent-closure/kiro/mcp-entry.js");
function processProbe(command: string, args: string[], input: string, cwd: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "pipe", env: { ...process.env, KIRO_FABRIC_EXPECTED_NODE: "/invalid-mcp-node" } });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Hook did not terminate")); }, 10000);
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.on("error", error => { if ((error as NodeJS.ErrnoException).code !== "EPIPE") reject(error); });
    child.stdin.end(input);
  });
}
const hook = (data: string, input: unknown, cwd: string) => processProbe(process.execPath, [entry, "--first-prompt-hook", data], JSON.stringify(input), cwd);

type StarterResult = {
  manifest: LocalFindResult;
  help: { topic: string; text: string; truncated: boolean } | null;
  packets?: { area: string; evidence?: LocalReadManyResult; deferred?: string[]; error?: string; unread?: string[] }[];
  narrowDiscovery?: boolean;
  unclassified?: string[];
};
const readApprover = {
  prepareApproval(action: { risk: string }) { expect(action.risk).toBe("read"); return { decision: "allow" as const }; },
  async approve() { throw new Error("Unexpected approval"); },
};
async function starter(f: ReturnType<typeof fixture>) {
  const runtime = createKiroRuntime({ cwd: f.workspace, workspaceRoot: f.workspace, localLockRoot: path.join(f.data, "locks"), artifactsRoot: path.join(f.data, "artifacts"), configFile: path.join(f.data, "config.json"), mcpConfigPath: path.join(f.data, "mcp.json"), config: normalizeFabricConfig({ executor: { timeoutMs: 10000 }, mcp: { enabled: false }, memory: { enabled: false }, state: { enabled: false } }) });
  runtimes.push(runtime);
  // Execute the actual task-loaded recipe, not a second copy in the hook or test.
  const code = BUNDLED_GUIDANCE.review.match(/```ts\n(\/\/ Recipe: initial review evidence\n[\s\S]*?)\n```/)?.[1];
  expect(code).toBeDefined();
  const result = await runtime.service.execute({ code: code!, approver: readApprover });
  expect(result.success, JSON.stringify({ error: result.error, typeErrors: result.typeErrors })).toBe(true);
  const projection = projectFabricExecutionText({ result, resultFormat: "auto", maxOutputChars: 50000, writeArtifact() { throw new Error("Unexpected spill"); } });
  expect(projection.overflowed).toBe(false);
  expect(JSON.parse(projection.text)).toEqual(result.value);
  expect(result.audits.slice(0, 2).map(a => a.ref).sort()).toEqual(["fabric.help", "local.find"]);
  expect(result.audits.slice(2).every(audit => audit.ref === "local.readMany")).toBe(true);
  expect((result.value as StarterResult).help).toEqual({ topic: "review", text: BUNDLED_GUIDANCE.review, truncated: false });
  return { runtime, value: result.value as StarterResult };
}
function put(f: ReturnType<typeof fixture>, file: string, source = "fixture\n") {
  const target = path.join(f.workspace, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
}

describe("first submitted prompt context", () => {
  it("keeps the first hook a short task reminder, not a second workflow or tool recipe", () => {
    expect(Buffer.byteLength(FIRST_PROMPT_GUIDANCE)).toBeLessThan(400);
    expect(FIRST_PROMPT_GUIDANCE.split("\n")).toHaveLength(3);
    expect(FIRST_PROMPT_GUIDANCE).toMatch(/^<fabric_initial_investigation>\n[\s\S]*\n<\/fabric_initial_investigation>$/);
    for (const clause of ["standing task contract", "answer, plan, review or authorized implementation",
      "Resume the next unresolved acceptance check", "do not widen scope by default",
      "Stop at acceptance", "exact blocker without claiming completion"]) expect(FIRST_PROMPT_GUIDANCE).toContain(clause);
    expect(FIRST_PROMPT_GUIDANCE).not.toMatch(/```|local\.|fabric\.help|runtime availability|coverage ledger/);
  });

  it("executes the review runtime discovery and preserves every batched probe outcome", async () => {
    const f = fixture();
    const { runtime } = await starter(f);
    const recipe = (name: string) => {
      const code = BUNDLED_GUIDANCE.review.match(new RegExp("```ts\\n(// Recipe: " + name + "\\n[\\s\\S]*?)\\n```"))?.[1];
      expect(code).toBeDefined(); return code!;
    };
    const approver = { prepareApproval: () => ({ decision: "allow" as const }), async approve() {} };
    const available = await runtime.service.execute({
      code: recipe("review runtime availability"), approver,
      payloads: { executables: JSON.stringify(["sh", "fabric-deliberately-missing-runtime-7841"]) },
    });
    expect(available.success, available.error).toBe(true);
    expect(available.value).toMatchObject({ ok: true, stdout: "sh available\nfabric-deliberately-missing-runtime-7841 unavailable\n" });
    const probes = await runtime.service.execute({
      code: recipe("review verification batch"), approver,
      payloads: { checks: JSON.stringify([
        { name: "original failure", script: 'printf "failure evidence\\n" >&2; exit 7' },
        { name: "counterexample", script: 'printf "%s\\n" "$1"', args: ["literal $(touch should-not-exist)"] },
      ]) },
    });
    expect(probes.success, probes.error).toBe(true);
    expect(probes.audits).toHaveLength(2);
    expect(probes.value).toMatchObject({ complete: true, remaining: [], results: [
      { name: "original failure", status: "executed", ok: false, exitCode: 7, stderr: "failure evidence\n", truncated: false },
      { name: "counterexample", status: "executed", ok: true, exitCode: 0, stdout: "literal $(touch should-not-exist)\n", truncated: false },
    ] });
    expect(fs.existsSync(path.join(f.workspace, "should-not-exist"))).toBe(false);
  });

  it("emits once per session without persisting user text, and isolates concurrent chat identities", () => {
    const f = fixture();
    expect(firstPromptContext(event("session-a", "PRIVATE-PROMPT-CONTENTS"), f.data)).toBe(FIRST_PROMPT_GUIDANCE);
    expect(firstPromptContext({ ...event("session-a", "now implement it"), cwd: "/another/project" }, f.data)).toBe("");
    expect(firstPromptContext(event("session-b"), f.data)).toBe(FIRST_PROMPT_GUIDANCE);
    const directory = path.join(f.data, "first-prompts");
    const markers = fs.readdirSync(directory);
    expect(markers).toHaveLength(2);
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    for (const name of markers) {
      expect(name).toMatch(/^[a-f0-9]{64}\.json$/u);
      const target = path.join(directory, name);
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
      expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual({
        schemaVersion: 1, guidanceSha256: createHash("sha256").update(FIRST_PROMPT_GUIDANCE).digest("hex"),
      });
    }
  });

  it("does not consume a session for empty input and rejects invalid identity before touching state", () => {
    const f = fixture();
    expect(firstPromptContext(event("empty", " \n"), f.data)).toBe("");
    for (const input of [null, [], {}, { ...event(), session_id: "" }, { ...event(), session_id: "a\nb" }, { ...event(), prompt: 1 }, { ...event(), hook_event_name: "Stop" }]) {
      expect(() => firstPromptContext(input, f.data)).toThrow();
    }
    expect(fs.readdirSync(f.data)).toEqual([]);
    expect(firstPromptContext({ ...event("empty"), hook_event_name: "userPromptSubmit" }, f.data)).toBe(FIRST_PROMPT_GUIDANCE);
  });

  it("refuses non-private or redirected state instead of writing through it", () => {
    const f = fixture();
    fs.chmodSync(f.data, 0o755);
    expect(() => firstPromptContext(event(), f.data)).toThrow();
    fs.chmodSync(f.data, 0o700);
    const alias = path.join(f.root, "alias"); fs.symlinkSync(f.data, alias);
    expect(() => firstPromptContext(event(), alias)).toThrow();
    const elsewhere = path.join(f.root, "elsewhere"); fs.mkdirSync(elsewhere, { mode: 0o700 });
    fs.symlinkSync(elsewhere, path.join(f.data, "first-prompts"));
    expect(() => firstPromptContext(event(), f.data)).toThrow();
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it("rejects symlink and hard-link markers without modifying their targets", () => {
    const f = fixture(); firstPromptContext(event(), f.data);
    const directory = path.join(f.data, "first-prompts");
    const marker = path.join(directory, fs.readdirSync(directory)[0]!);
    fs.unlinkSync(marker);
    const foreign = path.join(f.root, "foreign"); fs.writeFileSync(foreign, "preserve", { mode: 0o600 });
    fs.symlinkSync(foreign, marker);
    expect(() => firstPromptContext(event(), f.data)).toThrow();
    fs.unlinkSync(marker); fs.linkSync(foreign, marker);
    expect(() => firstPromptContext(event(), f.data)).toThrow();
    expect(fs.readFileSync(foreign, "utf8")).toBe("preserve");
  });

  it("emits exactly one block across simultaneous built hook processes and none after resume", async () => {
    const f = fixture();
    const results = await Promise.all(Array.from({ length: 6 }, () => hook(f.data, event(), f.root)));
    for (const result of results) expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(results.filter(result => result.stdout !== "")).toEqual([{ code: 0, stderr: "", stdout: FIRST_PROMPT_GUIDANCE + "\n" }]);
    expect(await hook(f.data, event("session-one", "follow-up after restart"), f.root)).toEqual({ code: 0, stdout: "", stderr: "" });
    expect((await hook(f.data, event("new-chat"), f.root)).stdout).toBe(FIRST_PROMPT_GUIDANCE + "\n");
  });

  it("runs the generated profile hook with literal paths and no MCP startup or model call", async () => {
    const f = fixture();
    const data = path.join(f.root, "data ' $(touch unintended) `touch unintended` ${WORKSPACE_ROOT}");
    fs.mkdirSync(data, { mode: 0o700 });
    const profile = generateAgentProfile({ nodePath: process.execPath, runtimeRoot: path.dirname(path.dirname(entry)), dataRoot: data, skillPath: path.resolve("skills/fabric-exec/SKILL.md") });
    expect(profile.hooks).toHaveLength(1);
    const config = profile.hooks[0]!;
    expect(config).toMatchObject({ trigger: "UserPromptSubmit", timeout: 5, action: { type: "command" } });
    // The installed Kiro runner expands this macro before passing the command to sh.
    const first = await processProbe("/bin/sh", ["-c", config.action.command.replaceAll("${WORKSPACE_ROOT}", f.root)], JSON.stringify(event()), f.root);
    expect(first).toEqual({ code: 0, stdout: FIRST_PROMPT_GUIDANCE + "\n", stderr: "" });
    expect(fs.existsSync(path.join(f.root, "unintended"))).toBe(false);
    expect(profile).not.toHaveProperty("model");
  });

  it("does not echo malformed or oversized input in diagnostics", async () => {
    const f = fixture();
    for (const input of ["PRIVATE-invalid-json", JSON.stringify(event("large", "PRIVATE".repeat(350000)))]) {
      const result = await processProbe(process.execPath, [entry, "--first-prompt-hook", f.data], input, f.root);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("first-prompt hook failed");
      expect(result.stderr).not.toContain("PRIVATE");
    }
    expect(fs.readdirSync(f.data)).toEqual([]);
  });

  it.each([false, true])("executes its discovery/read example without fabricated paths (entrypoints=%s)", async entrypoints => {
    const f = fixture();
    if (entrypoints) {
      fs.writeFileSync(path.join(f.workspace, "README.md"), "# Fixture\nCI owns validation.\n");
      fs.mkdirSync(path.join(f.workspace, ".azure-pipelines"));
      fs.writeFileSync(path.join(f.workspace, ".azure-pipelines", "test-pipeline.yml"), "run: validate\n");
      fs.writeFileSync(path.join(f.workspace, "secret.xml"), "DO-NOT-AUTOREAD");
    }
    const { value } = await starter(f);
    expect(value.manifest).toMatchObject({ scope: { hidden: true }, truncated: false });
    const files = value.packets!.flatMap(packet => {
      expect(packet).toMatchObject({ evidence: { complete: true, remaining: [] }, deferred: [] });
      return packet.evidence!.files;
    });
    expect(files.map(file => file.path)).toEqual(entrypoints ? ["README.md", ".azure-pipelines/test-pipeline.yml"] : []);
    if (entrypoints) expect(files[1]!.source).toBe("1: run: validate");
    expect(JSON.stringify(value)).not.toContain("DO-NOT-AUTOREAD");
  });

  it("keeps executable and environment evidence visible despite long documentation and retains exact continuations", async () => {
    const f = fixture();
    put(f, "README.md", Array.from({ length: 180 }, (_, i) => "line-" + (i + 1) + " " + "detail ".repeat(15)).join("\n") + "\n");
    for (let i = 0; i < 12; i++) put(f, "docs/topic-" + i + "/README.md");
    for (const file of ["AGENTS.md", "package.json", ".github/workflows/ci.yml", ".azure-pipelines/release-pipeline.yml", "chart/Chart.yaml", "chart/values.yaml", "configurations/common/deployment.yaml", "configurations/envs/prod/deployment.yaml", "configurations/envs/staging/deployment.yaml", "chart/templates/service.yaml", "validations/check.ps1"]) put(f, file);
    put(f, "scripts/cleanup.ps1", "# Long executable\n".repeat(400));
    put(f, "chart/templates/secret.yaml", "DO-NOT-AUTOREAD");
    put(f, "secrets/values.yaml", "DO-NOT-AUTOREAD");
    const { runtime, value } = await starter(f);
    const packets = value.packets!;
    expect(packets.every(packet => packet.evidence && !packet.error), JSON.stringify(packets)).toBe(true);
    const files = packets.flatMap(packet => packet.evidence!.files);
    const delivered = files.map(file => file.path);
    expect(delivered).toEqual(expect.arrayContaining(["package.json", ".github/workflows/ci.yml", ".azure-pipelines/release-pipeline.yml", "chart/Chart.yaml", "chart/values.yaml", "configurations/common/deployment.yaml", "configurations/envs/prod/deployment.yaml", "configurations/envs/staging/deployment.yaml", "scripts/cleanup.ps1", "chart/templates/service.yaml", "validations/check.ps1"]));
    expect(new Set(delivered).size).toBe(delivered.length);
    expect(JSON.stringify(value)).not.toContain("DO-NOT-AUTOREAD");
    const docs = packets.find(packet => packet.area === "guidance")!;
    expect(docs.deferred!.length).toBeGreaterThan(0);
    const prefix = docs.evidence!.files.find(file => file.path === "README.md")!;
    expect(prefix.truncated).toBe(true);
    expect(docs.evidence!.remaining[0]).toMatchObject({ path: "README.md", offset: prefix.nextOffset, expectedSha256: prefix.sha256 });
    const continuation = await runtime.service.execute({ code: "return await local.readMany({windows:" + JSON.stringify(docs.evidence!.remaining) + "});", approver: readApprover });
    expect(continuation.success, continuation.error).toBe(true);
    const continued = continuation.value as unknown as LocalReadManyResult;
    expect(continued.complete).toBe(true);
    expect(continued.files[0]!.startLine).toBe(prefix.endLine! + 1);
    expect(continued.files[0]!.nextOffset).toBe(161);
    const suffix = await runtime.service.execute({ code: "return await local.readMany({windows:" + JSON.stringify([{ path: "README.md", offset: continued.files[0]!.nextOffset, expectedSha256: prefix.sha256 }]) + "});", approver: readApprover });
    expect(suffix.success, suffix.error).toBe(true);
    expect(suffix.value).toMatchObject({ files: [{ startLine: 161, endLine: 180, truncated: false }], complete: true });
  });

  it("finds source without documentation or a recognized build manifest", async () => {
    const f = fixture(); put(f, "server.py", "def main(): pass\n");
    const { value } = await starter(f);
    expect(value.packets).toMatchObject([{ area: "implementation", evidence: { files: [{ path: "server.py", source: "1: def main(): pass" }] } }]);
  });

  it("collects SQL and Helm evidence while keeping unmatched and sensitive paths open", async () => {
    const f = fixture();
    for (const file of ["init_database.sql", "helm/app/values.yaml", "helm/app/templates/deployment.yaml", ".azure-pipelines/check.yml"]) put(f, file);
    put(f, "validations/schema.xsd", "<schema/>");
    put(f, "custom.unknown", "unclassified evidence");
    put(f, "secrets/values.yaml", "DO-NOT-AUTOREAD");
    const { value } = await starter(f);
    const delivered = value.packets!.flatMap(packet => packet.evidence!.files.map(file => file.path));
    expect(delivered).toEqual(expect.arrayContaining(["init_database.sql", "helm/app/values.yaml", "helm/app/templates/deployment.yaml", ".azure-pipelines/check.yml"]));
    expect(value.unclassified).toEqual(expect.arrayContaining(["validations/schema.xsd", "custom.unknown", "secrets/values.yaml"]));
    expect(JSON.stringify(value)).not.toContain("DO-NOT-AUTOREAD");
    expect(JSON.stringify(value).length).toBeLessThan(40000);
  });

  it("retains a failed area's unread paths without discarding other source packets", async () => {
    const f = fixture();
    put(f, "README.md", "x".repeat(30000));
    put(f, "src/index.ts", "export const available = true;\n");
    const { value } = await starter(f);
    expect(value.packets).toEqual(expect.arrayContaining([
      expect.objectContaining({ area: "guidance", error: expect.any(String), unread: ["README.md"] }),
      expect.objectContaining({ area: "implementation", evidence: expect.objectContaining({ files: [expect.objectContaining({ path: "src/index.ts" })] }) }),
    ]));
  });

  it("retains truncated discovery and requests narrowing when path metadata leaves no source budget", async () => {
    const f = fixture();
    for (let i = 0; i < 201; i++) put(f, "docs/" + String(i).padStart(3, "0") + "-" + "x".repeat(155) + "/README.md");
    const { value } = await starter(f);
    expect(value).toMatchObject({ manifest: { truncated: true }, narrowDiscovery: true });
    expect(value.manifest.paths.length).toBeGreaterThan(0);
    expect(value.manifest.paths.length).toBeLessThanOrEqual(200);
    expect(value).not.toHaveProperty("packets");
  });
});
