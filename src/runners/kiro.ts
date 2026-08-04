import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { FabricError } from "../errors.js";
import { RequestRedactor, redactSensitive } from "../redaction.js";
import { framePrompt } from "./parser.js";
import type {
  AiRunner,
  ModelInfo,
  NormalizedAiRequest,
  RawAiRunnerResult,
  RunnerDoctorResult,
} from "./types.js";

const KIRO_ENV_KEYS = [
  "HOME",
  "PATH",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "KIRO_API_KEY",
  "KIRO_CLI_PATH",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_CONFIG_FILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_SDK_LOAD_CONFIG",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_ROLE_ARN",
] as const;

/** A value-preserving allowlist used for both the execution worker and Kiro itself. Never log this object. */
export function filteredKiroEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { NO_COLOR: "1", KIRO_LOG_NO_COLOR: "1" };
  for (const key of KIRO_ENV_KEYS) {
    if (process.env[key] !== undefined) out[key] = process.env[key];
  }
  return { ...out, ...extra };
}

interface ProcessOptions {
  timeoutMs: number;
  maxChars?: number;
  signal?: AbortSignal;
  cwd?: string;
}

export async function runProcess(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<RawAiRunnerResult> {
  return await new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: filteredKiroEnv(),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let exceeded: "stdout" | "stderr" | undefined;
    let timedOut = false;
    const cap = options.maxChars ?? 100_000;

    const kill = (): void => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // The process may already have exited.
      }
    };
    const add = (which: "stdout" | "stderr", chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      const current = which === "stdout" ? stdout : stderr;
      const remaining = Math.max(0, cap - current.length);
      if (which === "stdout") stdout += text.slice(0, remaining);
      else stderr += text.slice(0, remaining);
      if (text.length > remaining && !exceeded) {
        exceeded = which;
        kill();
      }
    };

    child.stdout.on("data", (chunk: Buffer) => add("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => add("stderr", chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    const onAbort = (): void => kill();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    child.on("error", (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (timedOut) {
        reject(new FabricError("TIMEOUT", `Process timed out after ${options.timeoutMs}ms`));
        return;
      }
      if (options.signal?.aborted) {
        reject(new FabricError("CANCELLED", "Operation cancelled"));
        return;
      }
      if (exceeded) {
        reject(
          new FabricError(
            "RUNTIME_FAILED",
            `Child process ${exceeded} limit of ${cap} characters exceeded`,
          ),
        );
        return;
      }
      resolve({
        stdout: redactSensitive(stdout),
        stderr: redactSensitive(stderr),
        exitCode: code ?? 1,
        elapsedMs: Date.now() - started,
        resolutionSource: "unknown",
      });
    });
  });
}

export class KiroHeadlessRunner implements AiRunner {
  readonly name = "kiro-headless";

  constructor(
    readonly executable = process.env.KIRO_CLI_PATH ?? "kiro-cli",
    readonly agent = "fabric-lite-worker",
  ) {}

  async doctor(): Promise<RunnerDoctorResult> {
    try {
      const result = await runProcess(this.executable, ["--version"], { timeoutMs: 10000 });
      return {
        ok: result.exitCode === 0,
        name: this.name,
        version: (result.stdout || result.stderr).trim().slice(0, 200),
      };
    } catch (error) {
      return { ok: false, name: this.name, message: (error as Error).message };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const result = await runProcess(
      this.executable,
      ["chat", "--list-models", "--format", "json"],
      { timeoutMs: 20000 },
    );
    if (result.exitCode !== 0) {
      throw new FabricError(
        "CONFIG_ERROR",
        `Kiro model enumeration failed (exit ${result.exitCode}): ${result.stderr.trim().slice(-500)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (error) {
      throw new FabricError(
        "CONFIG_ERROR",
        `Kiro model enumeration returned invalid JSON: ${(error as Error).message}; output: ${result.stdout.trim().slice(0, 300)}`,
      );
    }
    const list = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { models?: unknown }).models)
        ? (parsed as { models: unknown[] }).models
        : undefined;
    if (!list) {
      throw new FabricError(
        "CONFIG_ERROR",
        "Kiro model enumeration JSON must be an array or an object with a models array",
      );
    }

    return list.map((value: unknown) => {
      if (typeof value === "string") return { id: value };
      const item = value as {
        id?: unknown;
        name?: unknown;
        model_id?: unknown;
        model_name?: unknown;
        description?: unknown;
      };
      const id = item.id ?? item.model_id ?? item.name ?? item.model_name;
      if (typeof id !== "string") {
        throw new FabricError("CONFIG_ERROR", "Kiro returned an unrecognized model entry");
      }
      const name = item.name ?? item.model_name;
      return {
        id,
        ...(typeof name === "string" ? { name } : {}),
        ...(typeof item.description === "string" ? { description: item.description } : {}),
      };
    });
  }

  async run(request: NormalizedAiRequest, signal?: AbortSignal): Promise<RawAiRunnerResult> {
    const redactor = new RequestRedactor();
    const safeRequest: NormalizedAiRequest = {
      ...request,
      instruction: redactor.redact(request.instruction),
      context: redactor.redact(request.context),
      ...(request.schema ? { schema: redactor.value(request.schema) } : {}),
    };
    const args = ["chat", "--no-interactive", "--agent", this.agent];
    if (safeRequest.model) args.push("--model", safeRequest.model);
    // Kiro CLI 2.16 documents the prompt as positional chat [INPUT] and has
    // no stdin-prompt option. Keep using the documented argv form until a
    // version with tested stdin support is available.
    args.push(framePrompt(safeRequest));
    const raw = await runProcess(this.executable, args, {
      timeoutMs: safeRequest.timeoutMs,
      maxChars: safeRequest.maxOutputChars * 3 + 10000,
      ...(signal ? { signal } : {}),
    });

    // Kiro 2.16 exposes JSON for model listing, but not machine-readable resolution metadata for chat.
    const result: RawAiRunnerResult = {
      ...raw,
      stdout: redactor.redact(raw.stdout),
      stderr: redactor.redact(raw.stderr),
      ...(request.model ? { requestedModel: request.model, model: request.model } : {}),
      resolutionSource: "unknown",
    };
    if (process.env.FABRIC_LITE_RUN_DIR) {
      await appendFile(
        path.join(process.env.FABRIC_LITE_RUN_DIR, "calls.jsonl"),
        `${JSON.stringify({
          at: new Date().toISOString(),
          role: request.role,
          repair: request.repair ?? false,
          requestedModel: request.model ?? null,
          resolvedModel: result.resolvedModel ?? null,
          resolutionSource: result.resolutionSource,
          inputChars:
            safeRequest.instruction.length +
            safeRequest.context.length +
            JSON.stringify(safeRequest.schema ?? {}).length,
          outputChars: result.stdout.length,
          elapsedMs: result.elapsedMs,
          exitCode: result.exitCode,
          instructionSha256: createHash("sha256").update(safeRequest.instruction).digest("hex"),
        })}\n`,
      );
    }
    if (result.exitCode !== 0) {
      throw new FabricError(
        "RUNTIME_FAILED",
        `Kiro exited ${result.exitCode}: ${result.stderr.slice(-1000)}`,
      );
    }
    return result;
  }
}
