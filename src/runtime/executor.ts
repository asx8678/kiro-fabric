import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import type { FabricConfig } from "../config.js";
import { FabricError } from "../errors.js";
import { filteredKiroEnv, workerEnv } from "../runners/kiro.js";
import type { PermissionMode } from "../cli/args.js";
import { formatCallEvent, formatRunStart } from "../cli/render.js";

export interface RunEnvelope {
  version: 1;
  runId: string;
  status: "succeeded" | "failed";
  value?: unknown;
  /** pi-fabric-style bounded output: value was middle-truncated, full value in the run-dir artifact. */
  truncated?: boolean;
  originalChars?: number;
  omittedChars?: number;
  metrics?: unknown;
  error?: { code: string; message: string; diagnostics?: unknown };
}

/**
 * Best-effort sweep of old run artifacts, matching pi-fabric's retention
 * model: run directories older than runRetentionMs are deleted on the next
 * run start, and maxRuns caps the total count regardless of age (0 disables
 * each bound). Failures never block a run.
 */
export async function sweepRunArtifacts(
  runsRoot: string,
  retention: { runRetentionMs: number; maxRuns: number },
  now = Date.now(),
): Promise<{ removed: number }> {
  if (retention.runRetentionMs <= 0 && retention.maxRuns <= 0) return { removed: 0 };
  let entries: string[];
  try {
    entries = (await readdir(runsRoot)).filter((entry) => entry.startsWith("run_"));
  } catch {
    return { removed: 0 };
  }
  const aged: Array<{ dir: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    try {
      const info = await stat(path.join(runsRoot, entry));
      if (info.isDirectory()) aged.push({ dir: entry, mtimeMs: info.mtimeMs });
    } catch {
      // A vanished or unreadable entry is ignored; the sweep is best-effort.
    }
  }
  aged.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const doomed = new Set<string>();
  if (retention.runRetentionMs > 0) {
    for (const entry of aged) {
      if (now - entry.mtimeMs > retention.runRetentionMs) doomed.add(entry.dir);
    }
  }
  if (retention.maxRuns > 0) {
    for (const entry of aged.slice(retention.maxRuns)) doomed.add(entry.dir);
  }
  let removed = 0;
  for (const dir of doomed) {
    try {
      await rm(path.join(runsRoot, dir), { recursive: true, force: true });
      removed++;
    } catch {
      // Best-effort: a locked or concurrently removed directory is skipped.
    }
  }
  return { removed };
}

export interface ExecuteOptions {
  permissions?: PermissionMode;
  progress?: boolean;
  /** Checker diagnostics to persist in the run directory. */
  diagnostics?: unknown[];
  /** Named payloads exposed to the program as fabric.payloads. */
  payloads?: Record<string, string>;
}

export async function executeProgram(
  body: string,
  config: FabricConfig,
  options: ExecuteOptions = {},
): Promise<{ envelope: RunEnvelope; exitCode: number }> {
  const runId = `run_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const runsRoot = path.join(config.projectRoot, ".fabric-lite/runs");
  const dir = path.join(runsRoot, runId);
  // 0700 so every run artifact (final.json, calls.jsonl, program.ts, ...) inherits
  // protection from other local users without per-file mode juggling.
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await sweepRunArtifacts(runsRoot, config.retention);
  await writeFile(path.join(dir, "program.ts"), body);
  await writeFile(
    path.join(dir, "diagnostics.json"),
    `${JSON.stringify(options.diagnostics ?? [], null, 2)}\n`,
  );
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
  // Cloud credentials are deliberately kept out of the worker process env so
  // guest programs (which share that env) cannot exfiltrate them; they are
  // delivered through the payload and reattached only for the Kiro child.
  const credentials = filteredKiroEnv({});
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker], {
      cwd: config.projectRoot,
      env: workerEnv({
        FABRIC_LITE_RUN_DIR: dir,
        FABRIC_LITE_PROMPTER: options.permissions ?? "headless",
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
    let callOffset = 0;
    let callPartial = "";
    let polling: Promise<void> | undefined;
    const callsPath = path.join(dir, "calls.jsonl");
    const emitCallLine = (line: string): void => {
      if (!line.trim()) return;
      try {
        process.stderr.write(
          `${formatCallEvent(JSON.parse(line) as { role?: string; repair?: boolean; inputChars?: number; outputChars?: number; elapsedMs?: number; exitCode?: number })}\n`,
        );
      } catch {
        // A malformed or incomplete event is ignored; the worker's envelope remains authoritative.
      }
    };
    const pollCalls = async (flush = false): Promise<void> => {
      if (polling) await polling;
      polling = (async () => {
        let contents: string;
        try {
          contents = await readFile(callsPath, "utf8");
        } catch {
          return;
        }
        if (contents.length < callOffset) callOffset = 0;
        callPartial += contents.slice(callOffset);
        callOffset = contents.length;
        const lines = callPartial.split("\n");
        callPartial = lines.pop() ?? "";
        for (const line of lines) emitCallLine(line);
        if (flush && callPartial.trim()) {
          emitCallLine(callPartial);
          callPartial = "";
        }
      })();
      try {
        await polling;
      } finally {
        polling = undefined;
      }
    };
    if (options.progress) {
      process.stderr.write(`${formatRunStart({ runId, body })}\n`);
    }
    const progressTimer = options.progress
      ? setInterval(() => {
          void pollCalls();
        }, 250)
      : undefined;
    const stopProgress = async (): Promise<void> => {
      if (progressTimer) clearInterval(progressTimer);
      if (options.progress) await pollCalls(true);
    };
    const kill = () => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
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
    child.on("error", async (error) => {
      clearTimeout(timer);
      await stopProgress();
      reject(error);
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      await stopProgress();
      if (timedOut)
        return reject(
          new FabricError(
            "TIMEOUT",
            `Execution timed out after ${config.budgets.executionTimeoutMs}ms`,
          ),
        );
      let envelope: RunEnvelope;
      try {
        envelope = JSON.parse(stdout) as RunEnvelope;
      } catch {
        return reject(
          new FabricError(
            "RUNTIME_FAILED",
            `Execution worker returned invalid output: ${stderr.slice(-1000)}`,
          ),
        );
      }
      try {
        await writeFile(path.join(dir, "final.json"), JSON.stringify(envelope, null, 2));
      } catch (e) {
        return reject(e);
      }
      resolve({ envelope, exitCode: code ?? 1 });
    });
    child.stdin.end(
      JSON.stringify({
        body,
        config,
        runId,
        credentials,
        ...(options.payloads ? { payloads: options.payloads } : {}),
      }),
    );
  });
}
