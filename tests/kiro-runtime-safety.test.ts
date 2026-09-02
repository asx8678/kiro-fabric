import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKiroRuntime, prepareKiroRuntime } from "../src/kiro/runtime.js";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.KIRO_FABRIC_ALLOW_SHELL;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const fixture = (name: string) => {
  const root = mkdtempSync(join(tmpdir(), `kiro-fabric-${name}-`));
  roots.push(root);
  const project = join(root, "project");
  const agentDir = join(root, "agent");
  mkdirSync(project);
  mkdirSync(agentDir);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  return { root, project, agentDir };
};

const execute = async (
  runtime: ReturnType<typeof createKiroRuntime>,
  code: string,
) => runtime.service.execute({
  code,
  signal: undefined,
  parentToolCallId: "kiro-approvals-test",
  host: runtime.host,
  onPartial() {},
});

describe("Kiro runtime security policy", () => {
  it("forces full code mode even when global configuration disables it", async () => {
    const { project, agentDir } = fixture("kiro-code-mode");
    writeFileSync(join(agentDir, "fabric.json"), JSON.stringify({ fullCodeMode: false }));
    const runtime = createKiroRuntime({ cwd: project });
    try {
      expect(runtime.service.config.fullCodeMode).toBe(true);
    } finally {
      await runtime.close();
    }
  });

  it("denies k.bash with untouched defaults when --allow-shell is absent", async () => {
    const { project } = fixture("kiro-deny");
    const runtime = await prepareKiroRuntime({ cwd: project });
    try {
      const result = await execute(
        runtime,
        'await k.bash({ command: "echo SHELL_BYPASS_CONFIRMED" }); return "ran";',
      );
      expect(result.success).toBe(false);
      expect(String(result.error ?? JSON.stringify(result.value)))
        .toMatch(/requires execute approval|denied|k\.bash/i);
    } finally {
      await runtime.close();
    }
  });

  it("allows k.bash only with the explicit trusted-local opt-in", async () => {
    const { project } = fixture("kiro-allow");
    const runtime = await prepareKiroRuntime({ cwd: project, allowExecute: true });
    try {
      const result = await execute(
        runtime,
        'const shell = await k.bash({ command: "echo kiro-ok" }); return shell.output;',
      );
      expect(result.success).toBe(true);
      expect(String(result.value)).toContain("kiro-ok");
    } finally {
      await runtime.close();
    }
  });

  it("does not expose the original pi namespace inside Kiro Fabric", async () => {
    const { project } = fixture("kiro-namespace");
    const runtime = await prepareKiroRuntime({ cwd: project });
    try {
      const result = await execute(runtime, 'return await pi.read({ path: "package.json" });');
      expect(result.success).toBe(false);
      expect(result.typeErrors?.map((error) => error.message).join("\n"))
        .toContain("Cannot find name 'pi'");
    } finally {
      await runtime.close();
    }
  });

  it("never loads cwd/fabric.json as global configuration", async () => {
    const { project } = fixture("kiro-agentdir");
    writeFileSync(join(project, "fabric.json"), JSON.stringify({
      executor: { timeoutMs: 1 },
      approvals: { execute: "allow" },
    }));
    const runtime = createKiroRuntime({ cwd: project });
    try {
      expect(runtime.service.config.executor.timeoutMs).toBe(120_000);
      expect(runtime.service.config.approvals.execute).toBe("deny");
      const result = await execute(
        runtime,
        'await k.bash({ command: "echo project-config-bypass" }); return "ran";',
      );
      expect(result.success).toBe(false);
    } finally {
      await runtime.close();
    }
  });
});
