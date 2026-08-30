import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FabricPrewalkActivation } from "../config.js";
import type { FabricState } from "../fabric-state.js";
import {
  PREWALK_ARMED_MESSAGE_TYPE,
  hasPrewalkArmedPrompt,
  prewalkArmedPrompt,
} from "./handoff.js";
import {
  PREWALK_DECISION_ENTRY_TYPE,
  effectiveFabricPrewalkActivation,
  evaluateFabricPrewalkGate,
  type FabricPrewalkGateDecision,
} from "./gate.js";

// The single arm path shared by `/fabric prewalk` and automatic activation,
// so drift baseline, hidden armed advisory, and status chip remain aligned.
export const armFabricPrewalkSession = async (
  state: FabricState,
  context: ExtensionContext,
  pi: ExtensionAPI,
  input: {
    model: string;
    task?: string;
    automatic?: Exclude<FabricPrewalkActivation, "disabled">;
  },
): Promise<void> => {
  const { prewalk } = state.config;
  const sessionId = context.sessionManager.getSessionId();
  state.prewalk.arm({
    model: input.model,
    mode: prewalk.mode,
    sessionId,
    ...(input.task ? { task: input.task } : {}),
    ...(input.automatic ? { automatic: input.automatic } : {}),
    ...(prewalk.thinking ? { thinking: prewalk.thinking } : {}),
    alwaysRearm: input.automatic === "always" || effectiveFabricPrewalkActivation(prewalk) === "always",
  });
  if (prewalk.detectShellWrites) {
    await state.prewalkDrift.captureBaseline(sessionId, context.cwd);
  }
  const armedPrompt = prewalkArmedPrompt(prewalk.mode, input.model);
  if (!hasPrewalkArmedPrompt(context.sessionManager.getBranch(), armedPrompt)) {
    pi.sendMessage(
      {
        customType: PREWALK_ARMED_MESSAGE_TYPE,
        content: armedPrompt,
        display: false,
        details: {
          mode: prewalk.mode,
          model: input.model,
          ...(input.automatic ? { activation: input.automatic } : {}),
        },
      },
      { deliverAs: "nextTurn" },
    );
  }
  context.ui.setStatus("fabric-prewalk", `armed (${prewalk.mode}) → ${input.model}`);
};

interface FabricPrewalkAutoArmResult {
  decision: FabricPrewalkGateDecision;
  armed: boolean;
  skipReason?: string;
}

const recordDecision = (
  pi: ExtensionAPI,
  decision: FabricPrewalkGateDecision,
  result: { armed: boolean; skipReason?: string },
): void => {
  // Custom entries are durable benchmark telemetry but never enter model context.
  pi.appendEntry(PREWALK_DECISION_ENTRY_TYPE, {
    ...decision,
    armed: result.armed,
    ...(result.skipReason ? { skipReason: result.skipReason } : {}),
  });
};

/**
 * Evaluate and, when selected, arm automatic prewalk. Call without a task at
 * session start/reload (only `always` can arm), and with the final expanded
 * user prompt from `before_agent_start` so `gated` can decide deterministically.
 */
const selectAndAutoArmFabricPrewalk = async (
  state: FabricState,
  context: ExtensionContext,
  pi: ExtensionAPI,
  task?: string,
): Promise<FabricPrewalkAutoArmResult> => {
  const { prewalk } = state.config;
  const activation = effectiveFabricPrewalkActivation(prewalk);
  const decision = evaluateFabricPrewalkGate(activation, task);
  if (!decision.eligible) {
    const result = { decision, armed: false };
    // Disabled is the shipping no-op default: preserve sessions byte-for-byte.
    // Gated evaluations are the experiment telemetry worth persisting.
    if (activation !== "disabled") recordDecision(pi, decision, result);
    return result;
  }
  if (state.prewalk.status().state !== "idle") {
    const result = { decision, armed: false };
    recordDecision(pi, decision, { ...result, skipReason: "prewalk already armed" });
    return result;
  }
  let skipReason: string | undefined;
  if (!state.config.fullCodeMode || state.config.schema.mode === "enforce") {
    skipReason = "Fabric prewalk auto-arm skipped: requires full code mode with Schema enforce mode disabled.";
  } else if (prewalk.mode === "trajectory" && !state.config.agents.enabled) {
    skipReason = "Fabric prewalk auto-arm skipped: trajectory mode requires agents.enabled.";
  }
  const model = prewalk.model?.trim();
  if (!skipReason && (!model || !model.includes("/"))) {
    skipReason = "Fabric prewalk auto-arm skipped: set prewalk.model (provider/model) in /fabric settings so sessions arm without the interactive picker.";
  }
  if (skipReason) {
    const result = { decision, armed: false, skipReason };
    recordDecision(pi, decision, result);
    return result;
  }
  await armFabricPrewalkSession(state, context, pi, {
    model: model!,
    ...(task ? { task } : {}),
    automatic: activation === "always" ? "always" : "gated",
  });
  const result = { decision, armed: true };
  recordDecision(pi, decision, result);
  return result;
};

/** Backward-compatible startup API. Gated mode intentionally waits for a task. */
export const autoArmFabricPrewalk = async (
  state: FabricState,
  context: ExtensionContext,
  pi: ExtensionAPI,
  task?: string,
): Promise<string | undefined> =>
  (await selectAndAutoArmFabricPrewalk(state, context, pi, task)).skipReason;
