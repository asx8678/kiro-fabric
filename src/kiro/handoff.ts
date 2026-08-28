import { sha256Bytes } from "./managed.js";
import { assertRunnerSessionId } from "./run-scope.js";
import {
  normalizeKiroSemanticContext,
  type KiroSemanticContextPacket,
} from "./agent-worker-options.js";
export {
  KIRO_SEMANTIC_CONTEXT_MAX_CHARS,
  KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS,
  KIRO_SEMANTIC_CONTEXT_MAX_ITEMS,
  KIRO_SEMANTIC_CONTEXT_MAX_OBJECTIVE_CHARS,
  normalizeKiroSemanticContext,
} from "./agent-worker-options.js";
export type { KiroSemanticContextPacket } from "./agent-worker-options.js";

export type KiroHandoffFidelity = "semantic" | "native" | "unavailable";

export interface KiroSemanticHandoffEnvelope {
  fidelity: "semantic";
  digest: string;
  when?: string;
  context?: KiroSemanticContextPacket;
}

export type KiroSemanticHandoffContext = Readonly<
  Record<string, unknown> & {
    runnerSessionId?: string;
  }
>;

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]);
    return Object.fromEntries(entries);
  }
  return value;
};

const semanticDigest = (value: unknown): string =>
  sha256Bytes(JSON.stringify(stableValue(value)));

const contextKeys = [
  "objective",
  "facts",
  "relevantFiles",
  "constraints",
  "exclusions",
] as const;

export const composeKiroSemanticHandoff = (
  context: KiroSemanticHandoffContext,
): KiroSemanticHandoffEnvelope => {
  const when =
    context.runnerSessionId === undefined
      ? undefined
      : assertRunnerSessionId(context.runnerSessionId, "handoff runnerSessionId");
  const semanticInput = Object.fromEntries(
    contextKeys.flatMap((key) => context[key] === undefined ? [] : [[key, context[key]]]),
  );
  const semanticContext = Object.keys(semanticInput).length > 0
    ? normalizeKiroSemanticContext(semanticInput)
    : undefined;
  const payload = {
    ...(when ? { when } : {}),
    ...(semanticContext ? { context: semanticContext } : {}),
  };
  return {
    fidelity: "semantic",
    digest: semanticDigest(payload),
    ...payload,
  };
};

export const handoffFidelityOf = (envelope: unknown): KiroHandoffFidelity => {
  if (!envelope || typeof envelope !== "object") return "unavailable";
  const fidelity = (envelope as { fidelity?: unknown }).fidelity;
  if (fidelity === "semantic" || fidelity === "native") return fidelity;
  return "unavailable";
};

export const isKiroSemanticHandoff = (
  envelope: unknown,
): envelope is KiroSemanticHandoffEnvelope => {
  if (
    handoffFidelityOf(envelope) !== "semantic" ||
    typeof (envelope as { digest?: unknown }).digest !== "string"
  ) {
    return false;
  }
  const candidate = envelope as { digest: string; when?: unknown; context?: unknown };
  if (!/^[a-f0-9]{64}$/.test(candidate.digest)) return false;
  let when: string | undefined;
  if (candidate.when !== undefined) {
    try {
      when = assertRunnerSessionId(candidate.when, "handoff runnerSessionId");
    } catch {
      return false;
    }
  }
  let context: KiroSemanticContextPacket | undefined;
  try {
    context = candidate.context === undefined
      ? undefined
      : normalizeKiroSemanticContext(candidate.context);
  } catch {
    return false;
  }
  return candidate.digest === semanticDigest({
    ...(when ? { when } : {}),
    ...(context ? { context } : {}),
  });
};
