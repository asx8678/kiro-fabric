import type { FabricAgentConfig } from "../config.js";

type KiroAccountingConfig = Pick<
  FabricAgentConfig,
  "runner" | "budgetUsd" | "maxTokensPerChild"
>;

export const kiroAccountingIncompatibility = (
  agents: KiroAccountingConfig,
  forceKiroRunner = false,
): string | undefined => {
  if (!forceKiroRunner && agents.runner !== "kiro") return undefined;
  const enabled = [
    ...(agents.budgetUsd > 0 ? ["agents.budgetUsd"] : []),
    ...(agents.maxTokensPerChild > 0 ? ["agents.maxTokensPerChild"] : []),
  ];
  return enabled.length === 0
    ? undefined
    : `Kiro ACP does not report usage and cannot enforce ${enabled.join(" or ")} > 0; set the listed ceilings to 0 or use a Pi, Claude, or Veda runner`;
};

export const assertKiroAccountingCompatible = (
  agents: KiroAccountingConfig,
  forceKiroRunner = false,
): void => {
  const message = kiroAccountingIncompatibility(agents, forceKiroRunner);
  if (message) throw new Error(message);
};
