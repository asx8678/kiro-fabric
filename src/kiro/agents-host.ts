// ACP-backed child-agent provider for the standalone managed Kiro runtime.
//
// Kiro Main has no Pi session, mesh, actor registry, or lifecycle broker. It
// can still own one-shot agents because KiroAgentManager drives an
// isolated `kiro-cli acp` process through src/kiro/acp-worker.ts. Keep this
// provider deliberately smaller than AgentsProvider: only manager-local
// one-shot operations are advertised, so unsupported mesh/actor APIs never
// appear discoverable.

import { fileURLToPath } from "node:url";
import { isAbsolute, relative, sep } from "node:path";
import type { FabricAgentConfig } from "../config.js";
import { KiroAgentManager } from "./agent-manager.js";
import type {
  KiroAgentRunRequest as AgentRunRequest,
  KiroAgentRunResult as AgentRunResult,
} from "./agent-types.js";
import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderListRequest,
} from "../protocol.js";
import { KIRO_AGENT_ACTION_DESCRIPTORS } from "./agent-actions.js";
import { actionArgNormalizer } from "../providers/arg-normalization.js";
import { isFabricThinking } from "../thinking.js";
import { resolveKiroProjectRoot } from "./managed.js";
import {
  KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS,
  KIRO_SEMANTIC_CONTEXT_MAX_ITEMS,
  KIRO_SEMANTIC_CONTEXT_MAX_OBJECTIVE_CHARS,
  normalizeKiroSemanticContext,
} from "./handoff.js";
import { listKiroModels } from "./model-inventory.js";
import { resolveKiroTaskRoute } from "./model-router.js";
import type { KiroChildTool } from "./run-scope.js";

const DEFAULT_WORKER_PATH = fileURLToPath(new URL("./agent-worker-entry.js", import.meta.url));

const KIRO_PORTABLE_TOOLS = new Set<KiroChildTool>([
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
]);

const normalizeKiroAgentArgs = actionArgNormalizer(
  () => KIRO_AGENT_ACTION_DESCRIPTORS,
);

const isTransport = (value: unknown): value is "auto" | "process" =>
  value === "auto" || value === "process";

const stringArray = (value: unknown, label: string): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value as string[];
};

const isWithinOrEqual = (root: string, candidate: string): boolean => {
  const child = relative(root, candidate);
  return child === "" || child === "." || (
    !isAbsolute(child) && !child.startsWith(`..${sep}`) && child !== ".."
  );
};

const progressLabel = (status: ReturnType<KiroAgentManager["status"]>): string => {
  const currentTool = "currentTool" in status && status.currentTool
    ? ` · ${status.currentTool}`
    : "";
  return `Agent ${status.name}: ${status.status}${currentTool}`;
};

export interface KiroAgentManagerOptions {
  cwd: string;
  config: FabricAgentConfig;
  workerPath?: string;
  runRoot?: string;
  kiroBinary?: string;
  /** Known inventory override for tests/embedded hosts; normal hosts probe Kiro. */
  availableModelIds?: readonly string[];
}

/** Create a manager whose implicit execution harness is always Kiro ACP. */
const createKiroAgentManager = (
  options: KiroAgentManagerOptions,
): KiroAgentManager => {
  const cwd = resolveKiroProjectRoot(options.cwd);
  const defaultTools = options.config.defaultTools.filter(
    (tool): tool is KiroChildTool => KIRO_PORTABLE_TOOLS.has(tool as KiroChildTool),
  );
  return new KiroAgentManager(cwd, {
    ...options.config,
    runner: "kiro",
    defaultTools,
  }, {
    workerPath: options.workerPath ?? DEFAULT_WORKER_PATH,
    ...(options.runRoot ? { runRoot: options.runRoot } : {}),
    projectRoot: cwd,
    ...(options.kiroBinary ? { kiroBinary: options.kiroBinary } : {}),
  });
};

export class KiroAgentsProvider implements FabricProvider {
  readonly name = "agents";
  readonly description =
    "Up to four scoped, non-recursive Kiro CLI ACP children with trusted-shell verification";

  constructor(
    readonly manager: KiroAgentManager,
    readonly availableModelIds?: readonly string[],
  ) {}

  async list(request: FabricProviderListRequest): Promise<FabricActionDescriptor[]> {
    const query = request.query?.toLowerCase();
    const listed = query
      ? KIRO_AGENT_ACTION_DESCRIPTORS.filter((descriptor) =>
          `${descriptor.name} ${descriptor.description}`.toLowerCase().includes(query),
        )
      : KIRO_AGENT_ACTION_DESCRIPTORS;
    return request.limit === undefined ? listed : listed.slice(0, request.limit);
  }

  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> {
    return KIRO_AGENT_ACTION_DESCRIPTORS.find(
      (descriptor) => descriptor.name === actionName,
    );
  }

  prepareArguments(
    actionName: string,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    return normalizeKiroAgentArgs(actionName, args);
  }

  async #wait(id: string, context: FabricInvocationContext): Promise<AgentRunResult> {
    const pending = this.manager.wait(id);
    let previous = "";
    const report = (): void => {
      try {
        const message = progressLabel(this.manager.status(id));
        if (message === previous) return;
        previous = message;
        context.update(message);
      } catch {
        // A concurrent cleanup may remove a terminal run between polls.
      }
    };
    report();
    const timer = setInterval(report, 500);
    timer.unref?.();
    try {
      return await pending;
    } finally {
      clearInterval(timer);
      report();
    }
  }

  async #request(args: Record<string, unknown>, oneShot = false): Promise<AgentRunRequest> {
    if (args.runner !== undefined && args.runner !== "kiro") {
      throw new Error(
        `Managed Kiro can spawn only ACP-backed Kiro agents; received runner ${JSON.stringify(args.runner)}`,
      );
    }
    if (args.residency === "durable") {
      throw new Error(
        "Managed Kiro supports session-local ACP children only; durable residency is unavailable",
      );
    }
    if (args.recursive === true) {
      throw new Error("Kiro ACP children cannot recursively spawn Fabric agents");
    }
    if (args.worktree === true) {
      throw new Error(
        "Managed Kiro ACP spawning does not support worktree creation; launch Kiro from the intended worktree instead",
      );
    }

    const task = typeof args.task === "string" ? args.task : "";
    if (!task.trim()) throw new Error("Agent task must not be empty");

    let cwd: string | undefined;
    if (typeof args.cwd === "string") {
      cwd = this.manager.resolveCwd(args.cwd);
      if (!isWithinOrEqual(this.manager.cwd, cwd)) {
        throw new Error(
          "Managed Kiro ACP child cwd must stay within the directory where kiro-cli was launched",
        );
      }
    }

    const tools = stringArray(args.tools, "Kiro child tools");
    const transport = isTransport(args.transport) ? args.transport : undefined;
    const explicitThinking = isFabricThinking(args.thinking) ? args.thinking : undefined;
    const requestedModel = typeof args.model === "string" ? args.model.trim() : undefined;
    const explicitlyAuto = requestedModel?.toLowerCase() === "auto";
    // Explicit model choices bypass automatic model routing. `auto` bypasses
    // both model and effort selection entirely so Kiro picks by task;
    // explicit thinking always overrides a routed default.
    const route = requestedModel ? undefined : resolveKiroTaskRoute(task);
    // Model discovery is an explicit agents.models operation. Do not add a
    // version/model-list subprocess to the first agent launch merely to apply
    // an optional route; without a known inventory, defer model and effort to
    // Kiro's native auto selection.
    const routedModelAvailable = !route?.model || (
      this.availableModelIds !== undefined && new Set(this.availableModelIds).has(route.model)
    );
    const useKiroAuto = explicitlyAuto || !routedModelAvailable;
    const model = useKiroAuto ? undefined : requestedModel || route?.model;
    const thinking = explicitThinking ?? (useKiroAuto ? undefined : route?.thinking);
    const schema =
      typeof args.schema === "object" && args.schema !== null && !Array.isArray(args.schema)
        ? args.schema as Record<string, unknown>
        : undefined;
    const kiroContext = args.context === undefined
      ? undefined
      : normalizeKiroSemanticContext(args.context);

    return {
      task,
      runner: "kiro",
      ...(oneShot ? { kiroResidency: "one-shot" as const } : {}),
      ...(useKiroAuto ? { suppressThinkingDefault: true } : {}),
      ...(typeof args.name === "string" ? { name: args.name } : {}),
      ...(transport ? { transport } : {}),
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
      ...(tools ? { tools } : {}),
      ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {}),
      ...(cwd ? { cwd } : {}),
      ...(schema ? { schema } : {}),
      ...(kiroContext ? { kiroContext } : {}),
      residency: "session",
    };
  }

  async invoke(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<unknown> {
    switch (actionName) {
      case "run": {
        const handle = await this.manager.spawn(await this.#request(args, true), context.signal);
        context.activity?.({ type: "entity", id: handle.id, kind: "agent", name: handle.name });
        context.update(
          `Agent ${handle.name} started via kiro/${handle.transport} · model ${handle.model ?? "auto"}`,
        );
        return this.#wait(handle.id, context);
      }
      case "spawn": {
        const handle = await this.manager.spawn(await this.#request(args), context.signal);
        this.manager.detachSignal(handle.id);
        context.activity?.({ type: "entity", id: handle.id, kind: "agent", name: handle.name });
        context.update(
          `Agent ${handle.name} started via kiro/${handle.transport} · model ${handle.model ?? "auto"}`,
        );
        return handle;
      }
      case "wait": {
        const id = String(args.id);
        const status = this.manager.status(id);
        context.activity?.({ type: "entity", id, kind: "agent", name: status.name });
        return this.#wait(id, context);
      }
      case "status":
        return this.manager.status(String(args.id));
      case "list":
        return this.manager.list();
      case "models": {
        if (args.runner !== undefined && args.runner !== "kiro") {
          throw new Error("Managed Kiro exposes model selection only for the Kiro runner");
        }
        return this.#models(args.refresh === true);
      }
      case "stop":
        return this.manager.stop(String(args.id));
      case "cleanup":
        return this.manager.cleanup(String(args.id));
      case "steer":
        return this.manager.steer(String(args.id), String(args.message), args.data);
      case "followUp":
        return this.manager.followUp(String(args.id), String(args.message), args.data);
      case "setSteeringMode":
        return this.manager.setSteeringMode(
          String(args.id),
          args.mode === "all" ? "all" : "one-at-a-time",
        );
      case "setFollowUpMode":
        return this.manager.setFollowUpMode(
          String(args.id),
          args.mode === "all" ? "all" : "one-at-a-time",
        );
      case "log": {
        return this.manager.readLog(String(args.id), {
          ...(typeof args.lines === "number" ? { lines: args.lines } : {}),
          ...(typeof args.before === "number" ? { before: args.before } : {}),
        });
      }
      default:
        throw new Error(
          `agents.${actionName} is unavailable in managed Kiro; only session-local ACP child operations are mounted`,
        );
    }
  }

  async #models(refresh: boolean): Promise<unknown[]> {
    const binary = this.manager.kiroBinaryForDiscovery ?? "kiro-cli";
    return listKiroModels(binary, refresh);
  }

  async close(): Promise<void> {
    await this.manager.close();
  }
}

export const createKiroAgentsProvider = (
  options: KiroAgentManagerOptions,
): KiroAgentsProvider => new KiroAgentsProvider(
  createKiroAgentManager(options),
  options.availableModelIds,
);
