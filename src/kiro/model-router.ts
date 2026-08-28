// Deterministic task-based model routing for managed Kiro ACP children.
// Explicit caller-selected models are handled by agents-host and bypass this
// policy. Returning undefined means "omit the session model override" and let Kiro use auto mode.
// Model values must match IDs advertised by `kiro-cli chat --list-models`;
// friendly aliases such as "haiku" or "opus" are not valid Kiro ACP model IDs.
//
// Every route pins both the model and the thinking effort. Omitting `thinking`
// here would silently inherit the Fabric-wide default (medium) through
// AgentManager, so cheap routes must opt into "low" explicitly.

import type { FabricThinking } from "../thinking.js";

const SMALL_MODEL = "claude-haiku-4.5";
const CODE_MODEL = "qwen3-coder-next";
const COMPLEX_MODEL = "claude-opus-4.8";

const SMALL_THINKING: FabricThinking = "low";
const CODE_THINKING: FabricThinking = "low";
const COMPLEX_THINKING: FabricThinking = "medium";
const DEFAULT_MODEL = "claude-opus-4.8";
const DEFAULT_THINKING: FabricThinking = "medium";

export interface KiroTaskRoute {
  readonly model?: string;
  readonly thinking?: FabricThinking;
}

const MAX_CLASSIFIED_TASK_CHARS = 8_000;
const SMALL_TASK_MAX_CHARS = 280;
const SIMPLE_TASK_MAX_CHARS = 500;
const COMPLEX_TASK_MIN_CHARS = 1_200;

const CHEAP_EDIT_HINT =
  /\b(typo|spelling|punctuation|whitespace|copy[- ]?edit|rename|reformat)\b/iu;

const CODE_HINT =
  /\b(api|bug|build|class|code|codebase|compile|component|database|debug|dependency|edit|endpoint|error|fix|function|implement|implementation|lint|method|module|package|parse|parser|patch|query|refactor|repository|rewrite|schema|script|spec|test|typecheck)\b|\b(?:src|tests?|lib|packages?)\/|\b[\w./-]+\.(?:c|cc|cpp|css|go|html|java|js|jsx|json|md|mjs|py|rs|sh|sql|ts|tsx|yaml|yml)\b/iu;

const IMPLEMENTATION_HINT =
  /\b(build|code|debug|edit|fix|implement|implementation|patch|refactor|rewrite|test)\b/iu;

const COMPLEX_HINT =
  /\b(architect|architecture|audit|comprehensive|concurrency|deep[- ]?review|design|distributed|investigate|migration|optimi[sz]e|performance|race condition|root cause|security|strategy|threat model|trade[- ]?offs?)\b/iu;

// Read-only analysis that is harder than a lookup but easier than a redesign.
// "review src/x.ts" must not collapse into the coding model just because a
// source path appears; these words mark judgment work, not edits.
const REVIEW_HINT =
  /\b(review|analyze|analysis|analy[sz]e|assess|inspect|evaluate|examine|verify|verification|diagnose|explain why|justify)\b/iu;

const SIMPLE_HINT =
  /\b(count|describe|explain|find|list|locate|read|reword|show|summari[sz]e|translate)\b/iu;

// Short prompts that are small in bytes but heavy in reasoning. Keep this
// list narrow: cheap routing still wins for genuinely mechanical asks.
const REASONING_DENSITY_HINT =
  /\b(linearizable|correctness proof|prove|invariant|invariants|deadlock|livelock|data race|use[- ]after[- ]free|memory safety|cryptograph|protocol flaw|soundness|byzantine|formal|exploit|cve-)\b/iu;

const normalizeTask = (task: string): string =>
  task
    .slice(0, MAX_CLASSIFIED_TASK_CHARS)
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

const stepCount = (task: string): number =>
  (task.match(/(?:^|\n)\s*(?:[-*]|\d+[.)])\s+/gu) ?? []).length;

/**
 * Select the model and reasoning effort for a managed Kiro child task.
 *
 * - short/trivial mechanical work -> Claude Haiku 4.5, low effort
 * - code implementation/debugging/testing -> Qwen3 Coder Next, low effort
 * - architecture/security/deep analysis and mixed critical work ->
 *   Claude Opus 4.8, medium effort
 * - ambiguous/unclassified work -> Claude Opus 4.5, medium effort
 */
export const resolveKiroTaskRoute = (task: string): KiroTaskRoute => {
  const rawTask = task.slice(0, MAX_CLASSIFIED_TASK_CHARS);
  const normalized = normalizeTask(rawTask);
  if (!normalized) return {};

  const isSmall = normalized.length <= SMALL_TASK_MAX_CHARS;
  const isCheapEdit = CHEAP_EDIT_HINT.test(normalized);
  const isCode = CODE_HINT.test(normalized);
  const isImplementation = IMPLEMENTATION_HINT.test(normalized);
  const isReview = REVIEW_HINT.test(normalized);
  const isReasoningDense = REASONING_DENSITY_HINT.test(normalized);
  const isComplex =
    COMPLEX_HINT.test(normalized) ||
    isReview ||
    isReasoningDense ||
    normalized.length >= COMPLEX_TASK_MIN_CHARS ||
    stepCount(rawTask) >= 3;

  // Tiny mechanical edits should stay cheap even when they name a source file.
  if (isSmall && isCheapEdit && !isComplex) {
    return { model: SMALL_MODEL, thinking: SMALL_THINKING };
  }

  // Review/analysis of code is judgment work even when it mentions a file; it
  // must not demote to the coding specialist just for naming src/x.ts.
  if (isComplex && !isImplementation) {
    return { model: COMPLEX_MODEL, thinking: COMPLEX_THINKING };
  }

  // Mixed critical implementation (security/concurrency/correctness-sensitive
  // coding) keeps the capable model: dropping to the coding specialist because
  // an "implement" verb appeared erases the reasoning signal that mattered.
  if (isImplementation && (isReasoningDense || COMPLEX_HINT.test(normalized))) {
    return { model: COMPLEX_MODEL, thinking: COMPLEX_THINKING };
  }

  if (isCode) return { model: CODE_MODEL, thinking: CODE_THINKING };
  if (isComplex) return { model: COMPLEX_MODEL, thinking: COMPLEX_THINKING };

  // Short tasks and moderately sized read-only lookups use the fast model.
  if (
    isSmall ||
    (normalized.length <= SIMPLE_TASK_MAX_CHARS && SIMPLE_HINT.test(normalized))
  ) {
    return { model: SMALL_MODEL, thinking: SMALL_THINKING };
  }

  // Ambiguous / medium / unclassified tasks get Opus 4.8 at medium effort rather
  // than punting entirely to Kiro auto, balancing capability with latency and
  // credit usage for unclear or underspecified work.
  return { model: DEFAULT_MODEL, thinking: DEFAULT_THINKING };
};

/** Backward-compatible model-only view of the task route. */
export const resolveKiroTaskModel = (task: string): string | undefined =>
  resolveKiroTaskRoute(task).model;
