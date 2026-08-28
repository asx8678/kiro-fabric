const FABRIC_AGENT_RUNNERS = ["pi", "claude", "veda", "kiro"] as const;

export type FabricAgentRunner = (typeof FABRIC_AGENT_RUNNERS)[number];

const FABRIC_ACTOR_RUNNERS = ["pi", "claude", "kiro"] as const;

export type FabricActorRunner = (typeof FABRIC_ACTOR_RUNNERS)[number];

const unsupportedFabricAgentRunnerMessage = (value: unknown): string =>
  `Unsupported Fabric agent runner: ${String(value)}`;

const unsupportedFabricActorRunnerMessage = (value: unknown): string =>
  `Invalid Fabric actor runner: ${String(value)}`;

export const isFabricAgentRunner = (value: unknown): value is FabricAgentRunner =>
  typeof value === "string" &&
  (FABRIC_AGENT_RUNNERS as readonly string[]).includes(value);

export const isFabricActorRunner = (value: unknown): value is FabricActorRunner =>
  typeof value === "string" &&
  (FABRIC_ACTOR_RUNNERS as readonly string[]).includes(value);

export const parseFabricAgentRunner = (
  value: unknown,
  fallback?: FabricAgentRunner,
): FabricAgentRunner => {
  if (value === undefined) {
    if (fallback === undefined) {
      throw new Error(unsupportedFabricAgentRunnerMessage(value));
    }
    return fallback;
  }
  if (isFabricAgentRunner(value)) return value;
  throw new Error(unsupportedFabricAgentRunnerMessage(value));
};

export const parseFabricActorRunner = (
  value: unknown,
  fallback?: FabricActorRunner,
): FabricActorRunner => {
  if (value === undefined) {
    if (fallback === undefined) {
      throw new Error(unsupportedFabricActorRunnerMessage(value));
    }
    return fallback;
  }
  if (isFabricActorRunner(value)) return value;
  throw new Error(unsupportedFabricActorRunnerMessage(value));
};
