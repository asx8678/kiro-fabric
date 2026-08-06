import path from "node:path";
import type { FabricConfig } from "./config.js";
import type { AiRunner } from "./runners/types.js";
import type { FabricLiteApi, Metrics } from "../types/fabric-lite.js";
export type { AiRunResult, FabricLiteApi, Metrics } from "../types/fabric-lite.js";
export type { AiResult } from "./api/budget.js";
export { estimateTokens } from "./api/budget.js";
import { PermissionGate, headlessPrompter, type ApprovalPrompter } from "./permissions.js";
import { AiCache } from "./cache.js";
import { FabricError } from "./errors.js";
import { BudgetState } from "./api/budget.js";
import type { ApiContext } from "./api/context.js";
import { createFsApi } from "./api/fs.js";
import { createGitApi } from "./api/git.js";
import { createInspectApi } from "./api/inspect.js";
import { createShellApi } from "./api/shell.js";
import { createAiApi } from "./api/ai.js";
import { createMutationApi } from "./api/mutation.js";
import { createContextApi } from "./api/repomap.js";
import { compressContextText } from "./api/compress.js";
import { toYaml } from "./api/yaml.js";

export function createApi(
  config: FabricConfig,
  runner: AiRunner,
  gateOptions?: { prompter?: ApprovalPrompter; payloads?: Record<string, string> },
): { fabric: FabricLiteApi; metrics: Metrics } {
  const root = path.resolve(config.projectRoot);
  const ctx: ApiContext = {
    config,
    root,
    runner,
    budgets: new BudgetState(config),
    cache: new AiCache(root, config),
    gate: new PermissionGate({
      policy: config.permissions,
      prompter: gateOptions?.prompter ?? headlessPrompter,
      allowedCommands: config.shell.allowedCommands,
      projectRoot: root,
    }),
    mutationSession: undefined,
    mutationWriteRequired: () => {
      if (config.mutation.enabled && !ctx.mutationSession) {
        throw new FabricError("POLICY_DENIED", "Mutation writes require fabric.mutate.begin first");
      }
      if (!ctx.mutationSession)
        throw new FabricError("RUNTIME_FAILED", "No active mutation session");
      return ctx.mutationSession;
    },
    recordMutationWrite: (session, target, existed) => {
      if (
        !session.createdFiles.has(target.relative) &&
        !session.modifiedFiles.has(target.relative)
      ) {
        (existed ? session.modifiedFiles : session.createdFiles).add(target.relative);
      }
    },
    aiRun: (() => {
      throw new FabricError("RUNTIME_FAILED", "fabric.ai is not initialized");
    }) as ApiContext["aiRun"],
  };
  const fs = createFsApi(ctx);
  const git = createGitApi(ctx);
  const inspect = createInspectApi(ctx);
  const shell = createShellApi(ctx);
  const { ai, aiRun } = createAiApi(ctx);
  ctx.aiRun = aiRun;
  const mutation = createMutationApi(ctx);
  const context = createContextApi(ctx);
  return {
    fabric: {
      fs,
      git,
      mutate: mutation,
      inspect,
      shell,
      ai,
      context,
      /** Named payloads delivered out-of-band (--payloads file): large text stays out of the checked program body. */
      payloads: Object.freeze({ ...(gateOptions?.payloads ?? {}) }),
      util: {
        chunk<T>(items: T[], size: number) {
          if (!Number.isInteger(size) || size < 1) throw new Error("chunk size must be positive");
          return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
            items.slice(i * size, (i + 1) * size),
          );
        },
        unique<T>(items: T[]) {
          return [...new Set(items)];
        },
        sortBy<T>(items: T[], selector: (x: T) => string | number) {
          return [...items].sort((a, b) => {
            const x = selector(a),
              y = selector(b);
            return x < y ? -1 : x > y ? 1 : 0;
          });
        },
        truncate(text: string, max: number) {
          return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)) + "…";
        },
        compactJson(value: unknown, max: number) {
          const s = JSON.stringify(value);
          return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…";
        },
        compressText(text: string, maxChars: number) {
          if (typeof text !== "string") throw new Error("compressText text must be a string");
          if (!Number.isInteger(maxChars) || maxChars < 1)
            throw new Error("compressText maxChars must be a positive integer");
          return compressContextText(text, maxChars);
        },
        toYaml(value: unknown, maxChars?: number) {
          const serialized = toYaml(value);
          if (maxChars === undefined) return serialized;
          if (!Number.isInteger(maxChars) || maxChars < 1)
            throw new Error("toYaml maxChars must be a positive integer");
          return serialized.length <= maxChars
            ? serialized
            : serialized.slice(0, Math.max(0, maxChars - 1)) + "…";
        },
      },
    },
    metrics: ctx.budgets.metrics,
  };
}
