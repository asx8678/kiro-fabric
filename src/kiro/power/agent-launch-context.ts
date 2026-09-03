import fs from "node:fs";
import path from "node:path";
import { canonicalPathContains, inspectCanonicalPath } from "../canonical-path.js";

export interface KiroAgentLaunchContext {
  runtimeRoot: string;
  dataRoot: string;
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
): KiroAgentLaunchContext => {
  const runtimeRoot = canonicalDirectory(env.KIRO_FABRIC_RUNTIME_ROOT, "KIRO_FABRIC_RUNTIME_ROOT");
  const dataRoot = canonicalDirectory(env.KIRO_FABRIC_DATA_ROOT, "KIRO_FABRIC_DATA_ROOT");
  if (runtimeRoot === dataRoot) throw new Error("runtime and data roots must be different directories");
  if (canonicalPathContains(runtimeRoot, dataRoot) || canonicalPathContains(dataRoot, runtimeRoot)) {
    throw new Error("runtime and data roots must not contain one another");
  }
  return { runtimeRoot, dataRoot };
};
