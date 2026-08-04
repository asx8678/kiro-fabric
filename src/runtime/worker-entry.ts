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
  const serialized = JSON.stringify(value);
  if (serialized.length > payload.config.output.maxFinalChars) {
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
      value,
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