// Kiro v3 profile generation for the kiro-fabric MCP adapter. Dangerous
// managed grants are bound to the canonical project's filesystem identity.

import { managedPaths, type KiroManagedLayout } from "./managed.js";
import { KIRO_PROFILE_REQUEST_TIMEOUT_MS } from "./deadlines.js";
import { resolveKiroHome } from "./home.js";
import { resolveCanonicalKiroProjectRootIdentity } from "./project-root-identity.js";
import {
  KIRO_NAMESPACE_POLICY,
  managedProviderCalls,
  managedRepositoryCalls,
} from "./namespace-policy.js";
export const KIRO_CLI_VERSION = "2.20.1" as const;
export const KIRO_AGENT_ENGINE = "v3" as const;
export const KIRO_ACP_AUTH_METHOD = "cli" as const;

const KIRO_BINARY_ENV = "KIRO_FABRIC_KIRO_BINARY";
const KIRO_VERSION_ENV = "KIRO_FABRIC_KIRO_VERSION";
const KIRO_SHA256_ENV = "KIRO_FABRIC_KIRO_SHA256";

/** Covers the trusted-shell verification window plus adapter overhead. */
const KIRO_MCP_REQUEST_TIMEOUT_MS = KIRO_PROFILE_REQUEST_TIMEOUT_MS;

export interface KiroProfileOptions {
  /** Canonical install/fallback root; dangerous managed-main grants are confined beneath it. */
  projectRoot: string;
  /** Absolute path to the built MCP entry (dist/kiro/mcp-entry.js). */
  mcpEntryPath: string;
  /** Absolute node executable; defaults to process.execPath at generation. */
  nodePath?: string;
  /** Kiro config home; trusted project grants must never target this directory. */
  kiroHome?: string;
  /** Canonical, preflight-certified Kiro executable identity. */
  kiroBinaryPath?: string;
  /** Exact version observed from that executable during preflight. */
  kiroCliVersion?: string;
  /** Digest revalidated before every managed Kiro spawn. */
  kiroSha256?: string;
  /** Extra non-Fabric MCP environment. Reserved KIRO_FABRIC_* keys are rejected. */
  extraEnv?: Record<string, string>;
  /** Canonical environment reserved for an isolated internal child profile. */
  internalChild?: {
    cwd: string;
    serializedTools: string;
  };
  /** Trusted-local opt-in: permit execute-risk actions such as `k.bash`. */
  allowShell?: boolean;
  /**
   * Trusted-local opt-in: expose bounded, non-recursive Kiro ACP subagents.
   * Requires allowShell so delegated reviews can execute verification.
   */
  enableSubagents?: boolean;
  /** Trusted-local opt-in: auto-approve the single @fabric/fabric_exec tool. */
  allowTools?: boolean;
  /** Kiro skill resources installed and hash-owned by the managed main profile. */
  resources?: readonly string[];
  /** Aggregate digest of the exact managed skill bytes at those stable URIs. */
  skillBundleSha256?: string;
}

export interface KiroProfileDocument {
  name: string;
  description: string;
  prompt: string;
  mcpServers: Record<string, {
    command: string;
    args: string[];
    env: Record<string, string>;
    requestTimeout?: number;
  }>;
  tools: string[];
  /** Kiro CLI 2.20.1 registry compatibility; must duplicate the one exact model-visible tool. */
  allowedTools: ["@fabric/fabric_exec"];
  includeMcpJson: false;
  includePowers: false;
  resources: string[];
  permissions: {
    rules: [
      {
        capability: "mcp";
        match: ["fabric/fabric_exec"];
        effect: "ask" | "allow";
      },
    ];
  };
}

const kiroProfilePrompt = (
  allowShell: boolean,
  internalChild: boolean,
  enableSubagents: boolean,
): string => {
  const repositoryList = managedRepositoryCalls(allowShell);
  const repositoryCalls = repositoryList.length < 2
    ? repositoryList.join("")
    : `${repositoryList.slice(0, -1).join(", ")}, and ${repositoryList.at(-1)}`;
  const providerCalls = managedProviderCalls().join(", ");
  const shellGuidance = allowShell
    ? "For changes, run the smallest relevant verification with k.bash and separate command evidence from inference."
    : "k.bash is disabled in this profile; do not attempt shell execution.";

  if (internalChild) {
    return `Code mode is mandatory: @fabric/fabric_exec is the only model-visible tool and must handle every operation, including a single read. Inside each call, use only ${repositoryCalls} and the π named-strings map. Await every k.* call and read the { ok, output, details } result from mutations. ${shellGuidance} Persistent memory, MCP federation, and subagents are unavailable inside ACP children; do not call memory.*, mcp.*, or agents.*. Locate with k.find or k.grep, read narrow ranges, batch only independent calls, and return compact evidence. Treat denial, timeout, cancellation, or an unverified result as failure.`;
  }

  const agentGuidance = enableSubagents
    ? "For explicitly requested independent work, read the skill's agents reference before calling agents.*; use at most four non-overlapping children and await every call."
    : "Subagents are disabled in managed Kiro; do not call agents.*.";

  return `Code mode is mandatory: @fabric/fabric_exec is the only model-visible tool and must handle every operation, including a single read, search, edit, or permitted shell command; native repository tools are unavailable. Before the first call, load the fabric-exec skill and read only the reference needed for the request. Inside each call, use ${repositoryCalls} for repository I/O and π for named strings. Generic provider access is limited to ${providerCalls}; do not use ${KIRO_NAMESPACE_POLICY.forbiddenAlternateIo.join(", ")}. Await every available k.*, tools.*, memory.*, mcp.*, and agents.* call and read { ok, output, details } from mutations. ${shellGuidance} ${agentGuidance} Locate with k.find or k.grep before narrow k.read ranges. Batch only independent calls, stop gathering when the evidence answers the task, and return compact decision-relevant results. Treat denial, timeout, cancellation, indeterminate effects, and unavailable capabilities as failures; fail closed and never claim completion without verified evidence.`;
};

/**
 * Generate the Kiro v3 custom-agent profile. The permissions block always
 * contains one exact MCP rule so the v3 agent registry treats the profile as
 * loadable: ask by default, allow only with the trusted-local opt-in. Exactly
 * one model-visible tool, with workspace MCP inheritance and Powers disabled.
 */
export const generateKiroProfile = (
  options: KiroProfileOptions,
): KiroProfileDocument => {
  for (const key of Object.keys(options.extraEnv ?? {})) {
    if (/^KIRO_FABRIC_/i.test(key)) {
      throw new Error(`extraEnv may not override reserved Fabric variable ${key}`);
    }
  }
  const internal = options.internalChild;
  if (options.enableSubagents === true && options.allowShell !== true) {
    throw new Error("Kiro subagents require allowShell so children can verify their work");
  }
  if (internal && options.enableSubagents === true) {
    throw new Error("Internal Kiro child profiles cannot enable recursive subagents");
  }
  if (internal && (options.resources?.length ?? 0) > 0) {
    throw new Error("Internal Kiro child profiles cannot inherit managed skills");
  }
  // A user-level Kiro profile can be selected from any repository. Record an
  // explicit project confinement requirement whenever the profile carries a
  // dangerous ambient grant, so selecting that profile elsewhere fails before
  // the MCP runtime (and therefore before k.bash or an ACP child) can start.
  const confineManagedGrant =
    !internal &&
    (options.allowShell === true ||
      options.enableSubagents === true ||
      options.allowTools === true);
  // `runtimeNode` is the installed release path for every managed format-3 profile.
  const runtimeNode = options.nodePath ?? process.execPath;
  let confinedProjectRoot: string | undefined;
  let projectIdentity: { dev: string; ino: string } | undefined;
  if (confineManagedGrant) {
    const identity = resolveCanonicalKiroProjectRootIdentity(options.projectRoot);
    if (identity.root === resolveKiroHome(options.kiroHome)) {
      throw new Error("trusted Kiro project root may not be the Kiro home directory");
    }
    confinedProjectRoot = identity.root;
    projectIdentity = { dev: identity.dev, ino: identity.ino };
  }
  return {
    name: "kiro-fabric",
    description: "Managed Kiro Fabric code-mode profile for Kiro CLI v3",
    prompt: kiroProfilePrompt(
      options.allowShell === true,
      internal !== undefined,
      options.enableSubagents === true,
    ),
    includeMcpJson: false,
    includePowers: false,
    resources: internal ? [] : [...(options.resources ?? [])],
    mcpServers: {
      fabric: {
        command: runtimeNode,
        args: [options.mcpEntryPath],
        env: {
          // Non-security extras come first. Canonical managed values are always
          // written last and reserved names are rejected above.
          ...options.extraEnv,
          KIRO_FABRIC_HOST: "kiro-v3",
          KIRO_FABRIC_PROFILE_KIND: internal ? "internal-child" : "managed-main",
          KIRO_FABRIC_PROJECT_ROOT: confinedProjectRoot ?? options.projectRoot,
          // Workers and JavaScript ACP children inherit this absolute runtime;
          // installed profiles never rediscover Node through PATH/process.execPath.
          KIRO_FABRIC_NODE_BINARY: runtimeNode,
          ...(options.kiroBinaryPath
            ? { [KIRO_BINARY_ENV]: options.kiroBinaryPath }
            : {}),
          ...(options.kiroCliVersion
            ? { [KIRO_VERSION_ENV]: options.kiroCliVersion }
            : {}),
          ...(options.kiroSha256
            ? { [KIRO_SHA256_ENV]: options.kiroSha256 }
            : {}),
          ...(confineManagedGrant
            ? {
                KIRO_FABRIC_ENFORCE_PROJECT_ROOT: "1",
                KIRO_FABRIC_PROJECT_ROOT_DEV: projectIdentity!.dev,
                KIRO_FABRIC_PROJECT_ROOT_INO: projectIdentity!.ino,
              }
            : {}),
          ...(!internal && options.skillBundleSha256
            ? { KIRO_FABRIC_SKILL_BUNDLE_SHA256: options.skillBundleSha256 }
            : {}),
          ...(options.allowShell ? { KIRO_FABRIC_ALLOW_SHELL: "1" } : {}),
          ...(!internal && options.enableSubagents
            ? { KIRO_FABRIC_ENABLE_SUBAGENTS: "1" }
            : {}),
          ...(!internal && options.allowTools
            ? { KIRO_FABRIC_ALLOW_TOOLS: "1" }
            : {}),
          ...(internal
            ? {
                KIRO_FABRIC_CWD: internal.cwd,
                KIRO_FABRIC_KIRO_TOOLS: internal.serializedTools,
              }
            : {}),
        },
        requestTimeout: KIRO_MCP_REQUEST_TIMEOUT_MS,
      },
    },
    tools: ["@fabric/fabric_exec"],
    // Kiro CLI 2.20.1 silently omits public agent-registry entries without
    // allowedTools, even though `agent validate` accepts them. Keep this exact
    // compatibility mirror while permissions remains the authoritative v3 policy.
    allowedTools: ["@fabric/fabric_exec"],
    // Exactly one exact rule. Default "ask" is more restrictive than any broader
    // user/workspace "allow", so Fabric's approval gate cannot be bypassed by an
    // ambient allow; a deny at any wider scope still wins. --allow-tools only
    // changes the effect to "allow" for this exact MCP tool.
    permissions: {
      rules: [
        {
          capability: "mcp",
          match: ["fabric/fabric_exec"],
          effect: options.allowTools === true ? "allow" : "ask",
        },
      ],
    },
  };
};

export const kiroProfilePath = (
  root: string,
  layout: KiroManagedLayout = "project",
): string => managedPaths(root, layout).profile;
