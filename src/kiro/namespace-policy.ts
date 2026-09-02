/**
 * Machine-readable owner for Kiro's model-visible namespace contract.
 *
 * Keep prose projections and executable examples derived from, or tested
 * against, this object. This is deliberately data rather than prompt text so
 * a permitted API cannot quietly become forbidden in another surface.
 */
export const KIRO_NAMESPACE_POLICY = {
  managedMain: {
    repositoryIo: {
      namespace: "k",
      always: ["read", "readArtifact", "grep", "find", "ls", "write", "edit"],
      conditional: ["bash"],
    },
    providerAccess: {
      namespace: "tools",
      actions: ["providers", "catalog", "search", "describe", "list", "call"],
    },
    conditionalProviders: {
      memory: ["get", "set", "search", "index"],
      mcp: ["servers", "call"],
      agents: [
        "run",
        "spawn",
        "wait",
        "status",
        "list",
        "models",
        "stop",
        "cleanup",
        "steer",
        "followUp",
        "setSteeringMode",
        "setFollowUpMode",
        "log",
      ],
    },
  },
  internalChild: {
    inheritedFromParent: ["k", "π"],
    parentOnly: ["tools", "memory", "mcp", "agents"],
    childOnly: [],
  },
  power: {
    always: ["tools", "π"],
    conditionalProviders: ["memory", "state", "mcp", "artifacts"],
    unavailable: ["k", "agents"],
  },
  forbiddenAlternateIo: [
    "pi",
    "tools.fs",
    "tools.shell",
    "tools.shell.exec",
  ],
  unavailableManagedGlobals: [
    "state",
    "schema",
    "mesh",
    "components",
    "compact",
    "extensions",
    "agent",
  ],
  promiseApis: [
    "k.read",
    "k.readArtifact",
    "k.grep",
    "k.find",
    "k.ls",
    "k.write",
    "k.edit",
    "k.bash",
    "tools.providers",
    "tools.catalog",
    "tools.search",
    "tools.describe",
    "tools.list",
    "tools.call",
    "memory.get",
    "memory.set",
    "memory.search",
    "memory.index",
    "mcp.servers",
    "mcp.call",
    "agents.run",
    "agents.spawn",
    "agents.wait",
    "agents.status",
    "agents.list",
    "agents.models",
    "agents.stop",
    "agents.cleanup",
    "agents.steer",
    "agents.followUp",
    "agents.setSteeringMode",
    "agents.setFollowUpMode",
    "agents.log",
  ],
} as const;

export const managedRepositoryCalls = (allowShell: boolean): string[] => [
  ...KIRO_NAMESPACE_POLICY.managedMain.repositoryIo.always,
  ...(allowShell
    ? KIRO_NAMESPACE_POLICY.managedMain.repositoryIo.conditional
    : []),
].map((action) =>
  `${KIRO_NAMESPACE_POLICY.managedMain.repositoryIo.namespace}.${action}`,
);

export const managedProviderCalls = (): string[] =>
  KIRO_NAMESPACE_POLICY.managedMain.providerAccess.actions.map((action) =>
    `${KIRO_NAMESPACE_POLICY.managedMain.providerAccess.namespace}.${action}`,
  );
