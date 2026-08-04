import { Console } from "node:console";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";
import { createApi } from "../api.js";
import type { FabricConfig } from "../config.js";
import { errorObject, exitCode, FabricError } from "../errors.js";
import { FakeAiRunner } from "../runners/fake.js";
import { KiroHeadlessRunner } from "../runners/kiro.js";
import { headlessPrompter, interactivePrompter, type ApprovalPrompter } from "../permissions.js";

function selectPrompter(): ApprovalPrompter {
  return process.env.FABRIC_LITE_PROMPTER === "interactive"
    ? interactivePrompter
    : headlessPrompter;
}

interface Payload {
  body: string;
  config: FabricConfig;
  runId: string;
  credentials?: Record<string, string | undefined>;
}

function validateReturnValue(value: unknown, ancestors: Set<object>): void {
  if (value === undefined)
    throw new FabricError("RUNTIME_FAILED", "Final result cannot be serialized: undefined value");
  if (typeof value === "bigint")
    throw new FabricError("RUNTIME_FAILED", "Final result cannot be serialized: bigint value");
  if (typeof value === "number" && !Number.isFinite(value))
    throw new FabricError("RUNTIME_FAILED", "Final result cannot be serialized: non-finite number");
  if (typeof value === "function" || typeof value === "symbol")
    throw new FabricError("RUNTIME_FAILED", "Final result cannot be serialized: unsupported value");
  if (typeof value !== "object" || value === null) return;
  if (ancestors.has(value))
    throw new FabricError("RUNTIME_FAILED", "Final result cannot be serialized: cyclic value");
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) validateReturnValue(value[index], ancestors);
  } else {
    for (const key of Object.keys(value))
      validateReturnValue((value as Record<string, unknown>)[key], ancestors);
  }
  ancestors.delete(value);
}

function serializeReturnValue(value: unknown): unknown {
  validateReturnValue(value, new Set<object>());
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined)
      throw new FabricError("RUNTIME_FAILED", "Final result cannot be serialized: undefined value");
    return JSON.parse(serialized) as unknown;
  } catch (error) {
    if (error instanceof FabricError) throw error;
    throw new FabricError(
      "RUNTIME_FAILED",
      `Final result serialization failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Preserve the beginning and end of an oversized value with an explicit
 * omission marker, mirroring pi-fabric's truncateMiddle in output-budget.ts.
 */
function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  const marker = `\n\n[... ${omitted} chars omitted ...]\n\n`;
  const budget = Math.max(1, maxChars - marker.length);
  const head = Math.ceil(budget / 2);
  const tail = Math.floor(budget / 2);
  return `${text.slice(0, head)}${marker}${text.slice(text.length - tail)}`;
}

/**
 * Bound the final value like pi-fabric's boundModelOutput: oversized results
 * are truncated with omission markers instead of failing the run, and the
 * complete value is preserved in a mode-0600 artifact inside the run directory.
 */
async function boundFinalValue(
  serialized: string,
  maxChars: number,
): Promise<{ value: unknown; truncated: boolean; originalChars: number; omittedChars: number }> {
  if (serialized.length <= maxChars) {
    return {
      value: JSON.parse(serialized),
      truncated: false,
      originalChars: serialized.length,
      omittedChars: 0,
    };
  }
  let suffix: string;
  const runDir = process.env.FABRIC_LITE_RUN_DIR;
  if (runDir) {
    const artifactPath = path.join(runDir, "final-value.json");
    await writeFile(artifactPath, serialized, { encoding: "utf8", mode: 0o600 });
    suffix = `\n\n[Full output (${serialized.length} chars) saved to: ${artifactPath}]`;
  } else {
    suffix = `\n\n[Full output (${serialized.length} chars) omitted]`;
  }
  const text = `${truncateMiddle(serialized, Math.max(1, maxChars - suffix.length))}${suffix}`;
  return {
    value: text.length <= maxChars ? text : truncateMiddle(text, maxChars),
    truncated: true,
    originalChars: serialized.length,
    omittedChars: Math.max(
      0,
      serialized.length - Math.min(serialized.length, maxChars - suffix.length),
    ),
  };
}

// stdout is a protocol channel. Route guest diagnostics (including direct writes) to stderr.
const writeEnvelope = process.stdout.write.bind(process.stdout);
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;

let input = "";
for await (const chunk of process.stdin) input += String(chunk);
let payload: Payload | undefined;

try {
  payload = JSON.parse(input) as Payload;
  const creds = payload.credentials ?? (process.env as Record<string, string | undefined>);
  const runner =
    payload.config.runner.type === "fake"
      ? new FakeAiRunner()
      : new KiroHeadlessRunner(
          payload.config.runner.executable,
          payload.config.runner.workerAgent,
          creds,
        );
  const { fabric, metrics } = createApi(payload.config, runner, { prompter: selectPrompter() });
  const wrapped = `globalThis.__fabricMain = async function(fabric) {\n${payload.body}\n};`;
  const js = ts.transpileModule(wrapped, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  vm.runInThisContext(js, { filename: "fabric-program.js" });
  const fn = (
    globalThis as typeof globalThis & {
      __fabricMain?: (fabric: unknown) => Promise<unknown>;
    }
  ).__fabricMain;
  if (!fn) throw new Error("Program compilation failed");

  const started = Date.now();
  const value = await fn(fabric);
  const safeValue = serializeReturnValue(value);
  const safeSerialized = JSON.stringify(safeValue);
  if (safeSerialized === undefined)
    throw new FabricError("RUNTIME_FAILED", "Final result cannot be serialized: undefined value");
  const bounded = await boundFinalValue(safeSerialized, payload.config.output.maxFinalChars);
  writeEnvelope(
    JSON.stringify({
      version: 1,
      runId: payload.runId,
      status: "succeeded",
      value: bounded.value,
      ...(bounded.truncated
        ? {
            truncated: true,
            originalChars: bounded.originalChars,
            omittedChars: bounded.omittedChars,
          }
        : {}),
      ...(payload.config.output.includeMetrics
        ? { metrics: { elapsedMs: Date.now() - started, ...metrics } }
        : {}),
    }),
  );
} catch (error) {
  writeEnvelope(
    JSON.stringify({
      version: 1,
      runId: payload?.runId ?? "unknown",
      status: "failed",
      error: errorObject(error),
    }),
  );
  process.exitCode = error instanceof FabricError ? exitCode(error.code) : 1;
}
