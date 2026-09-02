import { createHash, randomBytes } from "node:crypto";
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
export interface KiroPowerWorkspaceIdentity { readonly schemaVersion: 1; readonly canonicalPath: string; readonly deviceId: string; readonly fileId: string }

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const errorCode = (error: unknown): string | undefined => isRecord(error) && typeof error.code === "string" ? error.code : undefined;

const projectKiroPowerWorkspaceIdentity = (value: unknown): KiroPowerWorkspaceIdentity => {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.canonicalPath !== "string" || !path.isAbsolute(value.canonicalPath) ||
      typeof value.deviceId !== "string" || !value.deviceId || typeof value.fileId !== "string" || !value.fileId) {
    throw new Error("Power workspace identity is malformed");
  }
  return Object.freeze({ schemaVersion: 1, canonicalPath: value.canonicalPath, deviceId: value.deviceId, fileId: value.fileId });
};
const sameIdentity = (left: KiroPowerWorkspaceIdentity, right: KiroPowerWorkspaceIdentity): boolean =>
  left.schemaVersion === right.schemaVersion && left.canonicalPath === right.canonicalPath && left.deviceId === right.deviceId && left.fileId === right.fileId;
const kiroPowerMemoryNamespace = (identity: KiroPowerWorkspaceIdentity): string =>
  `project:${createHash("sha256").update(identity.canonicalPath).digest("hex")}`;

const assertCurrentUser = (stats: fs.Stats, target: string): void => {
  if (process.platform !== "win32" && typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error(`Power data path is owned by another user: ${target}`);
  }
};
const assertPrivateDirectory = (target: string): fs.Stats => {
  const stats = fs.lstatSync(target);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`Power storage is not a regular directory: ${target}`);
  assertCurrentUser(stats, target);
  if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) throw new Error(`Power storage is not private: ${target}`);
  return stats;
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
    try { fs.mkdirSync(cursor, { mode: 0o700 }); } catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
    const stats = fs.lstatSync(cursor);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`Power data path contains a non-directory: ${cursor}`);
    assertCurrentUser(stats, cursor);
    fs.chmodSync(cursor, 0o700);
  }
  return target;
};

const privateFile = (target: string, maximum = 1024 * 1024): fs.Stats => {
  const stats = fs.lstatSync(target);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error(`Legacy Power data is not a bounded unaliased regular file: ${target}`);
  }
  if (stats.size > maximum) throw new Error(`Power configuration exceeds ${maximum} bytes: ${target}`);
  assertCurrentUser(stats, target);
  if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) throw new Error(`Legacy Power data is not private: ${target}`);
  return stats;
};

const fsyncDirectory = (directory: string): void => {
  const descriptor = fs.openSync(directory, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
};
const writeJsonAtomic = (target: string, value: unknown, exclusive = false): string => {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (exclusive) {
    try {
      const descriptor = fs.openSync(target, "wx", 0o600);
      try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    } catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
  } else {
    const temporary = `${target}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      const descriptor = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, target);
    } catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
  }
  privateFile(target);
  fs.chmodSync(target, 0o600);
  fsyncDirectory(path.dirname(target));
  return target;
};
const privateJson = (target: string, initial: unknown): string => writeJsonAtomic(target, initial, true);

const copyFileAtomic = (source: string, target: string): void => {
  privateFile(source);
  const bytes = fs.readFileSync(source);
  const sourceDigest = createHash("sha256").update(bytes).digest("hex");
  const temporary = `${target}.${process.pid}.${randomBytes(8).toString("hex")}.migration.tmp`;
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    if (createHash("sha256").update(fs.readFileSync(temporary)).digest("hex") !== sourceDigest) throw new Error("Legacy Power migration copy digest mismatch");
    try { fs.linkSync(temporary, target); }
    catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      privateFile(target);
      if (createHash("sha256").update(fs.readFileSync(target)).digest("hex") !== sourceDigest) throw new Error("Concurrent legacy Power migration produced different bytes");
    }
    fs.unlinkSync(temporary);
    fsyncDirectory(path.dirname(target));
  } catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
};

const migrateMcpConfiguration = (config: string): string[] => {
  const current = path.join(config, "mcp.json");
  const legacy = path.join(config, "mcporter.json");
  if (fs.existsSync(current) || !fs.existsSync(legacy)) return [];
  privateFile(legacy, 256 * 1024);
  const parsed: unknown = JSON.parse(fs.readFileSync(legacy, "utf8"));
  if (!isRecord(parsed)) throw new Error("Legacy mcporter configuration is malformed; repair or archive it before starting the Power");
  copyFileAtomic(legacy, current);
  return ["config/mcporter.json -> config/mcp.json"];
};

const LEGACY_CONFIG_FIELDS: Record<string, readonly string[]> = {
  executor: ["timeoutMs", "maxTimeoutMs", "memoryLimitBytes", "maxSourceBytes", "maxInputBytes", "maxOutputChars", "maxNestedResultChars", "maxProviderCalls", "maxConcurrentProviderCalls", "maxApprovalRequests", "maxPendingApprovals", "maxAuditEntries", "maxAuditBytes", "resultFormat"],
  approvals: ["read", "write", "execute", "network"],
  mcp: ["disableOAuth", "callTimeoutMs"],
  memory: ["enabled", "maxEntries", "maxValueChars"],
  state: ["enabled", "maxEntries", "maxValueChars", "maxTotalChars"],
  artifacts: ["maxArtifacts", "maxArtifactChars", "maxTotalChars", "ttlMs"],
};
const migrateLegacyFabricConfiguration = (root: string, config: string): { migrated: string[]; ignored: string[]; quarantined: string[] } => {
  const legacy = path.join(config, "fabric.json");
  if (!fs.existsSync(legacy)) return { migrated: [], ignored: [], quarantined: [] };
  privateFile(legacy, 256 * 1024);
  const parsed: unknown = JSON.parse(fs.readFileSync(legacy, "utf8"));
  if (!isRecord(parsed)) throw new Error("Legacy fabric configuration is malformed");
  const projected: JsonRecord = {};
  const ignored: string[] = [];
  for (const [section, raw] of Object.entries(parsed)) {
    const allowed = LEGACY_CONFIG_FIELDS[section];
    if (!allowed || !isRecord(raw)) { ignored.push(section); continue; }
    const fields: JsonRecord = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!allowed.includes(key)) { ignored.push(`${section}.${key}`); continue; }
      fields[key] = section === "approvals" && (key === "execute" || key === "network") && value === "allow" ? "ask" : value;
    }
    if (Object.keys(fields).length) projected[section] = fields;
  }
  const current = path.join(config, "config.json");
  const migrated: string[] = [];
  if (!fs.existsSync(current) && Object.keys(projected).length) {
    writeJsonAtomic(current, projected, true);
    migrated.push("config/fabric.json -> allowlisted config/config.json");
  }
  const quarantine = privateDirectory(path.join(root, "quarantine"), root);
  const destination = path.join(quarantine, "legacy-fabric.json");
  if (!fs.existsSync(destination)) fs.renameSync(legacy, destination);
  else fs.rmSync(legacy);
  fsyncDirectory(quarantine);
  return { migrated, ignored, quarantined: ["legacy fabric.json"] };
};

export const prepareKiroPowerDataPaths = (pluginData: string): KiroPowerDataPaths => {
  const root = privateDirectory(path.join(pluginData, "fabric"), pluginData);
  const config = privateDirectory(path.join(root, "config"), root);
  const mcpMigrated = migrateMcpConfiguration(config);
  const policy = migrateLegacyFabricConfiguration(root, config);
  if (mcpMigrated.length || policy.migrated.length || policy.quarantined.length) {
    writeJsonAtomic(path.join(root, "migration-report.json"), {
      schemaVersion: 2,
      migrated: [...mcpMigrated, ...policy.migrated],
      ignoredFields: policy.ignored.sort(),
      quarantined: policy.quarantined,
    });
  }
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
const encodeName = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const memoryNamespaceDirectory = (namespace: string): string => `${encodeName(namespace)}-${createHash("sha256").update(namespace).digest("hex").slice(0, 16)}`;

const migrateCompatibleMemory = (sourceRoot: string, targetRoot: string, namespace: string): boolean => {
  if (!fs.existsSync(sourceRoot)) return false;
  assertPrivateDirectory(sourceRoot);
  const sourceMemory = path.join(sourceRoot, "memory");
  if (!fs.existsSync(sourceMemory)) return false;
  assertPrivateDirectory(sourceMemory);
  const rootMarker = path.join(sourceMemory, ".kiro-fabric-owner");
  privateFile(rootMarker, 8 * 1024);
  const rootOwner = JSON.parse(fs.readFileSync(rootMarker, "utf8")) as JsonRecord;
  if (rootOwner.format !== 1 || rootOwner.owner !== "kiro-fabric" || rootOwner.kind !== "memory-root" || rootOwner.root !== sourceRoot) {
    throw new Error("Legacy memory root ownership is incompatible");
  }
  const namespaceName = memoryNamespaceDirectory(namespace);
  const sourceNamespace = path.join(sourceMemory, namespaceName);
  assertPrivateDirectory(sourceNamespace);
  const namespaceMarker = path.join(sourceNamespace, ".kiro-fabric-owner");
  privateFile(namespaceMarker, 8 * 1024);
  const namespaceOwner = JSON.parse(fs.readFileSync(namespaceMarker, "utf8")) as JsonRecord;
  if (namespaceOwner.format !== 1 || namespaceOwner.owner !== "kiro-fabric" || namespaceOwner.kind !== "memory-namespace" ||
      namespaceOwner.root !== sourceRoot || namespaceOwner.namespace !== namespace) throw new Error("Legacy memory namespace ownership is incompatible");
  const sourceEntries = fs.readdirSync(sourceNamespace, { withFileTypes: true });
  if (sourceEntries.length > 130) throw new Error("Legacy memory entry limit exceeded");
  const targetMemory = privateDirectory(path.join(targetRoot, "memory"), targetRoot);
  writeJsonAtomic(path.join(targetMemory, ".kiro-fabric-owner"), { format: 1, owner: "kiro-fabric", kind: "memory-root", root: targetRoot }, true);
  const targetNamespace = privateDirectory(path.join(targetMemory, namespaceName), targetMemory);
  writeJsonAtomic(path.join(targetNamespace, ".kiro-fabric-owner"), { format: 1, owner: "kiro-fabric", kind: "memory-namespace", root: targetRoot, namespace }, true);
  let totalBytes = 0;
  for (const entry of sourceEntries) {
    if (entry.name === ".kiro-fabric-owner") continue;
    if (!entry.isFile() || !entry.name.endsWith(".json")) throw new Error("Legacy memory contains incompatible residue");
    const source = path.join(sourceNamespace, entry.name);
    const stats = privateFile(source, 16 * 1024);
    totalBytes += stats.size;
    if (totalBytes > 256 * 1024) throw new Error("Legacy memory namespace byte limit exceeded");
    const value = JSON.parse(fs.readFileSync(source, "utf8")) as JsonRecord;
    if (value.format !== 1 || value.owner !== "kiro-fabric" || value.kind !== "memory-entry" || value.namespace !== namespace ||
        typeof value.key !== "string" || value.key.trim() !== value.key || !value.key || `${encodeName(value.key)}.json` !== entry.name ||
        typeof value.updatedAt !== "string" || !("value" in value)) throw new Error("Legacy memory entry is incompatible");
    copyFileAtomic(source, path.join(targetNamespace, entry.name));
  }
  return true;
};

const validateWorkspaceObject = (identity: KiroPowerWorkspaceIdentity): void => {
  const canonical = fs.realpathSync(identity.canonicalPath);
  const stats = fs.statSync(canonical, { bigint: true });
  if (canonical !== identity.canonicalPath || String(stats.dev) !== identity.deviceId || String(stats.ino) !== identity.fileId) {
    throw new Error("Power workspace identity no longer matches the verified filesystem object");
  }
};
const validatePersistedIdentity = (file: string, expected: KiroPowerWorkspaceIdentity): void => {
  privateFile(file, 64 * 1024);
  const persisted = projectKiroPowerWorkspaceIdentity(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!sameIdentity(persisted, expected)) throw new Error("Legacy workspace identity does not match the currently verified filesystem object");
};

const quarantineLegacyWorkspace = (projects: string, legacy: string, identity: KiroPowerWorkspaceIdentity): string | undefined => {
  if (!fs.existsSync(legacy)) return undefined;
  const quarantine = privateDirectory(path.join(projects, ".quarantine"), projects);
  const destination = path.join(quarantine, `workspace-v2-${kiroPowerWorkspaceId(identity, 2)}`);
  if (fs.existsSync(destination)) throw new Error("Legacy workspace quarantine collision");
  fs.renameSync(legacy, destination);
  fsyncDirectory(quarantine);
  return destination;
};

const migrateWorkspaceGeneration = (projects: string, identity: KiroPowerWorkspaceIdentity): { current: string; migrated: boolean } => {
  const current = path.join(projects, kiroPowerWorkspaceId(identity, 3));
  const legacy = path.join(projects, kiroPowerWorkspaceId(identity, 2));
  if (!fs.existsSync(legacy)) return { current, migrated: false };
  const legacyStats = assertPrivateDirectory(legacy);
  void legacyStats;
  validatePersistedIdentity(path.join(legacy, "workspace-identity.json"), identity);
  validateWorkspaceObject(identity);
  if (fs.existsSync(current)) {
    validatePersistedIdentity(path.join(current, "workspace-identity.json"), identity);
    quarantineLegacyWorkspace(projects, legacy, identity);
    return { current, migrated: true };
  }

  const staging = path.join(projects, `.workspace-v3-${kiroPowerWorkspaceId(identity).slice(0, 16)}-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
  fs.mkdirSync(staging, { mode: 0o700 });
  let memoryMigrated = false;
  try {
    writeJsonAtomic(path.join(staging, "workspace-identity.json"), identity, true);
    memoryMigrated = migrateCompatibleMemory(legacy, staging, kiroPowerMemoryNamespace(identity));
    privateDirectory(path.join(staging, "memory"), staging);
    privateDirectory(path.join(staging, "state"), staging);
    privateDirectory(path.join(staging, "artifacts"), staging);
    writeJsonAtomic(path.join(staging, "migration-report.json"), {
      schemaVersion: 2,
      sourceGeneration: 2,
      destinationGeneration: 3,
      migrated: ["immutable workspace identity", ...(memoryMigrated ? ["compatible memory"] : [])],
      quarantined: ["legacy Mesh state", "runs", "logs", "artifacts", "unknown v2 residue"],
      complete: false,
    }, true);
    try { fs.renameSync(staging, current); }
    catch (error) {
      if (errorCode(error) !== "EEXIST" && errorCode(error) !== "ENOTEMPTY") throw error;
      validatePersistedIdentity(path.join(current, "workspace-identity.json"), identity);
      fs.rmSync(staging, { recursive: true, force: true });
    }
    fsyncDirectory(projects);
  } catch (error) { fs.rmSync(staging, { recursive: true, force: true }); throw error; }
  quarantineLegacyWorkspace(projects, legacy, identity);
  writeJsonAtomic(path.join(current, "migration-report.json"), {
    schemaVersion: 2,
    sourceGeneration: 2,
    destinationGeneration: 3,
    migrated: ["immutable workspace identity", ...(memoryMigrated ? ["compatible memory"] : [])],
    quarantined: ["legacy Mesh state", "runs", "logs", "artifacts", "unknown v2 residue"],
    complete: true,
  });
  return { current, migrated: true };
};

export const prepareKiroPowerProjectPaths = (projects: string, rawIdentity: KiroPowerWorkspaceIdentity) => {
  const identity = projectKiroPowerWorkspaceIdentity(rawIdentity);
  const migration = migrateWorkspaceGeneration(projects, identity);
  if (!migration.migrated) validateWorkspaceObject(identity);
  const root = privateDirectory(migration.current, projects);
  const identityFile = privateJson(path.join(root, "workspace-identity.json"), identity);
  validatePersistedIdentity(identityFile, identity);
  return {
    root,
    identityFile,
    memory: privateDirectory(path.join(root, "memory"), root),
    memoryNamespace: kiroPowerMemoryNamespace(identity),
    state: privateDirectory(path.join(root, "state"), root),
    artifacts: privateDirectory(path.join(root, "artifacts"), root),
  };
};
