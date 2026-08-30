import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";

export interface KiroPowerDataPaths {
  root: string;
  config: string;
  cache: string;
  logs: string;
  projects: string;
  daemon: string;
}

const privateDirectory = (directory: string): string => {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Power data path is not a private regular directory: ${directory}`);
  }
  chmodSync(directory, 0o700);
  return directory;
};

export const prepareKiroPowerDataPaths = (pluginData: string): KiroPowerDataPaths => {
  const root = privateDirectory(path.join(pluginData, "fabric"));
  return {
    root,
    config: privateDirectory(path.join(root, "config")),
    cache: privateDirectory(path.join(root, "global", "cache")),
    logs: privateDirectory(path.join(root, "global", "logs")),
    projects: privateDirectory(path.join(root, "projects")),
    daemon: privateDirectory(path.join(root, "daemon")),
  };
};

export const kiroPowerWorkspaceId = (canonicalRoot: string): string =>
  createHash("sha256").update("kiro-fabric-power-workspace-v1\0").update(canonicalRoot).digest("hex");

export const prepareKiroPowerProjectPaths = (projects: string, canonicalRoot: string) => {
  const root = privateDirectory(path.join(projects, kiroPowerWorkspaceId(canonicalRoot)));
  return {
    root,
    memory: privateDirectory(path.join(root, "memory")),
    state: privateDirectory(path.join(root, "state")),
    runs: privateDirectory(path.join(root, "runs")),
    artifacts: privateDirectory(path.join(root, "artifacts")),
    logs: privateDirectory(path.join(root, "logs")),
  };
};
