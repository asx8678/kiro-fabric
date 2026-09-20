import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);

import {
  fabricJsonText
} from "./chunk-WZ4PGM3F.js";

// src/fovea/protocol.ts
var FOVEA_IPC_VERSION = 1;
var FOVEA_FRAME_CHARS = 1e6;
var FOVEA_REQUEST_CHARS = 64e3;
var record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var identifier = (v) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/u.test(v);
var epoch = (v) => Number.isSafeInteger(v) && Number(v) >= 0;
var keys = (v, names) => Object.keys(v).every((k) => names.includes(k));
function encodeFrame(value) {
  return fabricJsonText(value, FOVEA_FRAME_CHARS);
}
function decodeRequest(raw) {
  if (typeof raw !== "string" || raw.length > FOVEA_REQUEST_CHARS) throw new Error("Fovea request frame limit");
  const v = JSON.parse(raw);
  fabricJsonText(v, FOVEA_REQUEST_CHARS);
  if (!record(v) || v.version !== FOVEA_IPC_VERSION || !identifier(v.id)) throw new Error("Fovea protocol identity mismatch");
  if ((v.type === "cancel" || v.type === "shutdown") && keys(v, ["version", "type", "id"])) return v;
  if (v.type === "initialize" && keys(v, ["version", "type", "id", "options"]) && record(v.options)) {
    const o = v.options, p = o.parser;
    if (keys(o, ["parser", "storageRoot", "gitPath"]) && typeof o.storageRoot === "string" && o.storageRoot.length <= 4096 && (o.gitPath === void 0 || typeof o.gitPath === "string" && o.gitPath.length <= 4096) && record(p) && keys(p, ["path", "sha256", "version", "generationRoot"]) && typeof p.path === "string" && p.path.length <= 4096 && typeof p.sha256 === "string" && /^[a-f0-9]{64}$/u.test(p.sha256) && typeof p.version === "string" && p.version.length <= 100 && (p.generationRoot === void 0 || typeof p.generationRoot === "string" && p.generationRoot.length <= 4096)) return v;
  }
  if (v.type === "query" && keys(v, ["version", "type", "id", "remainingMs", "request"]) && Number.isSafeInteger(v.remainingMs) && Number(v.remainingMs) > 0 && Number(v.remainingMs) <= 9e5 && record(v.request)) {
    const q = v.request;
    if (keys(q, ["conversationId", "conversationEpoch", "rootId", "root", "authorizationEpoch", "operation", "args"]) && identifier(q.conversationId) && epoch(q.conversationEpoch) && identifier(q.rootId) && epoch(q.authorizationEpoch) && typeof q.root === "string" && q.root.length <= 4096 && identifier(q.operation) && record(q.args)) return v;
  }
  throw new Error("Invalid Fovea private request");
}
function decodeResponse(raw) {
  if (typeof raw !== "string" || raw.length > FOVEA_FRAME_CHARS) throw new Error("Fovea response frame limit");
  const v = JSON.parse(raw);
  fabricJsonText(v, FOVEA_FRAME_CHARS);
  if (!record(v) || v.version !== FOVEA_IPC_VERSION || !identifier(v.id)) throw new Error("Invalid Fovea response identity");
  if (v.ok === true && record(v.value) && keys(v, ["version", "id", "ok", "value"])) return v;
  if (v.ok === false && typeof v.error === "string" && v.error.length <= 800 && keys(v, ["version", "id", "ok", "error"])) return v;
  throw new Error("Invalid Fovea response");
}
function projectEngineJson(value, maxChars = FOVEA_FRAME_CHARS) {
  let nodes = 0, chars = 0;
  const active = /* @__PURE__ */ new Set();
  function walk(v, depth) {
    if (++nodes > 3e4 || depth > 24) throw new Error("Fovea result structural budget exceeded");
    if (typeof v === "string") {
      chars += v.length;
      if (chars > maxChars) throw new Error("Fovea result budget exceeded");
      return v;
    }
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v !== "object" || !v || active.has(v)) throw new Error("Fovea result is not a JSON tree");
    active.add(v);
    try {
      if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error("Fovea result prototype rejected");
      const out = {};
      for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
        if (!d.enumerable) continue;
        if (!("value" in d)) throw new Error("Fovea result accessor rejected");
        if (d.value !== void 0) out[key] = walk(d.value, depth + 1);
      }
      return out;
    } finally {
      active.delete(v);
    }
  }
  const result = walk(value, 0);
  if (!record(result)) throw new Error("Fovea result must be an object");
  fabricJsonText(result, maxChars);
  return result;
}

// src/fovea/config.ts
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
var DEFAULT_FOVEA_CONFIG = { schemaVersion: 1, sync: { mode: "enabled", scope: "session", budget: 512, ackClean: false, steerThreshold: 0.15, pushFocus: true }, tools: { defaultBudget: 512, grepMode: "augment", grepAugmentBudget: 512 } };
var fail = () => {
  throw new Error("Invalid fovea.v1 configuration; unknown versions/fields and executable overrides are not accepted");
};
function validateFoveaConfig(value) {
  if (!record(value) || value.schemaVersion !== 1 || Object.keys(value).sort().join(",") !== "schemaVersion,sync,tools" || !record(value.sync) || !record(value.tools)) return fail();
  const s = value.sync, t = value.tools;
  const number = (n, lo, hi, integer = true) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi && (!integer || Number.isSafeInteger(n));
  if (Object.keys(s).sort().join(",") !== "ackClean,budget,mode,pushFocus,scope,steerThreshold" || Object.keys(t).sort().join(",") !== "defaultBudget,grepAugmentBudget,grepMode" || (typeof s.mode !== "string" || !["enabled", "hidden", "disabled"].includes(s.mode)) || (typeof s.scope !== "string" || !["session", "repository"].includes(s.scope)) || !number(s.budget, 128, 8192) || typeof s.ackClean !== "boolean" || !number(s.steerThreshold, 0.02, 8, false) || typeof s.pushFocus !== "boolean" || !number(t.defaultBudget, 256, 16e3) || !number(t.grepAugmentBudget, 256, 8192) || (typeof t.grepMode !== "string" || !["off", "augment", "replace"].includes(t.grepMode))) return fail();
  return structuredClone(value);
}
function privateFoveaDirectory(directory) {
  if (!path.isAbsolute(directory) || fs.realpathSync(directory) !== directory) throw new Error("Fovea storage must be canonical");
  const s = fs.lstatSync(directory);
  if (!s.isDirectory() || s.isSymbolicLink() || s.mode & 63 || process.getuid && s.uid !== process.getuid()) throw new Error("Fovea storage must be private and owned");
}
function createFoveaDirectory(parent, name) {
  privateFoveaDirectory(parent);
  if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(name)) throw new Error("Invalid private Fovea directory name");
  const directory = path.join(parent, name);
  try {
    fs.mkdirSync(directory, { mode: 448 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  privateFoveaDirectory(directory);
  return directory;
}
var hash = (text) => createHash("sha256").update(text).digest("hex");
var MAX_FOVEA_PROJECT_PROFILES = 128;
var FoveaConfiguration = class {
  constructor(file) {
    this.file = file;
    privateFoveaDirectory(path.dirname(file));
  }
  file;
  #session;
  read(worktreeId) {
    const projectFile = this.#projectFile(worktreeId);
    const global = this.#stored(this.file), project = projectFile ? this.#stored(projectFile) : void 0;
    const session = this.#session ? { config: structuredClone(this.#session), revision: hash(fabricJsonText(this.#session)) } : void 0;
    const effective = session ?? project ?? global ?? { config: structuredClone(DEFAULT_FOVEA_CONFIG), revision: "absent" };
    return {
      ...effective,
      scope: session ? "session" : project ? "project" : global ? "global" : "defaults",
      revisions: { global: global?.revision ?? "absent", ...projectFile ? { project: project?.revision ?? "absent" } : {}, ...session ? { session: session.revision } : {} }
    };
  }
  update(value, scope, expectedRevision, worktreeId) {
    if (!["session", "global", "project"].includes(scope)) throw new Error("Invalid Fovea configuration scope");
    const config = validateFoveaConfig(value), projectFile = this.#projectFile(worktreeId);
    if (scope === "project" && !projectFile) throw new Error("Project configuration requires a verified worktree identity");
    const before = this.read(worktreeId);
    const revision = scope === "session" ? before.revision : before.revisions[scope];
    if (revision !== expectedRevision) throw new Error("Fovea configuration changed; reread settings before retrying");
    if (scope === "session") this.#session = config;
    else {
      const target = scope === "project" ? projectFile : this.file;
      const directory = path.dirname(this.file);
      privateFoveaDirectory(directory);
      const lockPath = this.file + ".lock";
      const lock = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 384);
      const lockIdentity = fs.fstatSync(lock);
      try {
        const check = () => {
          if ((this.#stored(target)?.revision ?? "absent") !== expectedRevision) throw new Error("Fovea configuration changed before publication");
        };
        check();
        if (scope === "project") this.#checkProjectCap(target);
        const tmp = path.join(directory, `.fovea-${randomBytes(16).toString("hex")}.tmp`);
        try {
          const fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 384);
          try {
            fs.writeFileSync(fd, fabricJsonText(config, 8192) + "\n");
            fs.fsyncSync(fd);
          } finally {
            fs.closeSync(fd);
          }
          check();
          fs.renameSync(tmp, target);
        } finally {
          if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        }
        const dir = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY);
        try {
          fs.fsyncSync(dir);
        } finally {
          fs.closeSync(dir);
        }
        if (scope === "global") this.#session = void 0;
      } finally {
        fs.closeSync(lock);
        const current = fs.lstatSync(lockPath);
        if (current.dev !== lockIdentity.dev || current.ino !== lockIdentity.ino) throw new Error("Fovea configuration lock identity changed");
        fs.unlinkSync(lockPath);
      }
    }
    return this.read(worktreeId);
  }
  reload(worktreeId) {
    this.#session = void 0;
    this.read(worktreeId);
  }
  #projectFile(worktreeId) {
    if (worktreeId === void 0) return void 0;
    if (typeof worktreeId !== "string" || !worktreeId.length || worktreeId.length > 4096 || worktreeId.includes("\0")) throw new Error("Invalid verified worktree identity");
    return `${this.file}.project-${hash(worktreeId)}.json`;
  }
  #checkProjectCap(target) {
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
    } finally {
      directory.closeSync();
    }
    if (!exists && count >= MAX_FOVEA_PROJECT_PROFILES) throw new Error("Fovea project profile limit reached");
  }
  #stored(file) {
    privateFoveaDirectory(path.dirname(file));
    let fd;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    } catch (error) {
      if (error.code === "ENOENT") return void 0;
      throw error;
    }
    try {
      const s = fs.fstatSync(fd);
      if (!s.isFile() || s.nlink !== 1 || s.mode & 63 || s.size > 8192 || process.getuid && s.uid !== process.getuid()) throw new Error("Unsafe Fovea configuration file");
      const bytes = Buffer.alloc(8193), size = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (size > 8192) throw new Error("Fovea configuration size limit");
      const text = bytes.subarray(0, size).toString("utf8");
      return { config: validateFoveaConfig(JSON.parse(text)), revision: hash(text) };
    } finally {
      fs.closeSync(fd);
    }
  }
};

// src/fovea/provenance-journal.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { randomBytes as randomBytes2 } from "node:crypto";
var PROVENANCE_MAX_RECORDS = 128;
var MAX_BYTES = 48e3;
var hash2 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
var object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function validProvenanceTransition(v) {
  return object(v) && typeof v.path === "string" && v.path.length > 0 && v.path.length <= 512 && !v.path.includes("\\") && !/[\x00-\x1f\x7f]/u.test(v.path) && !path2.posix.isAbsolute(v.path) && v.path.split("/").every((p) => !!p && p !== "." && p !== "..") && (v.beforeSha256 === null || hash2(v.beforeSha256)) && (v.afterSha256 === null || hash2(v.afterSha256));
}
function validateProvenanceJournal(v, worktree) {
  if (!object(v) || Object.keys(v).sort().join(",") !== "records,sequence,version,worktree" || v.version !== 1 || !hash2(worktree) || v.worktree !== worktree || !Number.isSafeInteger(v.sequence) || v.sequence < 0 || !Array.isArray(v.records) || v.records.length > PROVENANCE_MAX_RECORDS) throw new Error("Invalid provenance journal");
  let previous = v.sequence - v.records.length;
  for (const r of v.records) {
    if (!validProvenanceTransition(r) || Object.keys(r).sort().join(",") !== "afterSha256,beforeSha256,origin,path,sequence" || !object(r) || !hash2(r.origin) || r.sequence !== ++previous) throw new Error("Invalid provenance record");
  }
  if (previous !== v.sequence || Buffer.byteLength(JSON.stringify(v), "utf8") > MAX_BYTES) throw new Error("Invalid provenance bounds");
  return v;
}
var FoveaProvenanceJournal = class {
  directory;
  constructor(foveaRoot) {
    this.directory = createFoveaDirectory(foveaRoot, "provenance");
  }
  access(worktree, fn) {
    if (!hash2(worktree) || process.platform !== "linux") throw new Error("Unsupported provenance storage");
    privateFoveaDirectory(this.directory);
    const fd = fs2.openSync(this.directory, fs2.constants.O_RDONLY | fs2.constants.O_DIRECTORY | fs2.constants.O_NOFOLLOW);
    try {
      const s = fs2.fstatSync(fd), current = fs2.lstatSync(this.directory);
      if (s.dev !== current.dev || s.ino !== current.ino || s.mode & 63 || s.uid !== process.getuid?.()) throw new Error("Unsafe provenance directory");
      return fn(`/proc/self/fd/${fd}/${worktree}.json`, fd);
    } finally {
      fs2.closeSync(fd);
    }
  }
  load(file, worktree) {
    let fd;
    try {
      fd = fs2.openSync(file, fs2.constants.O_RDONLY | fs2.constants.O_NOFOLLOW | fs2.constants.O_NONBLOCK);
    } catch (e) {
      if (e.code === "ENOENT") return { version: 1, worktree, sequence: 0, records: [] };
      throw e;
    }
    try {
      const s = fs2.fstatSync(fd);
      if (!s.isFile() || s.nlink !== 1 || s.mode & 63 || s.uid !== process.getuid?.() || s.size > MAX_BYTES) throw new Error("Unsafe provenance file");
      const bytes = Buffer.alloc(MAX_BYTES + 1), n = fs2.readSync(fd, bytes, 0, bytes.length, 0);
      if (n > MAX_BYTES) throw new Error("Provenance byte limit");
      return validateProvenanceJournal(JSON.parse(bytes.subarray(0, n).toString("utf8")), worktree);
    } finally {
      fs2.closeSync(fd);
    }
  }
  read(worktree) {
    return this.access(worktree, (file) => this.load(file, worktree));
  }
  append(worktree, origin, transitions) {
    if (!hash2(origin) || transitions.length > PROVENANCE_MAX_RECORDS || transitions.some((t) => !validProvenanceTransition(t))) throw new Error("Invalid provenance admission");
    this.access(worktree, (file, directory) => {
      const lockPath = file + ".lock";
      const lock = fs2.openSync(lockPath, fs2.constants.O_CREAT | fs2.constants.O_EXCL | fs2.constants.O_WRONLY | fs2.constants.O_NOFOLLOW, 384);
      const identity = fs2.fstatSync(lock);
      const tmp = file + `.${randomBytes2(16).toString("hex")}.tmp`;
      try {
        const journal = this.load(file, worktree);
        for (const t of transitions) {
          if (t.beforeSha256 === t.afterSha256) continue;
          if (!Number.isSafeInteger(journal.sequence + 1)) throw new Error("Provenance sequence exhausted");
          journal.records.push({ path: t.path, beforeSha256: t.beforeSha256, afterSha256: t.afterSha256, origin, sequence: ++journal.sequence });
        }
        while (journal.records.length > PROVENANCE_MAX_RECORDS || Buffer.byteLength(JSON.stringify(journal), "utf8") > MAX_BYTES) journal.records.shift();
        const fd = fs2.openSync(tmp, fs2.constants.O_CREAT | fs2.constants.O_EXCL | fs2.constants.O_WRONLY | fs2.constants.O_NOFOLLOW, 384);
        try {
          fs2.writeFileSync(fd, JSON.stringify(journal));
          fs2.fsyncSync(fd);
        } finally {
          fs2.closeSync(fd);
        }
        fs2.renameSync(tmp, file);
        fs2.fsyncSync(directory);
      } finally {
        try {
          fs2.unlinkSync(tmp);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        fs2.closeSync(lock);
        const current = fs2.lstatSync(lockPath);
        if (identity.dev !== current.dev || identity.ino !== current.ino) throw new Error("Provenance lock replaced");
        fs2.unlinkSync(lockPath);
      }
    });
  }
};

export {
  record,
  encodeFrame,
  decodeRequest,
  decodeResponse,
  projectEngineJson,
  privateFoveaDirectory,
  createFoveaDirectory,
  FoveaConfiguration,
  PROVENANCE_MAX_RECORDS,
  validProvenanceTransition,
  validateProvenanceJournal,
  FoveaProvenanceJournal
};
