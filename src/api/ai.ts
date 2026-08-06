import { FabricError } from "../errors.js";
import type { FabricLiteApi } from "../../types/fabric-lite.js";
import type { AiRunner, NormalizedAiRequest } from "../runners/types.js";
import type { CacheEntry } from "../cache.js";
import { parseFramed } from "../runners/parser.js";
import { repairFramedOutput } from "../runners/repair.js";
import { compressContextText } from "./compress.js";
import { RequestRedactor } from "../redaction.js";
import { loadPrompt } from "../prompts.js";
import {
  argumentRecord,
  formatContext,
  invalidArguments,
  isArgumentRecord,
  requiredString,
} from "./args.js";
import type { AiResult } from "./budget.js";
import type { AiRunFn, ApiContext } from "./context.js";

export function createAiApi(ctx: ApiContext): { ai: FabricLiteApi["ai"]; aiRun: AiRunFn } {
  const { config, runner, budgets, cache } = ctx;
  async function aiRun<T = unknown>(input: any, signal?: AbortSignal): Promise<AiResult<T>> {
    const request = argumentRecord("fabric.ai.run", input) as any;
    const instruction = requiredString("fabric.ai.run", request.instruction, "instruction");
    const role = request.role ?? "worker";
    if (role !== "planner" && role !== "worker" && role !== "verifier" && role !== "general")
      invalidArguments("fabric.ai.run", "role must be planner, worker, verifier, or general");
    if (request.model !== undefined && typeof request.model !== "string")
      invalidArguments("fabric.ai.run", "model must be a string");
    if (
      request.label !== undefined &&
      (typeof request.label !== "string" ||
        request.label.length === 0 ||
        request.label.length > 120 ||
        /[\r\n]/.test(request.label))
    )
      invalidArguments(
        "fabric.ai.run",
        "label must be a single-line string of at most 120 characters",
      );
    const label = typeof request.label === "string" ? request.label : undefined;
    if (request.compressContext !== undefined && typeof request.compressContext !== "boolean")
      invalidArguments("fabric.ai.run", "compressContext must be a boolean");
    const redactor = new RequestRedactor(),
      rawContext = redactor.redact(
        typeof request.context === "string" ? request.context : formatContext(request.context),
      ),
      safeInstruction = redactor.redact(instruction),
      schema = request.outputSchema
        ? redactor.value(request.outputSchema as Record<string, unknown>)
        : undefined;
    const contextCap = Math.min(
      request.maxInputChars ?? config.budgets.maxContextCharsPerCall,
      config.budgets.maxContextCharsPerCall,
    );
    // Opt-in deterministic compression (pi-vcc style): shrink over-budget
    // contexts by extraction instead of failing the call outright.
    let compressed = false;
    let context = rawContext;
    if (context.length > contextCap) {
      if (request.compressContext !== true)
        throw new FabricError(
          "BUDGET_EXCEEDED",
          `AI context character budget exceeded (${context.length} > ${contextCap})`,
        );
      context = compressContextText(context, contextCap);
      compressed = true;
    }
    const schemaText = JSON.stringify(schema ?? {}),
      inputChars = safeInstruction.length + context.length + schemaText.length;
    const requestedModel =
      request.model !== undefined ? request.model : (config.runner.defaultModel ?? undefined);
    const normalized: NormalizedAiRequest = {
      instruction: safeInstruction,
      context,
      role,
      maxOutputChars: Math.min(
        request.maxOutputChars ??
          (role === "verifier"
            ? config.budgets.maxOutputCharsVerifier
            : config.budgets.maxOutputCharsPerWorker),
        role === "verifier"
          ? config.budgets.maxOutputCharsVerifier
          : config.budgets.maxOutputCharsPerWorker,
      ),
      timeoutMs: Math.max(
        request.timeoutMs ?? config.budgets.aiCallTimeoutMs,
        config.budgets.aiCallTimeoutMs,
      ),
      ...(requestedModel !== undefined ? { model: requestedModel } : {}),
      ...(schema ? { schema } : {}),
    };
    const cached = await cache.get(normalized);
    if (cached) {
      budgets.cacheHit();
      return {
        value: cached.value as T,
        role,
        ...(cached.model ? { model: cached.model } : {}),
        ...(cached.requestedModel ? { requestedModel: cached.requestedModel } : {}),
        ...(cached.resolvedModel ? { resolvedModel: cached.resolvedModel } : {}),
        resolutionSource: cached.resolutionSource,
        inputChars: cached.inputChars,
        outputChars: cached.outputChars,
        repaired: false,
        ...(compressed ? { compressed: true } : {}),
        ...(label ? { label } : {}),
        cached: true,
      };
    }
    const cacheResult = async (result: AiResult<T>): Promise<AiResult<T>> => {
      const entry: CacheEntry = {
        value: result.value,
        ...(result.model ? { model: result.model } : {}),
        ...(result.requestedModel ? { requestedModel: result.requestedModel } : {}),
        ...(result.resolvedModel ? { resolvedModel: result.resolvedModel } : {}),
        resolutionSource: result.resolutionSource,
        inputChars: result.inputChars,
        outputChars: result.outputChars,
        storedAt: Date.now(),
      };
      await cache.set(normalized, entry);
      return result;
    };
    budgets.reserve(role, inputChars);
    let raw: Awaited<ReturnType<AiRunner["run"]>> | undefined;
    let safeStdout = "(unparseable output)";
    try {
      raw = await runner.run(normalized, signal);
      safeStdout = redactor.redact(raw.stdout);
      budgets.settle(inputChars, safeStdout.length, raw.usage);
      const value = redactor.value(
        parseFramed(safeStdout, normalized.schema, normalized.maxOutputChars) as T,
      );
      return await cacheResult({
        value,
        role,
        ...(raw.model ? { model: raw.model } : {}),
        ...(raw.requestedModel ? { requestedModel: raw.requestedModel } : {}),
        ...(raw.resolvedModel ? { resolvedModel: raw.resolvedModel } : {}),
        resolutionSource: raw.resolutionSource ?? "unknown",
        inputChars,
        outputChars: safeStdout.length,
        repaired: false,
        ...(compressed ? { compressed: true } : {}),
        ...(label ? { label } : {}),
      });
    } catch (e) {
      if (!(e instanceof FabricError) || e.code !== "INVALID_AI_OUTPUT") throw e;
      // Deterministic repair first (pi-tool-repair style): schema-guided fixes
      // and JSON salvage cost no LLM call and run even when paid retries are
      // disabled, saving both budget and latency.
      const deterministic = repairFramedOutput(
        safeStdout,
        normalized.schema,
        normalized.maxOutputChars,
      );
      if (deterministic) {
        return await cacheResult({
          value: redactor.value(deterministic.value as T),
          role,
          ...(raw?.model ? { model: raw.model } : {}),
          ...(raw?.requestedModel ? { requestedModel: raw.requestedModel } : {}),
          ...(raw?.resolvedModel ? { resolvedModel: raw.resolvedModel } : {}),
          resolutionSource: raw?.resolutionSource ?? "unknown",
          inputChars,
          outputChars: safeStdout.length,
          repaired: true,
          repairPath: "deterministic" as const,
          repairs: deterministic.repairs,
          ...(compressed ? { compressed: true } : {}),
          ...(label ? { label } : {}),
        });
      }
      if (request.retryInvalidJson === false || config.budgets.maxRetriesPerCall < 1) throw e;
      const bad = redactor.redact(
          raw?.stdout?.slice(-normalized.maxOutputChars) ?? "(unparseable output)",
        ),
        details = redactor.redact(JSON.stringify(e.details ?? [{ message: e.message }]));
      const repairInstruction = `${loadPrompt("repair-json").trimEnd()}\n\nINVALID:\n${bad}\nSCHEMA_ERRORS:\n${details}\nSCHEMA:\n${schemaText}`;
      const repair = { ...normalized, instruction: repairInstruction, context: "", repair: true },
        repairChars = repairInstruction.length + schemaText.length;
      budgets.reserve(role, repairChars, true);
      const fixed = await runner.run(repair, signal),
        safeFixed = redactor.redact(fixed.stdout);
      budgets.settle(repairChars, safeFixed.length, fixed.usage);
      let value: T;
      let repairRules: string[] = [];
      try {
        value = redactor.value(
          parseFramed(safeFixed, normalized.schema, normalized.maxOutputChars) as T,
        );
      } catch (parseError) {
        // Give the deterministic ladder a second chance on the repair output
        // before failing the call entirely.
        const salvaged = repairFramedOutput(
          safeFixed,
          normalized.schema,
          normalized.maxOutputChars,
        );
        if (!salvaged) throw parseError;
        value = redactor.value(salvaged.value as T);
        repairRules = salvaged.repairs;
      }
      return await cacheResult({
        value,
        role,
        ...(fixed.model ? { model: fixed.model } : {}),
        ...(fixed.requestedModel ? { requestedModel: fixed.requestedModel } : {}),
        ...(fixed.resolvedModel ? { resolvedModel: fixed.resolvedModel } : {}),
        resolutionSource: fixed.resolutionSource ?? "unknown",
        inputChars: inputChars + repairChars,
        outputChars: (raw?.stdout.length ?? 0) + safeFixed.length,
        repaired: true,
        repairPath: "llm" as const,
        ...(repairRules.length > 0 ? { repairs: repairRules } : {}),
        ...(compressed ? { compressed: true } : {}),
        ...(label ? { label } : {}),
      });
    }
  }
  async function parallel<T = unknown>(input: any): Promise<AiResult<T>[]> {
    const request = argumentRecord("fabric.ai.parallel", input) as any;
    if (!Array.isArray(request.tasks))
      invalidArguments("fabric.ai.parallel", "tasks must be an array");
    const tasks = request.tasks as any[];
    if (tasks.some((task) => !isArgumentRecord(task)))
      invalidArguments("fabric.ai.parallel", "tasks must contain options objects");
    const concurrency = Math.min(
      request.concurrency ?? config.budgets.maxConcurrency,
      config.budgets.maxConcurrency,
    );
    if (concurrency < 1)
      throw new FabricError("BUDGET_EXCEEDED", "Concurrency must be at least one");
    const results = new Array(tasks.length),
      controller = new AbortController();
    let next = 0,
      failed: unknown;
    async function worker() {
      while (true) {
        if (failed && request.failFast) return;
        const i = next++;
        if (i >= tasks.length) return;
        try {
          results[i] = await aiRun(tasks[i], controller.signal);
        } catch (e) {
          if (request.failFast) {
            if (failed === undefined) {
              failed = e;
              controller.abort();
            }
            return;
          }
          results[i] = {
            value: undefined,
            role: tasks[i].role ?? "worker",
            ...(typeof tasks[i].label === "string" ? { label: tasks[i].label } : {}),
            resolutionSource: "unknown",
            inputChars: 0,
            outputChars: 0,
            repaired: false,
            error: {
              code: e instanceof FabricError ? e.code : "RUNTIME_FAILED",
              message: new RequestRedactor().redact(e instanceof Error ? e.message : String(e)),
              failedIndex: i,
            },
          };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
    if (failed) throw failed;
    return results as AiResult<T>[];
  }
  const ai = {
    run: aiRun,
    parallel,
    async map<TItem, TResult = unknown>(input: any): Promise<AiResult<TResult>[]> {
      const request = argumentRecord("fabric.ai.map", input) as any;
      if (!Array.isArray(request.items))
        invalidArguments("fabric.ai.map", "items must be an array");
      if (typeof request.createTask !== "function")
        invalidArguments("fabric.ai.map", "createTask must be a function");
      const items = (request.items as TItem[]).slice(0, request.maxItems ?? request.items.length);
      return parallel<TResult>({
        tasks: items.map(request.createTask),
        concurrency: request.concurrency,
      });
    },
  };
  return { ai, aiRun };
}
