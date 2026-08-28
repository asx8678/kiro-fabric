// Kiro v3 (KAS) does not accept the v2 ACP spawn-time --agent/--model/--effort
// flags. Fabric projects its managed agent onto the session wire, activates the
// injected mode, and applies session controls before the first prompt.

import type { KiroProfileDocument } from "./profile.js";

export const KIRO_V3_AGENT_MODE = "kiro-fabric" as const;

export interface KiroV3SessionParams {
  cwd: string;
  mcpServers: Array<{
    name: string;
    command: string;
    args: string[];
    env: Array<{ name: string; value: string }>;
    requestTimeout?: number;
  }>;
  _meta: {
    kiro: {
      customAgents: Array<{
        id: typeof KIRO_V3_AGENT_MODE;
        description: string;
        prompt: string;
        tools: string[];
        includeMcpJson: false;
        permissions?: KiroProfileDocument["permissions"];
      }>;
    };
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Build KAS's session-scoped custom-agent and MCP envelopes from the exact
 * profile Fabric generated for this run. Keeping these in one projection
 * prevents the on-disk profile and the v3 wire boundary from drifting.
 */
export const buildKiroV3SessionParams = (
  profile: KiroProfileDocument,
  cwd: string,
): KiroV3SessionParams => {
  if (profile.name !== KIRO_V3_AGENT_MODE) {
    throw new Error(`Kiro v3 profile must be named ${KIRO_V3_AGENT_MODE}`);
  }
  if (!profile.prompt.trim()) throw new Error("Kiro v3 custom agent prompt is empty");
  const servers = Object.entries(profile.mcpServers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, server]) => ({
      name,
      command: server.command,
      args: [...server.args],
      env: Object.entries(server.env)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([envName, value]) => ({ name: envName, value })),
      ...(server.requestTimeout !== undefined
        ? { requestTimeout: server.requestTimeout }
        : {}),
    }));
  if (servers.length !== 1 || servers[0]?.name !== "fabric") {
    throw new Error("Kiro v3 session must inject exactly the Fabric MCP server");
  }

  const customAgent = {
    id: KIRO_V3_AGENT_MODE,
    description: profile.description,
    prompt: profile.prompt,
    tools: [...profile.tools],
    includeMcpJson: false as const,
    ...(profile.permissions.rules.length > 0
      ? { permissions: structuredClone(profile.permissions) }
      : {}),
  };
  return {
    cwd,
    mcpServers: servers,
    _meta: { kiro: { customAgents: [customAgent] } },
  };
};
/** Require KAS to advertise the injected agent before Fabric activates it. */
export const assertKiroV3AgentModeAvailable = (sessionResult: unknown): void => {
  const result = isRecord(sessionResult) ? sessionResult : undefined;
  const modes = result && isRecord(result.modes) ? result.modes : undefined;
  const available = modes?.availableModes;
  if (!Array.isArray(available)) {
    throw new Error("Kiro v3 session did not advertise available agent modes");
  }
  const ids = available.flatMap((entry) =>
    isRecord(entry) && typeof entry.id === "string" ? [entry.id] : [],
  );
  if (!ids.includes(KIRO_V3_AGENT_MODE)) {
    throw new Error(
      `Kiro v3 did not register the injected ${KIRO_V3_AGENT_MODE} agent; refusing its broader default mode`,
    );
  }
};
