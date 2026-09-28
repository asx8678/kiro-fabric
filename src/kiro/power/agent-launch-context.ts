import fs from "node:fs";
import path from "node:path";
import { canonicalPathContains, inspectCanonicalPath } from "../canonical-path.js";

export interface KiroAgentLaunchContext {
  runtimeRoot: string;
  dataRoot: string;
  astGrep?: string;
  launchWorkspaceRoot?: string;
  /** Profile-declared same-call Fovea suffix. Not native session routing or hook registration. */
  foveaCallContext?: true;
}

const canonicalDirectory = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`Agent launch is missing ${name}`);
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  try {
    const inspected = inspectCanonicalPath(value, {
      kind: "directory",
      rejectFinalSymlink: true,
    });
    const stats = fs.lstatSync(inspected.canonicalPath);
    if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
      throw new Error("directory is not owned by the current user");
    }
    if (process.platform !== "win32" && (stats.mode & 0o022) !== 0) {
      throw new Error("directory is group/other writable");
    }
    return inspected.canonicalPath;
  } catch (error) {
    throw new Error(`${name} must be an existing directory: ${(error as Error).message}`);
  }
};

export const resolveKiroAgentLaunchContext = (
  env: NodeJS.ProcessEnv = process.env,
  launchDirectory: () => string = () => process.cwd(),
): KiroAgentLaunchContext => {
  const runtimeRoot = canonicalDirectory(env.KIRO_FABRIC_RUNTIME_ROOT, "KIRO_FABRIC_RUNTIME_ROOT");
  const dataRoot = canonicalDirectory(env.KIRO_FABRIC_DATA_ROOT, "KIRO_FABRIC_DATA_ROOT");
  if (runtimeRoot === dataRoot) throw new Error("runtime and data roots must be different directories");
  if (canonicalPathContains(runtimeRoot, dataRoot) || canonicalPathContains(dataRoot, runtimeRoot)) {
    throw new Error("runtime and data roots must not contain one another");
  }
  let astGrep: string | undefined;
  if (env.KIRO_FABRIC_AST_GREP !== undefined && env.KIRO_FABRIC_AST_GREP !== "${KIRO_FABRIC_AST_GREP}") {
    astGrep = env.KIRO_FABRIC_AST_GREP;
    const installRoot = path.dirname(path.dirname(astGrep));
    if (!path.isAbsolute(astGrep) || fs.realpathSync(astGrep) !== astGrep || path.basename(astGrep) !== "ast-grep" ||
        path.basename(path.dirname(astGrep)) !== "tools" || runtimeRoot !== path.join(installRoot, "app")) {
      throw new Error("KIRO_FABRIC_AST_GREP must be the canonical tools/ast-grep beside the installed app");
    }
  }
  const source = env.KIRO_FABRIC_WORKSPACE_SOURCE;
  if (source !== undefined && source !== "launch-cwd") {
    throw new Error("KIRO_FABRIC_WORKSPACE_SOURCE must be launch-cwd when set");
  }
  const handoff = env.KIRO_FABRIC_LAUNCH_WORKSPACE;
  // Kiro leaves an unset interpolation literal unchanged. It supplies no authority.
  const explicit = handoff !== undefined && handoff !== "${KIRO_FABRIC_LAUNCH_WORKSPACE}";
  // The installed profile explicitly authorizes Kiro's per-session MCP launch
  // directory. Capture it once at startup, never from PWD, model input, or a
  // later runtime cwd. Unconfigured/library launches remain explicit-only.
  // Client roots still take precedence in syncWorkspace; reserved roots are
  // rejected by the workspace binding before any project effects are enabled.
  const launchWorkspaceRoot = explicit
    ? canonicalDirectory(handoff, "KIRO_FABRIC_LAUNCH_WORKSPACE")
    : source === "launch-cwd" ? canonicalDirectory(launchDirectory(), "MCP launch directory") : undefined;
  const callContext = env.KIRO_FABRIC_FOVEA_CALL_CONTEXT;
  if (callContext !== undefined && callContext !== "0" && callContext !== "1" && callContext !== "${KIRO_FABRIC_FOVEA_CALL_CONTEXT}") {
    throw new Error("KIRO_FABRIC_FOVEA_CALL_CONTEXT must be 0 or 1 when set");
  }
  return { runtimeRoot, dataRoot, ...(astGrep ? { astGrep } : {}), ...(launchWorkspaceRoot ? { launchWorkspaceRoot } : {}), ...(callContext === "1" ? { foveaCallContext: true as const } : {}) };
};
