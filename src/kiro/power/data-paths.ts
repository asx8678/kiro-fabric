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

const privateFile = (target: string, maximum = 1024 * 1024): fs.Stats => {
  const stats = fs.lstatSync(target);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > maximum) {
    throw new Error(`Legacy Power data is not a bounded unaliased regular file: ${target}`);
  }
  assertCurrentUser(stats, target);
  if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) throw new Error(`Legacy Power data is not private: ${target}`);
  return stats;
};

const copyFileAtomic = (source: string, target: string): void => {
  privateFile(source);
  const temporary = `${target}.${process.pid}.${Date.now()}.migration.tmp`;
  let descriptor: number | undefined;
  try {
    const bytes = fs.readFileSync(source);
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const sourceDigest = createHash("sha256").update(bytes).digest("hex");
    if (createHash("sha256").update(fs.readFileSync(temporary)).digest("hex") !== sourceDigest) throw new Error("Legacy Power migration copy digest mismatch");
    try { fs.linkSync(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      privateFile(target);
      if (createHash("sha256").update(fs.readFileSync(target)).digest("hex") !== sourceDigest) throw new Error("Concurrent legacy Power migration produced different bytes");
    }
    fs.unlinkSync(temporary);
    const directory = fs.openSync(path.dirname(target), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
    throw error;
  }
};

const migrateMcpConfiguration = (config: string): string[] => {
  const current = path.join(config, "mcp.json");
  const legacy = path.join(config, "mcporter.json");
  if (fs.existsSync(current) || !fs.existsSync(legacy)) return [];
  const parsed: unknown = JSON.parse(fs.readFileSync(legacy, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Legacy mcporter configuration is malformed; repair or archive it before starting the Power");
  copyFileAtomic(legacy, current);
  return ["config/mcporter.json -> config/mcp.json"];
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
  const migrated = migrateMcpConfiguration(config);
  if (migrated.length) privateJson(path.join(root, "migration-report.json"), { schemaVersion: 1, migrated, ignored: [] });
  return {
    root,
    config,
    configFile: path.join(config, "config.json"),
    mcpConfig: privateJson(path.join(config, "mcp.json"), { mcpServers: {}, imports: [] }),
    artifacts: privateDirectory(path.join(root, "artifacts"), root),
    projects: privateDirectory(path.join(root, "projects"), root),
  };
};

const kiroPowerWorkspaceId = (identity: KiroPowerWorkspaceIdentity, generation: 2 | 3 = 3): string => createHash("sha256")
  .update(`kiro-fabric-power-workspace-v${generation}\0`).update(identity.canonicalPath).update("\0")
  .update(identity.deviceId).update("\0").update(identity.fileId).digest("hex");

const migrateWorkspaceGeneration = (projects: string, identity: KiroPowerWorkspaceIdentity): string[] => {
  const current = path.join(projects, kiroPowerWorkspaceId(identity, 3));
  const legacy = path.join(projects, kiroPowerWorkspaceId(identity, 2));
  if (fs.existsSync(current) || !fs.existsSync(legacy)) return [];
  const legacyStats = fs.lstatSync(legacy);
  if (!legacyStats.isDirectory() || legacyStats.isSymbolicLink()) throw new Error("Legacy workspace storage is not a private regular directory");
  assertCurrentUser(legacyStats, legacy);
  if (process.platform !== "win32" && (legacyStats.mode & 0o077) !== 0) throw new Error("Legacy workspace storage permissions are not private");
  const identityFile = path.join(legacy, "workspace-identity.json");
  privateFile(identityFile, 64 * 1024);
  const persisted: unknown = JSON.parse(fs.readFileSync(identityFile, "utf8"));
  if (JSON.stringify(persisted) !== JSON.stringify(identity)) throw new Error("Legacy workspace identity does not match the currently verified filesystem object");
  fs.renameSync(legacy, current);
  const directory = fs.openSync(projects, "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  return ["workspace-v2 -> workspace-v3", "preserved compatible memory/state/artifacts", "archived incompatible legacy children in place"];
};

export const prepareKiroPowerProjectPaths = (projects: string, identity: KiroPowerWorkspaceIdentity) => {
  const migrated = migrateWorkspaceGeneration(projects, identity);
  const root = privateDirectory(path.join(projects, kiroPowerWorkspaceId(identity)), projects);
  const identityFile = privateJson(path.join(root, "workspace-identity.json"), identity);
  const persisted = JSON.parse(fs.readFileSync(identityFile, "utf8")) as KiroPowerWorkspaceIdentity;
  if (JSON.stringify(persisted) !== JSON.stringify(identity)) throw new Error("Power workspace identity does not match the current filesystem object");
  if (migrated.length) privateJson(path.join(root, "migration-report.json"), { schemaVersion: 1, migrated, ignored: ["runs", "logs", "deleted orchestration fields"] });
  return {
    root,
    identityFile,
    memory: privateDirectory(path.join(root, "memory"), root),
    state: privateDirectory(path.join(root, "state"), root),
    artifacts: privateDirectory(path.join(root, "artifacts"), root),
  };
};
