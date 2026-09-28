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
  if (typeof raw !== "string" || raw.length > FOVEA_REQUEST_CHARS) throw new Error("Navigator request frame limit");
  const v = JSON.parse(raw);
  fabricJsonText(v, FOVEA_REQUEST_CHARS);
  if (!record(v) || v.version !== FOVEA_IPC_VERSION || !identifier(v.id)) throw new Error("Navigator protocol identity mismatch");
  if ((v.type === "cancel" || v.type === "shutdown") && keys(v, ["version", "type", "id"])) return v;
  if (v.type === "retireConversation" && keys(v, ["version", "type", "id", "conversationId", "conversationEpoch"]) && identifier(v.conversationId) && epoch(v.conversationEpoch)) return v;
  if (v.type === "initialize" && keys(v, ["version", "type", "id", "options"]) && record(v.options)) {
    const o = v.options, p = o.parser;
    if (keys(o, ["parser", "storageRoot", "gitPath"]) && typeof o.storageRoot === "string" && o.storageRoot.length <= 4096 && (o.gitPath === void 0 || typeof o.gitPath === "string" && o.gitPath.length <= 4096) && record(p) && keys(p, ["path", "sha256", "version", "generationRoot"]) && typeof p.path === "string" && p.path.length <= 4096 && typeof p.sha256 === "string" && /^[a-f0-9]{64}$/u.test(p.sha256) && typeof p.version === "string" && p.version.length <= 100 && (p.generationRoot === void 0 || typeof p.generationRoot === "string" && p.generationRoot.length <= 4096)) return v;
  }
  if (v.type === "query" && keys(v, ["version", "type", "id", "remainingMs", "request"]) && Number.isSafeInteger(v.remainingMs) && Number(v.remainingMs) > 0 && Number(v.remainingMs) <= 9e5 && record(v.request)) {
    const q = v.request;
    if (keys(q, ["conversationId", "conversationEpoch", "rootId", "root", "authorizationEpoch", "operation", "args"]) && identifier(q.conversationId) && epoch(q.conversationEpoch) && identifier(q.rootId) && epoch(q.authorizationEpoch) && typeof q.root === "string" && q.root.length <= 4096 && identifier(q.operation) && record(q.args)) return v;
  }
  throw new Error("Invalid Navigator private request");
}
function decodeResponse(raw) {
  if (typeof raw !== "string" || raw.length > FOVEA_FRAME_CHARS) throw new Error("Navigator response frame limit");
  const v = JSON.parse(raw);
  fabricJsonText(v, FOVEA_FRAME_CHARS);
  if (!record(v) || v.version !== FOVEA_IPC_VERSION || !identifier(v.id)) throw new Error("Invalid Navigator response identity");
  if (v.ok === true && record(v.value) && keys(v, ["version", "id", "ok", "value"])) return v;
  if (v.ok === false && typeof v.error === "string" && v.error.length <= 800 && keys(v, ["version", "id", "ok", "error"])) return v;
  throw new Error("Invalid Navigator response");
}
function projectEngineJson(value, maxChars = FOVEA_FRAME_CHARS) {
  let nodes = 0, chars = 0;
  const active = /* @__PURE__ */ new Set();
  function walk(v, depth) {
    if (++nodes > 3e4 || depth > 24) throw new Error("Navigator result structural budget exceeded");
    if (typeof v === "string") {
      chars += v.length;
      if (chars > maxChars) throw new Error("Navigator result budget exceeded");
      return v;
    }
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v !== "object" || !v || active.has(v)) throw new Error("Navigator result is not a JSON tree");
    active.add(v);
    try {
      if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error("Navigator result prototype rejected");
      const out = {};
      for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
        if (!d.enumerable) continue;
        if (!("value" in d)) throw new Error("Navigator result accessor rejected");
        if (d.value !== void 0) out[key] = walk(d.value, depth + 1);
      }
      return out;
    } finally {
      active.delete(v);
    }
  }
  const result = walk(value, 0);
  if (!record(result)) throw new Error("Navigator result must be an object");
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
  if (!path.isAbsolute(directory) || fs.realpathSync(directory) !== directory) throw new Error("Navigator storage must be canonical");
  const s = fs.lstatSync(directory);
  if (!s.isDirectory() || s.isSymbolicLink() || s.mode & 63 || process.getuid && s.uid !== process.getuid()) throw new Error("Navigator storage must be private and owned");
}
function createFoveaDirectory(parent, name) {
  privateFoveaDirectory(parent);
  if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(name)) throw new Error("Invalid private Navigator directory name");
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
      settingSupport: { "sync.ackClean": {
        supported: false,
        requested: effective.config.sync.ackClean,
        effective: false,
        reason: "Stored for compatibility only; native clean-state UI notifications are unsupported. This setting does not deliver model context or enable automatic sync."
      } },
      revisions: { global: global?.revision ?? "absent", ...projectFile ? { project: project?.revision ?? "absent" } : {}, ...session ? { session: session.revision } : {} }
    };
  }
  update(value, scope, expectedRevision, worktreeId) {
    if (!["session", "global", "project"].includes(scope)) throw new Error("Invalid Navigator configuration scope");
    const config = validateFoveaConfig(value), projectFile = this.#projectFile(worktreeId);
    if (scope === "project" && !projectFile) throw new Error("Project configuration requires a verified worktree identity");
    const before = this.read(worktreeId);
    const revision = scope === "session" ? before.revision : before.revisions[scope];
    if (revision !== expectedRevision) throw new Error("Navigator configuration changed; reread settings before retrying");
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
          if ((this.#stored(target)?.revision ?? "absent") !== expectedRevision) throw new Error("Navigator configuration changed before publication");
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
        if (current.dev !== lockIdentity.dev || current.ino !== lockIdentity.ino) throw new Error("Navigator configuration lock identity changed");
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
        if (!/^[a-f0-9]{64}\.json$/u.test(entry.name.slice(prefix.length))) throw new Error("Invalid Navigator project profile entry");
        if (++count > MAX_FOVEA_PROJECT_PROFILES) throw new Error("Navigator project profile limit exceeded");
        if (entry.name === path.basename(target)) exists = true;
      }
    } finally {
      directory.closeSync();
    }
    if (!exists && count >= MAX_FOVEA_PROJECT_PROFILES) throw new Error("Navigator project profile limit reached");
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
      if (!s.isFile() || s.nlink !== 1 || s.mode & 63 || s.size > 8192 || process.getuid && s.uid !== process.getuid()) throw new Error("Unsafe Navigator configuration file");
      const bytes = Buffer.alloc(8193), size = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (size > 8192) throw new Error("Navigator configuration size limit");
      const text = bytes.subarray(0, size).toString("utf8");
      return { config: validateFoveaConfig(JSON.parse(text)), revision: hash(text) };
    } finally {
      fs.closeSync(fd);
    }
  }
};

// src/fovea/source-platform.ts
import { constants } from "node:fs";
import { open, opendir, realpath } from "node:fs/promises";
import { posix } from "node:path";
var SourcePlatformUnavailableError = class extends Error {
  constructor(platform, prerequisite) {
    super(`Scope-safe source access unavailable on ${platform}: ${prerequisite}`);
    this.platform = platform;
    this.prerequisite = prerequisite;
    this.name = "SourcePlatformUnavailableError";
  }
  platform;
  prerequisite;
  code = "FOVEA_SOURCE_PLATFORM_UNAVAILABLE";
};
function assertSourceComponent(name) {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) throw new Error("Invalid source path component");
}
function sourcePlatform(platform = process.platform) {
  if (platform !== "linux") throw new SourcePlatformUnavailableError(platform, platform === "darwin" ? "missing trusted native openat/fdopendir binding (DarwinSourceBinding ABI 1); /dev/fd is not a substitute" : "missing descriptor-relative source adapter");
  const owned = /* @__PURE__ */ new WeakSet();
  const retain = (handle) => {
    owned.add(handle);
    return handle;
  };
  const fd = (handle) => {
    if (!owned.has(handle) || handle.fd < 0) throw new Error("Invalid source directory handle");
    return handle.fd;
  };
  return {
    async openRootDirectory() {
      return retain(await open("/", constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW));
    },
    async openChild(directory, name, kind) {
      assertSourceComponent(name);
      return retain(await open(`/proc/self/fd/${fd(directory)}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW | (kind === "directory" ? constants.O_DIRECTORY : constants.O_NONBLOCK)));
    },
    async *entries(directory) {
      const stream = await opendir(`/proc/self/fd/${fd(directory)}`, { bufferSize: 128 });
      for await (const entry of stream) yield entry.name;
    }
  };
}
async function openSourceDirectory(platform, path4, signal) {
  signal?.throwIfAborted();
  if (!posix.isAbsolute(path4) || posix.normalize(path4) !== path4 || await realpath(path4) !== path4) throw new Error("Source root must be canonical");
  let handle = await platform.openRootDirectory();
  try {
    for (const part of path4.split("/").filter(Boolean)) {
      signal?.throwIfAborted();
      assertSourceComponent(part);
      const next = await platform.openChild(handle, part, "directory");
      try {
        await handle.close();
      } catch (error) {
        await next.close();
        throw error;
      }
      handle = next;
    }
    signal?.throwIfAborted();
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
async function readSourceBounded(handle, cap, signal) {
  sourceLimit(cap, 128 * 1024 * 1024, "read bytes");
  const parts = [];
  let size = 0;
  for (; ; ) {
    signal?.throwIfAborted();
    const part = Buffer.alloc(Math.min(64 * 1024, cap + 1 - size));
    let filled = 0;
    while (filled < part.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(part, filled, part.length - filled, null);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > part.length - filled) throw new Error("Invalid source read result");
      signal?.throwIfAborted();
      if (!bytesRead) return Buffer.concat([...parts, part.subarray(0, filled)], size);
      size += bytesRead;
      filled += bytesRead;
      if (size > cap) return void 0;
    }
    parts.push(part);
  }
}
function sourceLimit(value, ceiling, name) {
  const limit = value ?? ceiling;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > ceiling) throw new Error(`Invalid source ${name} limit (0..${ceiling})`);
  return limit;
}

// src/fovea/native-source-loader.ts
import { createHash as createHash2 } from "node:crypto";
import { constants as constants3 } from "node:fs";
import { lstat, open as open2, realpath as realpath2, writeFile, chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

// src/installation/filesystem-boundary.mjs
import fs2 from "node:fs";
import path2 from "node:path";
function trustedMacApplications(directory, stat, platform = process.platform) {
  return platform === "darwin" && directory === "/Applications" && stat.uid === 0 && stat.gid === 80 && (stat.mode & 4095) === 509;
}
function trustedDirectoryStat(directory, stat, { platform = process.platform, uid = process.getuid?.() } = {}) {
  const sticky = stat.uid === 0 && (stat.mode & 512) !== 0;
  return stat.isDirectory() && !stat.isSymbolicLink() && (uid === void 0 || stat.uid === uid || stat.uid === 0) && (platform === "win32" || (stat.mode & 18) === 0 || sticky || trustedMacApplications(directory, stat, platform));
}
function captureDirectoryAncestry(target, options = {}) {
  const { label = "Unsafe directory ancestry", platform = process.platform, allowMacAliases = false } = options;
  const absolute = path2.resolve(target);
  const snapshot = (root2, aliases) => {
    let current = path2.parse(root2).root;
    const paths = [current];
    for (const part of root2.slice(current.length).split(path2.sep).filter(Boolean)) {
      current = path2.join(current, part);
      paths.push(current);
    }
    return paths.map((directory) => {
      let stat = fs2.lstatSync(directory);
      if (aliases && platform === "darwin" && ["/etc", "/tmp", "/var"].includes(directory) && stat.isSymbolicLink() && stat.uid === 0 && fs2.realpathSync(directory) === "/private" + directory) stat = fs2.statSync(directory);
      if (!trustedDirectoryStat(directory, stat, options)) throw Error(label + ": " + JSON.stringify(directory));
      return { directory, stat };
    });
  };
  snapshot(absolute, allowMacAliases);
  const root = fs2.realpathSync(absolute), entries = snapshot(root, false);
  const check = () => {
    for (const { directory, stat } of entries) {
      const now = fs2.lstatSync(directory);
      if (!trustedDirectoryStat(directory, now, options) || now.dev !== stat.dev || now.ino !== stat.ino || now.mode !== stat.mode || now.uid !== stat.uid || now.gid !== stat.gid) throw Error(label + " changed: " + JSON.stringify(directory));
    }
    if (fs2.realpathSync(root) !== root) throw Error(label + " changed canonical root");
  };
  check();
  return { root, check };
}

// src/fovea/source-platform-native.ts
import { constants as constants2 } from "node:fs";
var provenance = /* @__PURE__ */ new WeakMap();
function nativeProvenanceOperations(platform) {
  const operations = provenance.get(platform);
  if (!operations) throw new SourcePlatformUnavailableError(process.platform, "missing trusted native provenance ABI 1");
  return operations;
}
function createNativeSourcePlatform(binding) {
  const methods = ["openRoot", "openAt", "stat", "read", "close", "openDirectory", "readDirectory", "closeDirectory"];
  if (!binding || binding.abiVersion !== 1 || !["linux", "darwin"].includes(binding.platform) || binding.platform !== process.platform || methods.some((name) => typeof binding[name] !== "function")) {
    throw new SourcePlatformUnavailableError(process.platform, "invalid or foreign trusted POSIX source binding ABI 1");
  }
  const handles = /* @__PURE__ */ new WeakMap();
  const token = (handle) => {
    const value = handles.get(handle);
    if (!value) throw Object.assign(new Error("Foreign or closed source handle"), { code: "EBADF" });
    return value;
  };
  const retain = (value) => {
    let closing;
    const handle = {
      async stat() {
        const info = await binding.stat(token(handle));
        return {
          ...info,
          isFile: () => (info.mode & constants2.S_IFMT) === constants2.S_IFREG,
          isDirectory: () => (info.mode & constants2.S_IFMT) === constants2.S_IFDIR
        };
      },
      async read(buffer, offset, length, position) {
        if (!Buffer.isBuffer(buffer) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > 65536 || offset > buffer.length - length || position !== null) throw new Error("Invalid native source read bounds");
        const bytes = await binding.read(token(handle), length);
        if (!Buffer.isBuffer(bytes) || bytes.length > length) throw new Error("Invalid native source read result");
        bytes.copy(buffer, offset);
        return { bytesRead: bytes.length };
      },
      close() {
        if (!closing) {
          const capability = token(handle);
          closing = binding.close(capability).then(() => {
            handles.delete(handle);
          }, (error) => {
            if (error.code === "EBUSY") closing = void 0;
            else handles.delete(handle);
            throw error;
          });
        }
        return closing;
      }
    };
    handles.set(handle, value);
    return handle;
  };
  const platform = {
    async openRootDirectory() {
      return retain(await binding.openRoot());
    },
    async openChild(directory, name, kind) {
      assertSourceComponent(name);
      return retain(await binding.openAt(token(directory), name, kind));
    },
    async *entries(directory) {
      const stream = await binding.openDirectory(token(directory));
      try {
        for (; ; ) {
          const batch = await binding.readDirectory(stream);
          if (!Array.isArray(batch) || batch.length > 128) throw new Error("Invalid native directory batch");
          if (!batch.length) return;
          for (const name of batch) {
            assertSourceComponent(name);
            yield name;
          }
        }
      } finally {
        await binding.closeDirectory(stream);
      }
    }
  };
  const journal = binding;
  if (journal.provenanceAbiVersion === 1 && typeof journal.journalRead === "function" && typeof journal.journalReplace === "function") {
    provenance.set(platform, {
      read: (directory, name) => journal.journalRead(token(directory), name),
      replace: (directory, name, expected, replacement, nonce) => journal.journalReplace(token(directory), name, expected, replacement, nonce)
    });
  }
  return platform;
}

// src/fovea/native-source-loader.ts
var hash2 = (bytes) => createHash2("sha256").update(bytes).digest("hex");
var BINARY = "app/fovea/source-platform.node";
var METADATA = "app/fovea/source-platform.json";
var CLOSURE = "app/closure-manifest.json";
function validateNativeSourceArtifact(metadata, bytes, sourceSha256) {
  const m = metadata;
  if (!m || typeof m !== "object" || Array.isArray(m) || Object.keys(m).sort().join(",") !== "abiVersion,arch,minimumMacOS,platform,schemaVersion,sha256,sourceSha256" || m.schemaVersion !== 1 || m.abiVersion !== 1 || m.platform !== "darwin" || process.platform !== "darwin" || m.arch !== process.arch || m.minimumMacOS !== "13.5" || !/^[a-f0-9]{64}$/.test(sourceSha256) || m.sourceSha256 !== sourceSha256 || m.sha256 !== hash2(bytes)) {
    throw new Error("Native source artifact identity mismatch");
  }
  const cpu = process.arch === "arm64" ? 16777228 : process.arch === "x64" ? 16777223 : 0;
  if (!cpu || bytes.length < 32 || bytes.length > 2 * 1024 * 1024 || bytes.readUInt32LE(0) !== 4277009103 || bytes.readUInt32LE(4) !== cpu || bytes.readUInt32LE(12) !== 8) throw new Error("Native source Mach-O architecture/type mismatch");
}
var readOwnedRegular = async (file, limit) => {
  const handle = await open2(file, constants3.O_RDONLY | constants3.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit || stat.mode & 18 || stat.uid !== process.getuid?.()) {
      throw new Error("Native source artifact must be an owned, unaliased regular file");
    }
    const bytes = await handle.readFile();
    if (bytes.length !== stat.size) throw new Error("Native source artifact changed during read");
    return bytes;
  } finally {
    await handle.close();
  }
};
async function loadManagedSourcePlatform(parser, storage) {
  if (process.platform !== "darwin" || !parser.generationRoot) {
    throw new SourcePlatformUnavailableError(process.platform, "missing trusted installation-local native source binding");
  }
  const root = await realpath2(parser.generationRoot);
  if (root !== parser.generationRoot || parser.path !== join(root, "tools/ast-grep")) {
    throw new Error("Native source installation containment mismatch");
  }
  const guard = captureDirectoryAncestry(root, { label: "Native source installation changed" });
  const metadata = await readOwnedRegular(join(root, METADATA), 4096);
  const binary = await readOwnedRegular(join(root, BINARY), 2 * 1024 * 1024);
  const closure = await readOwnedRegular(join(root, CLOSURE), 2 * 1024 * 1024);
  const source = JSON.parse(closure.toString()).buildInputs?.files?.find((entry) => entry.path === "src/fovea/source-platform-native.c");
  validateNativeSourceArtifact(JSON.parse(metadata.toString()), binary, source?.sha256 ?? "");
  guard.check();
  const destinationGuard = captureDirectoryAncestry(storage, { label: "Native source storage changed" });
  const stat = await lstat(storage);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 4095) !== 448 || await realpath2(storage) !== storage) throw new Error("Unsafe native source storage");
  const file = join(storage, "source-platform.node");
  await writeFile(file, binary, { flag: "wx", mode: 320 });
  await chmod(file, 320);
  destinationGuard.check();
  return createNativeSourcePlatform(createRequire(import.meta.url)(file));
}

// src/fovea/provenance-journal.ts
import fs3 from "node:fs";
import path3 from "node:path";
import { randomBytes as randomBytes2 } from "node:crypto";
var PROVENANCE_MAX_RECORDS = 128;
var MAX_BYTES = 48e3;
var hash3 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
var object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function validProvenanceTransition(v) {
  return object(v) && typeof v.path === "string" && v.path.length > 0 && v.path.length <= 512 && !v.path.includes("\\") && !/[\x00-\x1f\x7f]/u.test(v.path) && !path3.posix.isAbsolute(v.path) && v.path.split("/").every((p) => !!p && p !== "." && p !== "..") && (v.beforeSha256 === null || hash3(v.beforeSha256)) && (v.afterSha256 === null || hash3(v.afterSha256));
}
function validateProvenanceJournal(v, worktree) {
  if (!object(v) || Object.keys(v).sort().join(",") !== "records,sequence,version,worktree" || v.version !== 1 || !hash3(worktree) || v.worktree !== worktree || !Number.isSafeInteger(v.sequence) || v.sequence < 0 || !Array.isArray(v.records) || v.records.length > PROVENANCE_MAX_RECORDS) throw new Error("Invalid provenance journal");
  let previous = v.sequence - v.records.length;
  if (previous < 0) throw new Error("Invalid provenance sequence");
  for (const r of v.records) {
    if (!validProvenanceTransition(r) || Object.keys(r).sort().join(",") !== "afterSha256,beforeSha256,origin,path,sequence" || !object(r) || !hash3(r.origin) || r.sequence !== ++previous) throw new Error("Invalid provenance record");
  }
  if (previous !== v.sequence || Buffer.byteLength(JSON.stringify(v), "utf8") > MAX_BYTES) throw new Error("Invalid provenance bounds");
  return v;
}
var FoveaProvenanceJournal = class {
  /** platform is host-authenticated, never taken from guest args or a path. */
  constructor(foveaRoot, platform) {
    this.platform = platform;
    if (platform) this.native = nativeProvenanceOperations(platform);
    else if (process.platform !== "linux") throw new Error("Unsupported provenance storage: trusted native binding required");
    this.directory = createFoveaDirectory(foveaRoot, "provenance");
    this.identity = fs3.lstatSync(this.directory);
  }
  platform;
  directory;
  identity;
  native;
  decode(bytes, worktree) {
    if (bytes === null) return { version: 1, worktree, sequence: 0, records: [] };
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) throw new Error("Provenance byte limit");
    return validateProvenanceJournal(JSON.parse(bytes.toString("utf8")), worktree);
  }
  extend(journal, origin, transitions) {
    for (const t of transitions) {
      if (t.beforeSha256 === t.afterSha256) continue;
      if (!Number.isSafeInteger(journal.sequence + 1)) throw new Error("Provenance sequence exhausted");
      journal.records.push({ path: t.path, beforeSha256: t.beforeSha256, afterSha256: t.afterSha256, origin, sequence: ++journal.sequence });
    }
    while (journal.records.length > PROVENANCE_MAX_RECORDS || Buffer.byteLength(JSON.stringify(journal), "utf8") > MAX_BYTES) journal.records.shift();
  }
  async nativeAccess(worktree, fn) {
    if (!hash3(worktree)) throw new Error("Invalid provenance worktree");
    privateFoveaDirectory(this.directory);
    const directory = await openSourceDirectory(this.platform, this.directory);
    const check = async () => {
      const s = await directory.stat(), current = fs3.lstatSync(this.directory);
      if (!s.isDirectory() || s.dev !== this.identity.dev || s.ino !== this.identity.ino || s.dev !== current.dev || s.ino !== current.ino || s.mode & 63 || s.uid !== process.getuid?.()) throw new Error("Unsafe provenance directory");
      privateFoveaDirectory(this.directory);
    };
    try {
      await check();
      const result = await fn(directory);
      await check();
      return result;
    } finally {
      await directory.close();
    }
  }
  access(worktree, fn) {
    if (!hash3(worktree) || process.platform !== "linux") throw new Error("Unsupported provenance storage");
    privateFoveaDirectory(this.directory);
    const fd = fs3.openSync(this.directory, fs3.constants.O_RDONLY | fs3.constants.O_DIRECTORY | fs3.constants.O_NOFOLLOW);
    try {
      const s = fs3.fstatSync(fd), current = fs3.lstatSync(this.directory);
      if (s.dev !== this.identity.dev || s.ino !== this.identity.ino || s.dev !== current.dev || s.ino !== current.ino || s.mode & 63 || s.uid !== process.getuid?.()) throw new Error("Unsafe provenance directory");
      return fn(`/proc/self/fd/${fd}/${worktree}.json`, fd);
    } finally {
      fs3.closeSync(fd);
    }
  }
  load(file, worktree) {
    let fd;
    try {
      fd = fs3.openSync(file, fs3.constants.O_RDONLY | fs3.constants.O_NOFOLLOW | fs3.constants.O_NONBLOCK);
    } catch (e) {
      if (e.code === "ENOENT") return { version: 1, worktree, sequence: 0, records: [] };
      throw e;
    }
    try {
      const s = fs3.fstatSync(fd);
      if (!s.isFile() || s.nlink !== 1 || s.mode & 63 || s.uid !== process.getuid?.() || s.size > MAX_BYTES) throw new Error("Unsafe provenance file");
      const bytes = Buffer.alloc(MAX_BYTES + 1), n = fs3.readSync(fd, bytes, 0, bytes.length, 0);
      if (n > MAX_BYTES) throw new Error("Provenance byte limit");
      return validateProvenanceJournal(JSON.parse(bytes.subarray(0, n).toString("utf8")), worktree);
    } finally {
      fs3.closeSync(fd);
    }
  }
  async read(worktree) {
    if (this.native) return this.nativeAccess(worktree, async (directory) => this.decode(await this.native.read(directory, `${worktree}.json`), worktree));
    return this.access(worktree, (file) => this.load(file, worktree));
  }
  async append(worktree, origin, transitions, signal) {
    signal?.throwIfAborted();
    if (!hash3(origin) || transitions.length > PROVENANCE_MAX_RECORDS || transitions.some((t) => !validProvenanceTransition(t))) throw new Error("Invalid provenance admission");
    transitions = transitions.map((t) => ({ path: t.path, beforeSha256: t.beforeSha256, afterSha256: t.afterSha256 }));
    if (this.native) return this.nativeAccess(worktree, async (directory) => {
      const name = `${worktree}.json`, before = await this.native.read(directory, name);
      const journal = this.decode(before, worktree);
      this.extend(journal, origin, transitions);
      signal?.throwIfAborted();
      await this.native.replace(directory, name, before, Buffer.from(JSON.stringify(journal)), randomBytes2(16).toString("hex"));
    });
    this.access(worktree, (file, directory) => {
      const lockPath = file + ".lock";
      const lock = fs3.openSync(lockPath, fs3.constants.O_CREAT | fs3.constants.O_EXCL | fs3.constants.O_WRONLY | fs3.constants.O_NOFOLLOW, 384);
      const identity = fs3.fstatSync(lock);
      const tmp = file + `.${randomBytes2(16).toString("hex")}.tmp`;
      try {
        const journal = this.load(file, worktree);
        this.extend(journal, origin, transitions);
        const fd = fs3.openSync(tmp, fs3.constants.O_CREAT | fs3.constants.O_EXCL | fs3.constants.O_WRONLY | fs3.constants.O_NOFOLLOW, 384);
        try {
          fs3.writeFileSync(fd, JSON.stringify(journal));
          fs3.fsyncSync(fd);
        } finally {
          fs3.closeSync(fd);
        }
        fs3.renameSync(tmp, file);
        fs3.fsyncSync(directory);
      } finally {
        try {
          fs3.unlinkSync(tmp);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        fs3.closeSync(lock);
        const current = fs3.lstatSync(lockPath);
        if (identity.dev !== current.dev || identity.ino !== current.ino) throw new Error("Provenance lock replaced");
        fs3.unlinkSync(lockPath);
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
  assertSourceComponent,
  sourcePlatform,
  openSourceDirectory,
  readSourceBounded,
  sourceLimit,
  loadManagedSourcePlatform,
  PROVENANCE_MAX_RECORDS,
  validProvenanceTransition,
  validateProvenanceJournal,
  FoveaProvenanceJournal
};
