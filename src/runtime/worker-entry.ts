import { Console } from "node:console";
import ts from "typescript";
import vm from "node:vm";
import { createApi } from "../api.js";
import type { FabricConfig } from "../config.js";
import { errorObject, exitCode, FabricError } from "../errors.js";
import { FakeAiRunner } from "../runners/fake.js";
import { KiroHeadlessRunner } from "../runners/kiro.js";
import {
  headlessPrompter,
  interactivePrompter,
  type ApprovalPrompter,
} from "../permissions.js";

function selectPrompter(): ApprovalPrompter {
  return process.env.FABRIC_LITE_PROMPTER === "interactive" ? interactivePrompter : headlessPrompter;
}

interface Payload {
  body: string;
  config: FabricConfig;
  runId: string;
}

function validateReturnValue(value: unknown, ancestors: Set<object>): void {
  if (value === undefined) throw new FabricError("RUNTIME_FAILED", "Final result cannot be serialized: undefined value");
  if (typeof value === "bigint") throw new FabricError("RUNTIME_FAILED", "Final result cannot be serialized: bigint value");
  if (typeof value === "number" && !Number.isFinite(value)) throw new FabricError("RUNTIME_FAILED", "Final result cannot be serialized: non-finite number");
  if (typeof value === "function" || typeof value === "symbol") throw new FabricError("RUNTIME_FAILED", "Final result cannot be serialized: unsupported value");
  if (typeof value !== "object" || value === null) return;
  if (ancestors.has(value)) throw new FabricError("RUNTIME_FAILED", "Final result cannot be serialized: cyclic value");
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) validateReturnValue(value[index], ancestors);
  } else {
    for (const key of Object.keys(value)) validateReturnValue((value as Record<string, unknown>)[key], ancestors);
  }
  ancestors.delete(value);
}

function serializeReturnValue(value: unknown): unknown {
  validateReturnValue(value, new Set<object>());
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new FabricError("RUNTIME_FAILED", "Final result cannot be serialized: undefined value");
    return JSON.parse(serialized) as unknown;
  } catch (error) {
    if (error instanceof FabricError) throw error;
    throw new FabricError("RUNTIME_FAILED", `Final result serialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  const runner =
    payload.config.runner.type === "fake"
      ? new FakeAiRunner()
      : new KiroHeadlessRunner(
          payload.config.runner.executable,
          payload.config.runner.workerAgent,
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
  if (safeSerialized === undefined) throw new FabricError("RUNTIME_FAILED", "Final result cannot be serialized: undefined value");
  if (safeSerialized.length > payload.config.output.maxFinalChars) {
    throw new FabricError(
      "BUDGET_EXCEEDED",
      `Final result exceeds ${payload.config.output.maxFinalChars} characters`,
    );
  }
  writeEnvelope(
    JSON.stringify({
      version: 1,
      runId: payload.runId,
      status: "succeeded",
      value: safeValue,
      metrics: { elapsedMs: Date.now() - started, ...metrics },
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