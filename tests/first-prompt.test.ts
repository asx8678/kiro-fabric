import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { firstPromptContext } from "../src/kiro/first-prompt-hook.js";
import { FIRST_PROMPT_GUIDANCE, FIRST_PROMPT_PROGRAM } from "../src/kiro/first-prompt-guidance.js";
import { generateAgentProfile } from "../scripts/agent-profile.mjs";
import { createKiroRuntime, type KiroRuntime } from "../src/kiro/runtime.js";
import { normalizeFabricConfig } from "../src/config.js";
import { projectFabricExecutionText } from "../src/kiro/projection.js";

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

describe("first submitted prompt context", () => {
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
      expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual({ schemaVersion: 1, guidanceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
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
    const runtime = createKiroRuntime({ cwd: f.workspace, workspaceRoot: f.workspace, localLockRoot: path.join(f.data, "locks"), artifactsRoot: path.join(f.data, "artifacts"), configFile: path.join(f.data, "config.json"), mcpConfigPath: path.join(f.data, "mcp.json"), config: normalizeFabricConfig({ executor: { timeoutMs: 10000 }, mcp: { enabled: false }, memory: { enabled: false }, state: { enabled: false } }) });
    runtimes.push(runtime);
    const result = await runtime.service.execute({ code: FIRST_PROMPT_PROGRAM, approver: {
      prepareApproval(action) { expect(action.risk).toBe("read"); return { decision: "allow" as const }; },
      async approve() { throw new Error("Unexpected approval"); },
    } });
    expect(result.success, result.error).toBe(true);
    expect(result.value).toMatchObject({ manifest: { scope: { hidden: true }, truncated: false }, evidence: { complete: true, remaining: [] }, deferredCandidates: [] });
    const value = result.value as { evidence: { files: { path: string; source: string }[] } };
    expect(value.evidence.files.map(file => file.path)).toEqual(entrypoints ? ["README.md", ".azure-pipelines/test-pipeline.yml"] : []);
    if (entrypoints) expect(value.evidence.files[1]!.source).toBe("1: run: validate");
    expect(JSON.stringify(result.value)).not.toContain("DO-NOT-AUTOREAD");
    const projection = projectFabricExecutionText({ result, resultFormat: "auto", maxOutputChars: 50000, writeArtifact() { throw new Error("Unexpected spill"); } });
    expect(projection.overflowed).toBe(false);
    expect(JSON.parse(projection.text)).toEqual(result.value);
  });
});
