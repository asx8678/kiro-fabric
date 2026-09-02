import path from "node:path";
import { canonicalPathContains, inspectCanonicalPath } from "../canonical-path.js";

export interface KiroPowerLaunchContext {
  mode: "power";
  pluginRoot: string;
  pluginData: string;
}

const canonicalDirectory = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`Power launch is missing ${name}`);
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  try {
    return inspectCanonicalPath(value, {
      kind: "directory",
      rejectFinalSymlink: true,
    }).canonicalPath;
  } catch (error) {
    throw new Error(`${name} must be an existing directory: ${(error as Error).message}`);
  }
};

export const resolveKiroPowerLaunchContext = (
  env: NodeJS.ProcessEnv = process.env,
): KiroPowerLaunchContext => {
  const pluginRoot = canonicalDirectory(env.PLUGIN_ROOT, "PLUGIN_ROOT");
  const pluginData = canonicalDirectory(env.PLUGIN_DATA, "PLUGIN_DATA");
  if (pluginRoot === pluginData) throw new Error("PLUGIN_ROOT and PLUGIN_DATA must be different directories");
  if (canonicalPathContains(pluginRoot, pluginData) || canonicalPathContains(pluginData, pluginRoot)) {
    throw new Error("PLUGIN_ROOT and PLUGIN_DATA must not contain one another");
  }
  return { mode: "power", pluginRoot, pluginData };
};
