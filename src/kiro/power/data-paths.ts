import { createHash } from "node:crypto";
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface KiroPowerDataPaths {
  root: string;
  config: string;
  mcpConfig: string;
  cache: string;
  logs: string;
  projects: string;
  daemon: string;
}

const privateDirectory = (directory: string, boundary: string): string => {
  const root = path.resolve(boundary);
  const rootStats = lstatSync(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`Power storage root is a symlink or non-directory: ${boundary}`);
  }
  const target = path.resolve(directory);
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Power data path escapes its storage root: ${directory}`);
  }
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      mkdirSync(cursor, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stats = lstatSync(cursor);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Power data path contains a symlink or non-directory: ${cursor}`);
    }
    chmodSync(cursor, 0o700);
  }
  return target;
};

const privateMcpConfig = (configDirectory: string): string => {
  const target = path.join(configDirectory, "mcporter.json");
  try {
    const descriptor = openSync(target, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify({ mcpServers: {}, imports: [] }, null, 2)}\n`);
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stats = lstatSync(target);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error(`Power MCP configuration is a symlink, hardlink, or non-file: ${target}`);
  }
  chmodSync(target, 0o600);
  return target;
};

export const prepareKiroPowerDataPaths = (pluginData: string): KiroPowerDataPaths => {
  const root = privateDirectory(path.join(pluginData, "fabric"), pluginData);
  const config = privateDirectory(path.join(root, "config"), root);
  return {
    root,
    config,
    mcpConfig: privateMcpConfig(config),
    cache: privateDirectory(path.join(root, "global", "cache"), root),
    logs: privateDirectory(path.join(root, "global", "logs"), root),
    projects: privateDirectory(path.join(root, "projects"), root),
    daemon: privateDirectory(path.join(root, "daemon"), root),
  };
};

export const kiroPowerWorkspaceId = (canonicalRoot: string): string =>
  createHash("sha256").update("kiro-fabric-power-workspace-v1\0").update(canonicalRoot).digest("hex");

export const prepareKiroPowerProjectPaths = (projects: string, canonicalRoot: string) => {
  const root = privateDirectory(path.join(projects, kiroPowerWorkspaceId(canonicalRoot)), projects);
  return {
    root,
    memory: privateDirectory(path.join(root, "memory"), root),
    state: privateDirectory(path.join(root, "state"), root),
    runs: privateDirectory(path.join(root, "runs"), root),
    artifacts: privateDirectory(path.join(root, "artifacts"), root),
    logs: privateDirectory(path.join(root, "logs"), root),
  };
};
