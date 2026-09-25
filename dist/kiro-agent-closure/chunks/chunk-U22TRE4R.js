import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);


// src/installation/bundle-contract.mjs
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

// src/installation/filesystem-boundary.mjs
import fs from "node:fs";
import { opendir } from "node:fs/promises";
import path from "node:path";
function trustedMacApplications(directory, stat, platform = process.platform) {
  return platform === "darwin" && directory === "/Applications" && stat.uid === 0 && stat.gid === 80 && (stat.mode & 4095) === 509;
}
function trustedDirectoryStat(directory, stat, { platform = process.platform, uid = process.getuid?.() } = {}) {
  const sticky = stat.uid === 0 && (stat.mode & 512) !== 0;
  return stat.isDirectory() && !stat.isSymbolicLink() && (uid === void 0 || stat.uid === uid || stat.uid === 0) && (platform === "win32" || (stat.mode & 18) === 0 || sticky || trustedMacApplications(directory, stat, platform));
}
function captureDirectoryAncestry(target, options = {}) {
  const { label = "Unsafe directory ancestry", platform = process.platform, allowMacAliases = false } = options;
  const absolute = path.resolve(target);
  const snapshot = (root2, aliases) => {
    let current = path.parse(root2).root;
    const paths = [current];
    for (const part of root2.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      paths.push(current);
    }
    return paths.map((directory) => {
      let stat = fs.lstatSync(directory);
      if (aliases && platform === "darwin" && ["/etc", "/tmp", "/var"].includes(directory) && stat.isSymbolicLink() && stat.uid === 0 && fs.realpathSync(directory) === "/private" + directory) stat = fs.statSync(directory);
      if (!trustedDirectoryStat(directory, stat, options)) throw Error(label + ": " + JSON.stringify(directory));
      return { directory, stat };
    });
  };
  snapshot(absolute, allowMacAliases);
  const root = fs.realpathSync(absolute), entries = snapshot(root, false);
  const check = () => {
    for (const { directory, stat } of entries) {
      const now = fs.lstatSync(directory);
      if (!trustedDirectoryStat(directory, now, options) || now.dev !== stat.dev || now.ino !== stat.ino || now.mode !== stat.mode || now.uid !== stat.uid || now.gid !== stat.gid) throw Error(label + " changed: " + JSON.stringify(directory));
    }
    if (fs.realpathSync(root) !== root) throw Error(label + " changed canonical root");
  };
  check();
  return { root, check };
}
async function readDirectoryBounded(directory, limit) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw Error("Directory entry bound");
  const handle = await opendir(directory, { bufferSize: 32 }), names = [];
  try {
    for (; ; ) {
      const entry = await handle.read();
      if (!entry) break;
      if (names.length >= limit) throw Error("Directory entry bound");
      names.push(entry.name);
    }
  } finally {
    await handle.close();
  }
  return names;
}

// src/installation/bundle-contract.mjs
import path2 from "node:path";
var PRODUCT = "kiro-fabric";
var TARGETS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
var LIMITS = Object.freeze({ entries: 4096, file: 160 * 1024 * 1024, bytes: 384 * 1024 * 1024, archive: 192 * 1024 * 1024, manifest: 2 * 1024 * 1024 });
var sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
var byteOrder = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && Object.getPrototypeOf(value) === Object.prototype) return "{" + Object.keys(value).sort(byteOrder).map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  throw Error("Noncanonical metadata");
}
function exactFields(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || canonical(Object.keys(value).sort()) !== canonical([...keys].sort())) throw Error("Invalid schema fields: " + keys.join(","));
}
var isHash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var isStable = (v) => typeof v === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v) && v.split(".").every((n) => Number.isSafeInteger(Number(n)));
function safePath(p) {
  if (typeof p !== "string" || Buffer.byteLength(p) > 240 || p !== p.normalize("NFC") || /[\\:\x00-\x1f\x7f]/.test(p) || p.split("/").some((s) => !s || s === "." || s === ".." || /[. ]$/.test(s))) throw Error("Unsafe bundle path");
  return p;
}
function roleFor(p) {
  safePath(p);
  if (p === "tools/node" || p === "tools/rg" || p === "tools/ast-grep") return "executable";
  if (p === "manager/install-manager.mjs") return "manager";
  if (p.startsWith("app/browser/")) throw Error("Obsolete browser bundle resources are not supported");
  if (p.startsWith("app/")) return "app";
  if (p === "resources/steering/fabric.md" || p === "resources/skills/fabric-exec/SKILL.md" || p.startsWith("resources/skills/fabric-exec/references/")) return "resource";
  if (p.startsWith("notices/")) return "notice";
  throw Error("Unknown bundle entry: " + p);
}
var REQUIRED_APP = ["app/kiro/mcp-entry.js", "app/runtime/compiler-worker-entry.js", "app/runtime/sandbox-worker-entry.js", "app/package.json", "app/closure-manifest.json"];
var FOVEA_REQUIRED_APP = [...REQUIRED_APP, "app/fovea/engine-entry.js", "app/kiro/fovea-hook.js", "app/fovea/component.json", "app/fovea/upstream.json", "app/fovea/UPSTREAM-LICENSE.txt", "app/fovea/ast-grep-LICENSE.txt", "tools/ast-grep", "resources/skills/fabric-exec/references/fovea.md"];
var DARWIN_SOURCE_APP = ["app/fovea/source-platform.node", "app/fovea/source-platform.json"];
var HISTORICAL_REQUIRED_APP = REQUIRED_APP.filter((p) => p !== "app/runtime/sandbox-worker-entry.js");
function compatibilityFor(target, schema = 1) {
  if (!TARGETS.includes(target) || ![1, 2].includes(schema)) throw Error("Unsupported target/schema");
  const linux = target.startsWith("linux-");
  return { minNode: "24.20.0", minKiro: "2.21.1", minGlibc: linux ? schema >= 2 && target === "linux-x64" ? "2.34" : "2.28" : null, minKernel: linux ? "4.18" : null, minMacOS: linux ? null : "13.5", libc: linux ? "glibc" : "system" };
}
function checkCompatibility(value, target, schema) {
  exactFields(value, ["minNode", "minKiro", "minGlibc", "minKernel", "minMacOS", "libc"]);
  if (!(schema === void 0 ? [1, 2] : [schema]).some((version) => canonical(value) === canonical(compatibilityFor(target, version)))) throw Error("Compatibility mismatch");
}
function checkProvenance(p) {
  if (p?.kind === "local-source") {
    exactFields(p, ["kind", "sourceDigest", "gitHead", "dirty"]);
    if (!isHash(p.sourceDigest) || p.gitHead !== null && (typeof p.gitHead !== "string" || !/^[a-f0-9]{40}$/.test(p.gitHead)) || typeof p.dirty !== "boolean") throw Error("Invalid source provenance");
  } else if (p?.kind === "release") {
    exactFields(p, ["kind", "sourceCommit"]);
    if (typeof p.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(p.sourceCommit)) throw Error("Invalid release provenance");
  } else throw Error("Invalid provenance kind");
}
function pinURL(url, hosts) {
  if (typeof url !== "string") throw Error("Invalid pin URL");
  const u = new URL(url);
  if (u.protocol !== "https:" || !hosts.includes(u.hostname) || u.port || u.username || u.password || u.hash || u.search) throw Error("Unapproved pin URL");
}
function checkToolPins(tools, inventory, target, schema = tools && Object.hasOwn(tools, "ast-grep") ? 2 : 1) {
  if (![1, 2].includes(schema)) throw Error("Unsupported tool schema");
  exactFields(tools, schema >= 2 ? ["node", "rg", "ast-grep"] : ["node", "rg"]);
  if (schema >= 2) checkParserPin(tools["ast-grep"], inventory, target);
  const destinations = /* @__PURE__ */ new Set();
  let total = 0;
  for (const tool of ["node", "rg"]) {
    const pin = tools[tool];
    exactFields(pin, ["version", "url", "size", "sha256", "checksumUrl", "members"]);
    const required = tool === "node" ? ["tools/node", "notices/node-LICENSE"] : ["tools/rg", "notices/rg-LICENSE-MIT", "notices/rg-COPYING", "notices/rg-UNLICENSE"];
    if (!Array.isArray(pin.members) || pin.members.length !== required.length) throw Error("Tool members");
    if (pin.version !== (tool === "node" ? "24.20.0" : "14.1.1") || !isHash(pin.sha256) || !Number.isSafeInteger(pin.size) || pin.size < 1 || pin.size > LIMITS.archive) throw Error("Invalid tool pin");
    const hosts = tool === "node" ? ["nodejs.org"] : ["github.com"];
    pinURL(pin.url, hosts);
    pinURL(pin.checksumUrl, hosts);
    const base = tool === "node" ? "https://nodejs.org/dist/v24.20.0/" : "https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/";
    if (typeof target === "string") {
      if (!TARGETS.includes(target)) throw Error("Unsupported tool target");
      const triples = { "darwin-arm64": "aarch64-apple-darwin", "darwin-x64": "x86_64-apple-darwin", "linux-arm64": "aarch64-unknown-linux-gnu", "linux-x64": "x86_64-unknown-linux-musl" };
      const name = tool === "node" ? "node-v24.20.0-" + target : "ripgrep-14.1.1-" + triples[
        /** @type {keyof typeof triples} */
        target
      ];
      if (pin.url !== base + name + ".tar.gz") throw Error("Tool target URL mismatch");
      for (const m of pin.members || []) {
        const suffix = m.path === "tools/node" ? "bin/node" : m.path === "tools/rg" ? "rg" : typeof m.path === "string" ? m.path.replace("notices/" + tool + "-", "") : "";
        if (m.member !== name + "/" + suffix) throw Error("Tool target member mismatch");
      }
    }
    if (!pin.url.startsWith(base) || !pin.url.endsWith(".tar.gz") || pin.checksumUrl !== (tool === "node" ? base + "SHASUMS256.txt" : pin.url + ".sha256")) throw Error("Tool pin upstream mismatch");
    const members = /* @__PURE__ */ new Set();
    for (const m of pin.members) {
      exactFields(m, ["member", "path", "size", "sha256"]);
      safePath(m.member);
      safePath(m.path);
      if (!/^[A-Za-z0-9._/-]+$/.test(m.member) || !required.includes(m.path) || destinations.has(m.path) || members.has(m.member) || !Number.isSafeInteger(m.size) || m.size < 1 || m.size > LIMITS.file || !isHash(m.sha256)) throw Error("Invalid tool member");
      total += m.size;
      if (total > LIMITS.bytes) throw Error("Tool closure byte bound");
      destinations.add(m.path);
      members.add(m.member);
      if (inventory) {
        const e = inventory.find((e2) => e2.path === m.path);
        if (!e || e.size !== m.size || e.sha256 !== m.sha256) throw Error("Tool inventory mismatch: " + m.path);
      }
    }
  }
}
function checkParserPin(pin, inventory, target) {
  exactFields(pin, ["version", "url", "size", "sha256", "integrity", "members"]);
  if (pin.version !== "0.45.3" || !isHash(pin.sha256) || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pin.integrity) || !Number.isSafeInteger(pin.size) || pin.size < 1 || pin.size > 32 * 1024 * 1024) throw Error("Invalid parser pin");
  pinURL(pin.url, ["registry.npmjs.org"]);
  const targets = target === void 0 ? TARGETS : [target];
  if (!targets.some((t) => TARGETS.includes(t) && pin.url === "https://registry.npmjs.org/@ast-grep/cli-" + t + (t.startsWith("linux") ? "-gnu" : "") + "/-/cli-" + t + (t.startsWith("linux") ? "-gnu" : "") + "-0.45.3.tgz")) throw Error("Parser target URL mismatch");
  const required = [["package/ast-grep", "tools/ast-grep"], ["package/package.json", "notices/ast-grep-package.json"], ["package/README.md", "notices/ast-grep-README.md"]];
  if (!Array.isArray(pin.members) || pin.members.length !== required.length) throw Error("Parser members");
  for (const [member, destination] of required) {
    const m = pin.members.find((m2) => m2.path === destination);
    exactFields(m, ["member", "path", "size", "sha256"]);
    if (m.member !== member || !Number.isSafeInteger(m.size) || m.size < 1 || m.size > 64 * 1024 * 1024 || !isHash(m.sha256)) throw Error("Invalid parser member");
    if (inventory) {
      const e = inventory.find((e2) => e2.path === destination);
      if (!e || e.size !== m.size || e.sha256 !== m.sha256) throw Error("Parser inventory mismatch: " + destination);
    }
  }
}
function checkInventoryFor(inventory, requiredApp) {
  if (!Array.isArray(inventory) || inventory.length > LIMITS.entries) throw Error("Inventory bound");
  const seen = /* @__PURE__ */ new Set();
  const aliases = /* @__PURE__ */ new Map();
  let bytes = 0;
  let previous = "";
  for (const e of inventory) {
    exactFields(e, ["mode", "path", "role", "sha256", "size", "type"]);
    const role = roleFor(e.path);
    const key = e.path.toLowerCase();
    if (seen.has(key) || previous && byteOrder(previous, e.path) >= 0) throw Error("Inventory collision/order");
    const segments = e.path.split("/");
    for (let i = 1; i <= segments.length; i++) {
      const part = segments.slice(0, i).join("/"), fold = part.toLowerCase();
      if (i < segments.length && seen.has(fold)) throw Error("Path collision");
      if (aliases.has(fold) && aliases.get(fold) !== part) throw Error("Case directory collision");
      aliases.set(fold, part);
    }
    seen.add(key);
    previous = e.path;
    if (e.role !== role || e.type !== "file" || e.mode !== (role === "executable" ? 448 : 384) || !Number.isSafeInteger(e.size) || e.size < 0 || e.size > LIMITS.file || !isHash(e.sha256)) throw Error("Invalid inventory entry");
    bytes += e.size;
  }
  if (bytes > LIMITS.bytes) throw Error("Bundle byte bound");
  for (const p of [...requiredApp, "tools/node", "tools/rg", "manager/install-manager.mjs", "resources/steering/fabric.md", "resources/skills/fabric-exec/SKILL.md", "notices/node-LICENSE", "notices/rg-LICENSE-MIT", "notices/rg-COPYING", "notices/rg-UNLICENSE"]) if (!inventory.some((e) => e.path === p && e.size > 0)) throw Error("Missing required entry: " + p);
  if (!inventory.some((e) => e.path.startsWith("resources/skills/fabric-exec/references/"))) throw Error("Missing resource closure");
  return bytes;
}
function manifestDigest(payload) {
  return sha256("kiro-fabric.bundle.v1\0" + canonical(payload));
}
function checkManifestFor(m, requiredApp, historical = false) {
  exactFields(m, ["compatibility", "digest", "inventory", "product", "provenance", "schema", "target", "tools", "version"]);
  if (m.schema === 3) throw Error("Obsolete browser bundle schema 3 is not supported; preserve the generation and data for recovery");
  if (![1, 2].includes(m.schema) || m.product !== PRODUCT || !TARGETS.includes(m.target) || !isStable(m.version)) throw Error("Manifest identity");
  checkCompatibility(m.compatibility, m.target, m.schema);
  checkProvenance(m.provenance);
  const nativeRequired = m.target.startsWith("darwin-") && (!historical || Array.isArray(m.inventory) && m.inventory.some((e) => DARWIN_SOURCE_APP.includes(e?.path)));
  const required = m.schema === 2 ? [...FOVEA_REQUIRED_APP, ...nativeRequired ? DARWIN_SOURCE_APP : []] : requiredApp;
  const bytes = checkInventoryFor(m.inventory, required);
  checkToolPins(m.tools, m.inventory, m.target, m.schema);
  if (m.schema === 1 && m.inventory.some((e) => e.path === "tools/ast-grep")) throw Error("Parser requires schema 2");
  const { digest, ...payload } = m;
  if (!isHash(digest) || digest !== manifestDigest(payload)) throw Error("Manifest digest mismatch");
  return bytes;
}
function owned(s) {
  if (typeof process.getuid !== "function" || s.uid !== process.getuid()) throw Error("File ownership mismatch");
}
var sameFile = (a, b) => b.isFile() && b.nlink === 1 && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
async function captureRegular(file, max, consume, { mode } = {}) {
  if (!Number.isSafeInteger(max) || max < 0 || mode !== void 0 && (!Number.isInteger(mode) || mode < 0 || mode > 4095)) throw Error("Invalid capture bound/mode");
  const before = await lstat(file);
  owned(before);
  if (!before.isFile() || before.nlink !== 1 || before.size > max) throw Error("Unsafe or oversized file: " + file);
  if (mode !== void 0 && (before.mode & 4095) !== mode) throw Error("File mode/type");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await handle.stat();
    owned(s);
    if (!sameFile(before, s) || s.size > max || mode !== void 0 && (s.mode & 4095) !== mode) throw Error("File changed");
    const { value, length } = await consume(handle, s.size);
    const after = await handle.stat(), named = await lstat(file);
    if (length !== s.size || !sameFile(s, after) || !sameFile(s, named)) throw Error("File changed");
    return value;
  } finally {
    await handle.close();
  }
}
async function readRegular(file, max, options = {}) {
  return captureRegular(file, max, async (handle, size) => {
    const buffer = Buffer.alloc(size + 1);
    let length = 0;
    while (length < buffer.length) {
      const r = await handle.read(buffer, length, buffer.length - length, null);
      if (!r.bytesRead) break;
      length += r.bytesRead;
    }
    return { value: buffer.subarray(0, length), length };
  }, options);
}
async function hashRegular(file, max, options = {}) {
  return captureRegular(file, max, async (handle, size) => {
    const buffer = Buffer.alloc(Math.min(size + 1, 64 * 1024)), hash = createHash("sha256");
    let length = 0;
    while (length <= size) {
      const r = await handle.read(buffer, 0, Math.min(buffer.length, size + 1 - length), null);
      if (!r.bytesRead) break;
      length += r.bytesRead;
      hash.update(buffer.subarray(0, r.bytesRead));
    }
    return { value: { size: length, sha256: hash.digest("hex") }, length };
  }, options);
}
async function checkRoot(root) {
  const guard = captureDirectoryAncestry(root, { label: "Unsafe root component" });
  const s = await lstat(guard.root);
  owned(s);
  if ((s.mode & 4095) !== 448) throw Error("Unsafe bundle root mode");
  guard.check();
  return guard;
}
async function scan(root) {
  const inventory = [];
  const aliases = /* @__PURE__ */ new Set(), directories = [];
  let count = 0, total = 0;
  const pending = [""];
  while (pending.length) {
    const rel = (
      /** @type {string} */
      pending.pop()
    ), directory = path2.join(root, rel), guard = captureDirectoryAncestry(directory, { label: "Directory changed" });
    const names = await readDirectoryBounded(directory, LIMITS.entries * 2 - count);
    count += names.length;
    guard.check();
    for (const name of names.sort(byteOrder)) {
      const p = rel ? rel + "/" + name : name;
      safePath(p);
      const key = p.toLowerCase();
      if (aliases.has(key)) throw Error("Case collision");
      aliases.add(key);
      const s = await lstat(path2.join(root, p));
      owned(s);
      if (s.isDirectory()) {
        if ((s.mode & 4095) !== 448) throw Error("Directory mode");
        pending.push(p);
        directories.push(p);
      } else {
        const role = p === "bundle-manifest.json" ? "manifest" : roleFor(p), mode = role === "executable" ? 448 : 384;
        if (!s.isFile() || s.nlink !== 1 || (s.mode & 4095) !== mode) throw Error("File mode/type");
        if (p === "bundle-manifest.json") {
          await hashRegular(path2.join(root, p), LIMITS.manifest, { mode });
          continue;
        }
        const digest = await hashRegular(path2.join(root, p), Math.min(LIMITS.file, LIMITS.bytes - total), { mode });
        total += digest.size;
        if (total > LIMITS.bytes) throw Error("Bundle byte bound");
        inventory.push({ path: p, role, type: "file", mode, ...digest });
      }
      guard.check();
    }
    guard.check();
  }
  for (const p of directories) if (!inventory.some((e) => e.path.startsWith(p + "/"))) throw Error("Empty/unknown directory");
  return inventory.sort((a, b) => byteOrder(a.path, b.path));
}
async function createManifestFor(root, { version, target, compatibility, provenance, tools, schema }, requiredApp, historical = false) {
  const guard = await checkRoot(root);
  root = guard.root;
  const resolvedSchema = schema ?? (Object.hasOwn(tools, "ast-grep") ? 2 : 1);
  const payload = { schema: resolvedSchema, product: PRODUCT, version, target, compatibility, provenance, tools, inventory: await scan(root) };
  guard.check();
  const manifest = { ...payload, digest: manifestDigest(payload) };
  checkManifestFor(manifest, requiredApp, historical);
  await checkNativeSourceFiles(root, manifest, historical);
  guard.check();
  return manifest;
}
async function checkNativeSourceFiles(root, manifest, historical = false) {
  const present = DARWIN_SOURCE_APP.some((name) => manifest.inventory.some((e) => e.path === name));
  if (!present && (historical || !(manifest.schema >= 2 && manifest.target.startsWith("darwin-")))) return;
  if (manifest.schema !== 2 || !manifest.target.startsWith("darwin-")) throw Error("Native source target mismatch");
  const capture = async (name, limit) => {
    const entry = manifest.inventory.find((e) => e.path === name);
    if (!entry) throw Error("Native source artifact missing: " + name);
    const bytes2 = await readRegular(path2.join(root, name), limit, { mode: 384 });
    if (bytes2.length !== entry.size || sha256(bytes2) !== entry.sha256) throw Error("Native source inventory mismatch");
    return bytes2;
  };
  const bytes = await capture(DARWIN_SOURCE_APP[0], 2 * 1024 * 1024);
  const metadata = JSON.parse((await capture(DARWIN_SOURCE_APP[1], 4096)).toString());
  const closure = JSON.parse((await capture("app/closure-manifest.json", LIMITS.manifest)).toString());
  const sources = closure.buildInputs?.files?.filter((e) => e.path === "src/fovea/source-platform-native.c");
  exactFields(metadata, ["schemaVersion", "abiVersion", "platform", "arch", "minimumMacOS", "sourceSha256", "sha256"]);
  if (metadata.schemaVersion !== 1 || metadata.abiVersion !== 1 || metadata.platform !== "darwin" || `darwin-${metadata.arch}` !== manifest.target || metadata.minimumMacOS !== "13.5" || sources?.length !== 1 || !isHash(sources[0].sha256) || metadata.sourceSha256 !== sources[0].sha256 || metadata.sha256 !== sha256(bytes)) throw Error("Native source artifact identity mismatch");
  const cpu = metadata.arch === "arm64" ? 16777228 : 16777223;
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 4277009103 || bytes.readUInt32LE(4) !== cpu || bytes.readUInt32LE(12) !== 8) throw Error("Native source Mach-O architecture/type mismatch");
}
async function validateBundle(root) {
  return validateBundleFor(root, REQUIRED_APP);
}
async function validateBundleFor(root, requiredApp, historical = false) {
  const guard = await checkRoot(root);
  root = guard.root;
  const raw = await readRegular(path2.join(root, "bundle-manifest.json"), LIMITS.manifest, { mode: 384 }), manifest = JSON.parse(raw.toString("utf8"));
  if (!raw.equals(Buffer.from(canonical(manifest) + "\n"))) throw Error("Noncanonical manifest bytes");
  const bytes = checkManifestFor(manifest, requiredApp, historical), actual = await createManifestFor(root, manifest, requiredApp, historical);
  if (canonical(actual) !== canonical(manifest)) throw Error("Bundle inventory mismatch");
  guard.check();
  return { root, digest: manifest.digest, manifest, version: manifest.version, inventory: manifest.inventory, bytes };
}

export {
  captureDirectoryAncestry,
  readRegular,
  validateBundle
};
