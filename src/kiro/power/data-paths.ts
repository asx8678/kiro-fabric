import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface KiroPowerDataPaths {
  root: string;
  config: string;
  configFile: string;
  mcpConfig: string;
  artifacts: string;
  projects: string;
}
export interface KiroPowerWorkspaceIdentity { schemaVersion: 1; canonicalPath: string; deviceId: string; fileId: string }

const assertCurrentUser = (stats: fs.Stats, target: string): void => {
  if (process.platform !== "win32" && typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error(`Power data path is owned by another user: ${target}`);
  }
};

const privateDirectory = (directory: string, boundary: string): string => {
  const root = path.resolve(boundary);
  const rootStats = fs.lstatSync(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error(`Power storage root is not a regular directory: ${boundary}`);
  assertCurrentUser(rootStats, root);
  const target = path.resolve(directory);
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Power data path escapes storage: ${directory}`);
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try { fs.mkdirSync(cursor, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const stats = fs.lstatSync(cursor);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`Power data path contains a non-directory: ${cursor}`);
    assertCurrentUser(stats, cursor);
    fs.chmodSync(cursor, 0o700);
  }
  return target;
};

const privateJson = (target: string, initial: unknown): string => {
  try {
    const descriptor = fs.openSync(target, "wx", 0o600);
    try { fs.writeFileSync(descriptor, `${JSON.stringify(initial, null, 2)}\n`); } finally { fs.closeSync(descriptor); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const stats = fs.lstatSync(target);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) throw new Error(`Power configuration is not a private regular file: ${target}`);
  assertCurrentUser(stats, target);
  if (stats.size > 1024 * 1024) throw new Error(`Power configuration exceeds 1048576 bytes: ${target}`);
  fs.chmodSync(target, 0o600);
  return target;
};

export const prepareKiroPowerDataPaths = (pluginData: string): KiroPowerDataPaths => {
  const root = privateDirectory(path.join(pluginData, "fabric"), pluginData);
  const config = privateDirectory(path.join(root, "config"), root);
  return {
    root,
    config,
    configFile: path.join(config, "config.json"),
    mcpConfig: privateJson(path.join(config, "mcp.json"), { mcpServers: {}, imports: [] }),
    artifacts: privateDirectory(path.join(root, "artifacts"), root),
    projects: privateDirectory(path.join(root, "projects"), root),
  };
};

const kiroPowerWorkspaceId = (identity: KiroPowerWorkspaceIdentity): string => createHash("sha256")
  .update("kiro-fabric-power-workspace-v3\0").update(identity.canonicalPath).update("\0")
  .update(identity.deviceId).update("\0").update(identity.fileId).digest("hex");

export const prepareKiroPowerProjectPaths = (projects: string, identity: KiroPowerWorkspaceIdentity) => {
  const root = privateDirectory(path.join(projects, kiroPowerWorkspaceId(identity)), projects);
  const identityFile = privateJson(path.join(root, "workspace-identity.json"), identity);
  const persisted = JSON.parse(fs.readFileSync(identityFile, "utf8")) as KiroPowerWorkspaceIdentity;
  if (JSON.stringify(persisted) !== JSON.stringify(identity)) throw new Error("Power workspace identity does not match the current filesystem object");
  return {
    root,
    identityFile,
    memory: privateDirectory(path.join(root, "memory"), root),
    state: privateDirectory(path.join(root, "state"), root),
    artifacts: privateDirectory(path.join(root, "artifacts"), root),
  };
};
