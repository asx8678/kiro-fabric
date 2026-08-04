import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import type { FabricConfig } from "../config.js";
import { FabricError } from "../errors.js";
import { filteredKiroEnv } from "../runners/kiro.js";
import {
  headlessPrompter,
  interactivePrompter,
  type ApprovalPrompter,
} from "../permissions.js";
import type { PermissionMode } from "../cli/args.js";

/**
 * Select the permission prompter for a run. Interactive execution (a
 * controlling TTY) enables human approval prompts for `ask` policies;
 * everything else (piped stdin, CI, foreign agent invocations) fails closed.
 */
export function resolvePrompter(mode: PermissionMode = "headless"): ApprovalPrompter {
  return mode === "interactive" ? interactivePrompter : headlessPrompter;
}

export interface RunEnvelope {
  version: 1;
  runId: string;
  status: "succeeded" | "failed";
  value?: unknown;
  metrics?: unknown;
  error?: { code: string; message: string; diagnostics?: unknown };
}

export interface ExecuteOptions {
  permissions?: PermissionMode;
  prompter?: ApprovalPrompter;
}

export async function executeProgram(
  body: string,
  config: FabricConfig,
  options: ExecuteOptions = {},
): Promise<{ envelope: RunEnvelope; exitCode: number }> {
  const runId = `run_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const dir = path.join(config.projectRoot, ".fabric-lite/runs", runId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "program.ts"), body);
  await writeFile(path.join(dir, "diagnostics.json"), "[]\n");
  await writeFile(path.join(dir, "calls.jsonl"), "");
  await writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify(
      {
        version: 1,
        runId,
        startedAt: new Date().toISOString(),
        programSha256: createHash("sha256").update(body).digest("hex"),
        budgets: config.budgets,
        permissions: config.permissions,
        runner: { type: config.runner.type, workerAgent: config.runner.workerAgent },
      },
      null,
      2,
    ),
  );
  const worker = fileURLToPath(new URL("./worker-entry.js", import.meta.url));
  const prompter = options.prompter ?? resolvePrompter(options.permissions ?? "headless");
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker], {
      cwd: config.projectRoot,
      env: filteredKiroEnv({
        FABRIC_LITE_RUN_DIR: dir,
        FABRIC_LITE_PROMPTER: options.prompter ? "headless" : (options.permissions ?? "headless"),
      }),
      detached: process.platform !== "win32",
      // The interactive permission prompter opens /dev/tty directly, so the
      // child can read approvals from the human controlling the CLI without
      // inheriting stdio. stdin remains piped to deliver the program payload.
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stderrForwarded = 0;
    let timedOut = false;
    const kill = () => {
      try {
        child.pid && process.platform !== "win32"
          ? process.kill(-child.pid, "SIGKILL")
          : child.kill("SIGKILL");
      } catch {
        // The process may already have exited.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, config.budgets.executionTimeoutMs);
    child.stdout.on("data", (c) => {
      stdout += String(c);
      if (stdout.length > config.output.maxFinalChars * 3 + 20000) kill();
    });
    child.stderr.on("data", (c) => {
      const text = String(c);
      stderr = (stderr + text).slice(-10000);
      const visible = text.slice(0, Math.max(0, 10000 - stderrForwarded));
      if (visible) {
        process.stderr.write(visible);
        stderrForwarded += visible.length;
      }
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new FabricError("TIMEOUT", `Execution timed out after ${config.budgets.executionTimeoutMs}ms`));
      let envelope: RunEnvelope;
      try {
        envelope = JSON.parse(stdout) as RunEnvelope;
      } catch {
        return reject(new FabricError("RUNTIME_FAILED", `Execution worker returned invalid output: ${stderr.slice(-1000)}`));
      }
      try {
        await writeFile(path.join(dir, "final.json"), JSON.stringify(envelope, null, 2));
      } catch (e) {
        return reject(e);
      }
      resolve({ envelope, exitCode: code ?? 1 });
    });
    child.stdin.end(JSON.stringify({ body, config, runId }));
  });
}