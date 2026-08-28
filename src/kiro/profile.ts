// Kiro v3 profile generation for the kiro-fabric MCP adapter. Dangerous
// managed grants are bound to the canonical project's filesystem identity.

import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { managedPaths, type KiroManagedLayout } from "./managed.js";
import { KIRO_PROFILE_REQUEST_TIMEOUT_MS } from "./deadlines.js";

export const KIRO_CLI_VERSION = "2.20.1" as const;
export const KIRO_AGENT_ENGINE = "v3" as const;
export const KIRO_ACP_AUTH_METHOD = "cli" as const;

/** Covers the trusted-shell verification window plus adapter overhead. */
const KIRO_MCP_REQUEST_TIMEOUT_MS = KIRO_PROFILE_REQUEST_TIMEOUT_MS;

export interface KiroProfileOptions {
  /** Canonical install/fallback root; dangerous managed-main grants are confined beneath it. */
  projectRoot: string;
  /** Absolute path to the built MCP entry (dist/kiro/mcp-entry.js). */
  mcpEntryPath: string;
  /** Absolute node executable; defaults to process.execPath at generation. */
  nodePath?: string;
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
  const mutationGuidance = allowShell
    ? "k.write, k.edit, and k.bash, which return objects shaped like { ok, output, details }. For code reviews or changes, run the smallest relevant tests/build with k.bash (set a sufficient timeout) and separate verified evidence from code-reading inferences."
    : "k.write and k.edit, which return objects shaped like { ok, output, details }. k.bash is disabled in this profile: do not call it or attempt shell execution.";
  const awaitedCalls = allowShell
    ? "k.ls, k.read, k.readArtifact, k.grep, k.find, k.write, k.edit, and k.bash"
    : "k.ls, k.read, k.readArtifact, k.grep, k.find, k.write, and k.edit";
  const agentGuidance = internalChild
    ? " Subagents are unavailable inside ACP children; do not call agents.*."
    : enableSubagents
      ? " For independent work, agents.run and agents.spawn launch isolated Kiro ACP children with the same trusted shell access. Fan out at most four narrowly scoped, non-overlapping tasks in one fabric_exec program (prefer Promise.all), require each relevant child to run focused tests/builds, then cross-check and deduplicate findings in Main. Omit model for inventory-aware task routing: when advertised, small tasks use claude-haiku-4.5 at low effort, coding/testing uses qwen3-coder-next at low effort, and complex analysis or ambiguous tasks use claude-opus-4.8 at medium effort; otherwise routing falls back to Kiro auto. Pass model: \"auto\" to always let Kiro pick both model and effort. Do not delegate the same broad review to every child."
      : " Subagents are disabled in managed Kiro: do not call agents.*.";
  const agentAwaitGuidance = !internalChild && enableSubagents
    ? " All agents.* API calls also return promises, so await every agents.* call."
    : "";
  const mcpGuidance = internalChild
    ? " MCP federation is unavailable inside ACP children; do not call mcp.*."
    : " Configured external MCP servers are available on demand only through await mcp.servers() and await mcp.call({ server, tool, args }). mcp.call performs external I/O and must pass Fabric's network approval gate; configured stdio executables also require the trusted execute grant. Do not use dynamic mcp.<server>.<tool> paths or register servers from guest code.";
  const memoryGuidance = internalChild
    ? " Persistent memory is unavailable inside ACP children; do not call memory.*."
    : " When enabled, project-isolated persistent facts are available through memory.get, memory.set, memory.search, and memory.index.";
  const additionalAwaitGuidance = internalChild
    ? ""
    : " All memory.* and supported mcp.* calls also return promises; await every one.";

  return `Use only the canonical Kiro Fabric I/O API exposed through the k.* namespace and the π named-strings map. The supported repository I/O calls are k.read, k.readArtifact, k.grep, k.find, and k.ls, which return strings or bounded artifact chunks, plus ${mutationGuidance}${memoryGuidance} π is the lowercase Greek-letter named-strings map. Prefer k.* for all repository work and do not probe or invoke pi.*, tools.fs.*, tools.shell.*, tools.call, tools.search, tools.shell.exec, or alternate I/O namespaces.${mcpGuidance}${agentGuidance} All k.* API calls return promises — always write "await" before ${awaitedCalls}, and never use an un-awaited (thenable) result.${additionalAwaitGuidance}${agentAwaitGuidance} Explore cheaply first: use k.find/k.grep to locate, then k.read only narrow ranges with offset/limit — never re-read a file you already have. Batch only independent calls you already know you need; never one giant program that mixes open-ended discovery with edits. Stop gathering once the evidence answers the question, and return only compact decision-relevant data (paths, symbols, verdicts), not raw dumps. Treat denied, timed-out, cancelled, indeterminate, or otherwise unverified results as failure, fail closed on approval or access uncertainty, and never claim completion without a verified successful tool result.`;
};

/**
 * Generate the Kiro v3 custom-agent profile. The permissions block is always
 * present so the v3 agent registry treats the profile as loadable. It is empty
 * by default; the trusted-local opt-in adds one exact MCP allow rule. Exactly
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
  let confinedProjectRoot: string | undefined;
  let projectIdentity: { dev: string; ino: string } | undefined;
  if (confineManagedGrant) {
    const configured = path.resolve(options.projectRoot);
    const lexical = lstatSync(configured);
    const canonical = realpathSync(configured);
    if (lexical.isSymbolicLink() || !lexical.isDirectory() || canonical !== configured) {
      throw new Error("trusted Kiro project root must be a canonical, non-symlink directory");
    }
    const identity = statSync(canonical, { bigint: true });
    confinedProjectRoot = canonical;
    projectIdentity = { dev: String(identity.dev), ino: String(identity.ino) };
  }
  return {
    name: "kiro-fabric",
    description: "Managed Kiro Fabric profile for Kiro CLI v3",
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
        command: options.nodePath ?? process.execPath,
        args: [options.mcpEntryPath],
        env: {
          // Non-security extras come first. Canonical managed values are always
          // written last and reserved names are rejected above.
          ...options.extraEnv,
          KIRO_FABRIC_HOST: "kiro-v3",
          KIRO_FABRIC_PROFILE_KIND: internal ? "internal-child" : "managed-main",
          KIRO_FABRIC_PROJECT_ROOT: confinedProjectRoot ?? options.projectRoot,
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
