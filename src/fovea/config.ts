import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fabricJsonText } from "../runtime/json-budget.js";
import { record } from "./protocol.js";

export interface FoveaConfig {
  schemaVersion: 1;
  sync: { mode: "enabled" | "hidden" | "disabled"; scope: "session" | "repository"; budget: number; ackClean: boolean; steerThreshold: number; pushFocus: boolean };
  tools: { defaultBudget: number; grepMode: "off" | "augment" | "replace"; grepAugmentBudget: number };
}
export const DEFAULT_FOVEA_CONFIG: FoveaConfig = { schemaVersion: 1, sync: { mode: "enabled", scope: "session", budget: 512, ackClean: false, steerThreshold: 0.15, pushFocus: true }, tools: { defaultBudget: 512, grepMode: "augment", grepAugmentBudget: 512 } };
const fail = (): never => { throw new Error("Invalid fovea.v1 configuration; unknown versions/fields and executable overrides are not accepted"); };
export function validateFoveaConfig(value: unknown): FoveaConfig {
  if (!record(value) || value.schemaVersion !== 1 || Object.keys(value).sort().join(",") !== "schemaVersion,sync,tools" || !record(value.sync) || !record(value.tools)) return fail();
  const s = value.sync, t = value.tools;
  const number = (n: unknown, lo: number, hi: number, integer = true): boolean => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi && (!integer || Number.isSafeInteger(n));
  if (Object.keys(s).sort().join(",") !== "ackClean,budget,mode,pushFocus,scope,steerThreshold" || Object.keys(t).sort().join(",") !== "defaultBudget,grepAugmentBudget,grepMode" ||
      (typeof s.mode !== "string" || !["enabled", "hidden", "disabled"].includes(s.mode)) || (typeof s.scope !== "string" || !["session", "repository"].includes(s.scope)) || !number(s.budget, 128, 8192) || typeof s.ackClean !== "boolean" || !number(s.steerThreshold, 0.02, 8, false) || typeof s.pushFocus !== "boolean" || !number(t.defaultBudget, 256, 16000) || !number(t.grepAugmentBudget, 256, 8192) || (typeof t.grepMode !== "string" || !["off", "augment", "replace"].includes(t.grepMode))) return fail();
  return structuredClone(value) as unknown as FoveaConfig;
}
export function privateFoveaDirectory(directory: string): void {
  if (!path.isAbsolute(directory) || fs.realpathSync(directory) !== directory) throw new Error("Fovea storage must be canonical");
  const s = fs.lstatSync(directory);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid())) throw new Error("Fovea storage must be private and owned");
}
export function createFoveaDirectory(parent: string, name: string): string {
  privateFoveaDirectory(parent);
  if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(name)) throw new Error("Invalid private Fovea directory name");
  const directory = path.join(parent, name);
  try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  privateFoveaDirectory(directory); return directory;
}
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
export const MAX_FOVEA_PROJECT_PROFILES = 128;
export interface FoveaConfigurationState {
  config: FoveaConfig;
  /** Effective revision; session updates continue to use this token. */
  revision: string;
  scope: "session" | "project" | "global" | "defaults";
  /** Persistent updates use their own layer token, even under an override. */
  revisions: { global: string; project?: string; session?: string };
}
type StoredConfig = { config: FoveaConfig; revision: string };

/** Only host-approved configure actions may supply a verified worktree identity.
 * Keys are opaque identities, never paths to read. No workspace files or
 * environment switches are consulted. Disabling is an explicit host-controlled
 * configuration update (sync.mode), not an environment-derived authority.
 * Layers are complete fovea.v1 profiles, not patches. Each instance belongs to
 * one conversation epoch; FoveaHost must not share it across conversations.
 * Session overrides win over that conversation's projects. Global publication
 * clears only this instance's session override; project publication does not.
 */
export class FoveaConfiguration {
  #session: FoveaConfig | undefined;
  constructor(readonly file: string) { privateFoveaDirectory(path.dirname(file)); }
  read(worktreeId?: string): FoveaConfigurationState {
    const projectFile = this.#projectFile(worktreeId);
    const global = this.#stored(this.file), project = projectFile ? this.#stored(projectFile) : undefined;
    const session = this.#session ? { config: structuredClone(this.#session), revision: hash(fabricJsonText(this.#session)) } : undefined;
    const effective = session ?? project ?? global ?? { config: structuredClone(DEFAULT_FOVEA_CONFIG), revision: "absent" };
    return { ...effective, scope: session ? "session" : project ? "project" : global ? "global" : "defaults",
      revisions: { global: global?.revision ?? "absent", ...(projectFile ? { project: project?.revision ?? "absent" } : {}), ...(session ? { session: session.revision } : {}) } };
  }
  update(value: unknown, scope: "session" | "global" | "project", expectedRevision: string, worktreeId?: string): FoveaConfigurationState {
    if (!["session", "global", "project"].includes(scope)) throw new Error("Invalid Fovea configuration scope");
    const config = validateFoveaConfig(value), projectFile = this.#projectFile(worktreeId);
    if (scope === "project" && !projectFile) throw new Error("Project configuration requires a verified worktree identity");
    const before = this.read(worktreeId);
    const revision = scope === "session" ? before.revision : before.revisions[scope];
    if (revision !== expectedRevision) throw new Error("Fovea configuration changed; reread settings before retrying");
    if (scope === "session") this.#session = config;
    else {
      const target = scope === "project" ? projectFile! : this.file;
      const directory = path.dirname(this.file); privateFoveaDirectory(directory);
      // All profiles share publication exclusion, including cap admission. Never
      // evict trust/settings silently or delete an uncertain stale lock.
      const lockPath = this.file + ".lock";
      const lock = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
      const lockIdentity = fs.fstatSync(lock);
      try {
        const check = (): void => {
          if ((this.#stored(target)?.revision ?? "absent") !== expectedRevision) throw new Error("Fovea configuration changed before publication");
        };
        check();
        if (scope === "project") this.#checkProjectCap(target);
        const tmp = path.join(directory, `.fovea-${randomBytes(16).toString("hex")}.tmp`);
        try {
          const fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
          try { fs.writeFileSync(fd, fabricJsonText(config, 8192) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
          check(); fs.renameSync(tmp, target);
        } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
        const dir = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY);
        try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
        if (scope === "global") this.#session = undefined;
      } finally {
        fs.closeSync(lock);
        const current = fs.lstatSync(lockPath);
        if (current.dev !== lockIdentity.dev || current.ino !== lockIdentity.ino) throw new Error("Fovea configuration lock identity changed");
        fs.unlinkSync(lockPath);
      }
    }
    return this.read(worktreeId);
  }
  reload(worktreeId?: string): void { this.#session = undefined; this.read(worktreeId); }
  #projectFile(worktreeId?: string): string | undefined {
    if (worktreeId === undefined) return undefined;
    if (typeof worktreeId !== "string" || !worktreeId.length || worktreeId.length > 4096 || worktreeId.includes("\0")) throw new Error("Invalid verified worktree identity");
    return `${this.file}.project-${hash(worktreeId)}.json`;
  }
  #checkProjectCap(target: string): void {
    const prefix = path.basename(this.file) + ".project-";
    let count = 0, exists = false;
    const directory = fs.opendirSync(path.dirname(this.file));
    try {
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (!entry.name.startsWith(prefix)) continue;
        if (!/^[a-f0-9]{64}\.json$/u.test(entry.name.slice(prefix.length))) throw new Error("Invalid Fovea project profile entry");
        if (++count > MAX_FOVEA_PROJECT_PROFILES) throw new Error("Fovea project profile limit exceeded");
        if (entry.name === path.basename(target)) exists = true;
      }
    } finally { directory.closeSync(); }
    if (!exists && count >= MAX_FOVEA_PROJECT_PROFILES) throw new Error("Fovea project profile limit reached");
  }
  #stored(file: string): StoredConfig | undefined {
    privateFoveaDirectory(path.dirname(file));
    let fd: number;
    try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    try {
      const s = fs.fstatSync(fd);
      if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o077) || s.size > 8192 || (process.getuid && s.uid !== process.getuid())) throw new Error("Unsafe Fovea configuration file");
      const bytes = Buffer.alloc(8193), size = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (size > 8192) throw new Error("Fovea configuration size limit");
      const text = bytes.subarray(0, size).toString("utf8");
      return { config: validateFoveaConfig(JSON.parse(text)), revision: hash(text) };
    } finally { fs.closeSync(fd); }
  }
}
