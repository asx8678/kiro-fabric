// Host-neutral projection of a FabricExecutionResult into the model-facing
// text envelope. Extracted from the Pi tool adapter so the Kiro MCP adapter
// returns byte-compatible output; Pi-specific concerns (handoff, media blocks,
// usage, terminate) remain in the Pi adapter.

import { formatFabricValue } from "../ui/structured.js";
import { formatFailureProgress } from "../failure-progress.js";
import { modelOutputBudget, boundModelOutput } from "../output-budget.js";
import { typeErrorRecoveryHint } from "../type-error-guidance.js";
import type { FabricExecResultFormat } from "../kernel/fabric-exec-contract.js";
import {
  colorizeReturnedMutationDiffs,
  formatMutationDiffs,
} from "./mutation-diff.js";

export interface FabricExecTextProjection {
  text: string;
  isError: boolean;
}

export interface KiroProjectionTypeError {
  line: number;
  column: number;
  message: string;
}

/** Public, host-neutral result shape accepted by the Kiro text projector. */
export interface KiroProjectionExecutionResult {
  success: boolean;
  value: unknown;
  logs: string[];
  audits: unknown[];
  phases: string[];
  trace: unknown;
  elapsedMs: number;
  typeErrors?: KiroProjectionTypeError[];
  error?: string;
}

/** Kiro-only context cap; full Pi tool output keeps its configured budget. */
export const KIRO_MODEL_OUTPUT_MAX_CHARS = 16_000;

export const projectFabricExecutionText = async (options: {
  result: KiroProjectionExecutionResult;
  code: string;
  resultFormat: FabricExecResultFormat;
  maxOutputChars: number;
  /** Opaque artifact writer; Kiro supplies its process-local session store. */
  writeArtifact?: (content: string) => Promise<string>;
}): Promise<FabricExecTextProjection> => {
  const { result, code, resultFormat, maxOutputChars, writeArtifact } = options;
  const outputBudget = modelOutputBudget(
    Math.min(maxOutputChars, KIRO_MODEL_OUTPUT_MAX_CHARS),
    result.success,
  );

  if (result.typeErrors) {
    const text = result.typeErrors
      .map((error) =>
        error.line > 0
          ? `Line ${error.line}:${error.column} — ${error.message}`
          : error.message,
      )
      .join("\n");
    const recoveryHint = typeErrorRecoveryHint(code, result.typeErrors);
    const bounded = await boundModelOutput(
      `Type errors; code was not executed:\n${text}${
        recoveryHint ? `\n\n${recoveryHint}` : ""
      }`,
      outputBudget,
    );
    return { text: bounded.text, isError: true };
  }

  const formatted = formatFabricValue(result.value, resultFormat, outputBudget);
  const failureProgress = formatFailureProgress(
    result.trace as Parameters<typeof formatFailureProgress>[0],
  );
  const sections = [...result.logs];
  const visibleBeforeDiff = [...result.logs, formatted.text].filter(Boolean).join("\n\n");
  if (formatted.text) {
    sections.push(colorizeReturnedMutationDiffs(
      formatted.text,
      result.audits as Parameters<typeof colorizeReturnedMutationDiffs>[1],
    ));
  }
  const mutationDiffs = formatMutationDiffs(
    result.audits as Parameters<typeof formatMutationDiffs>[0],
    visibleBeforeDiff,
  );
  if (mutationDiffs) sections.push(`Changes:\n${mutationDiffs}`);
  if (result.error) sections.push(`Runtime error: ${result.error}`);
  if (failureProgress) sections.push(failureProgress);
  const rawOutput = sections.join("\n\n");

  const bounded = await boundModelOutput(
    rawOutput || "(no output)",
    outputBudget,
    rawOutput || "(no output)",
    writeArtifact,
  );
  return { text: bounded.text, isError: result.success ? false : true };
};
