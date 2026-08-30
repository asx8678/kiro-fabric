import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export interface KiroPowerLaunchContext {
  mode: "power";
  pluginRoot: string;
  pluginData: string;
}

const canonicalDirectory = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`Power launch is missing ${name}`);
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  const resolved = path.resolve(value);
  let lexical;
  let canonical;
  try {
    lexical = lstatSync(resolved);
    canonical = realpathSync(resolved);
  } catch (error) {
    throw new Error(`${name} must be an existing directory: ${(error as Error).message}`);
  }
  if (!lexical.isDirectory() || lexical.isSymbolicLink() || canonical !== resolved || !statSync(canonical).isDirectory()) {
    throw new Error(`${name} must be a canonical, non-symlink directory`);
  }
  return canonical;
};

export const resolveKiroPowerLaunchContext = (
  env: NodeJS.ProcessEnv = process.env,
): KiroPowerLaunchContext => {
  const pluginRoot = canonicalDirectory(env.PLUGIN_ROOT, "PLUGIN_ROOT");
  const pluginData = canonicalDirectory(env.PLUGIN_DATA, "PLUGIN_DATA");
  if (pluginRoot === pluginData) throw new Error("PLUGIN_ROOT and PLUGIN_DATA must be different directories");
  const dataInRoot = path.relative(pluginRoot, pluginData);
  if (dataInRoot && dataInRoot !== ".." && !dataInRoot.startsWith(`..${path.sep}`) && !path.isAbsolute(dataInRoot)) {
    throw new Error("PLUGIN_DATA must not be nested inside immutable PLUGIN_ROOT");
  }
  return { mode: "power", pluginRoot, pluginData };
};
