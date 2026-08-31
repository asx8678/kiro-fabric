import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);

import {
  assertKiroAccountingCompatible,
  fabricExecInputSchemaJson,
  inspectFabricConfig,
  require_dist,
  resolveAgentDir
} from "./chunk-Z5TQWEW6.js";
import {
  resolveKiroMcpLaunchEnvironment
} from "./chunk-HQ66VDCC.js";
import "./chunk-PGDCKPF6.js";
import "./chunk-D27TRCNO.js";
import {
  KIRO_V3_AGENT_MODE,
  assertKiroV3AgentModeAvailable,
  buildKiroV3SessionParams,
  formatJsonRpcError,
  parseJsonRpcFrame
} from "./chunk-LNLI7C7M.js";
import {
  KIRO_ACP_AUTH_METHOD,
  KIRO_AGENT_ENGINE,
  KIRO_BINARY_ENV,
  KIRO_CLI_VERSION,
  KIRO_SHA256_ENV,
  KIRO_VERSION_ENV,
  MIN_NODE_MAJOR,
  assertSupportedKiro,
  assertSupportedKiroUnchanged,
  assertSupportedNode,
  generateKiroProfile,
  inspectKiroCompatibility,
  inspectNodeCompatibility,
  kiroProfilePath,
  resolveKiroInstallRoots,
  sameExecutableIdentity
} from "./chunk-DTWQSS3Y.js";
import {
  KIRO_INSTALL_MANIFEST_FORMAT,
  KiroInstallError,
  acquireOperationLock,
  assertBackupBytes,
  assertExecutableAttestation,
  assertManagedTree,
  assertNoSymlinkComponents,
  attestExecutable,
  backupRelativePath,
  commitManagedFileTransaction,
  copyAttestedExecutable,
  defaultMcpEntryPath,
  ensureManagedDirectory,
  fsyncDirectory,
  lstatOrNull,
  managedFileTransition,
  managedPaths,
  probeManagedTransactionRecovery,
  readManagedFileNoFollow,
  readManifest,
  readPackageVersion,
  recoverManagedTransaction,
  resolveKiroProjectRoot,
  rmdirIfEmpty,
  serializeJson,
  sha256Bytes,
  withContainedParent,
  writeAtomic,
  writeExclusive
} from "./chunk-MI2H25H6.js";
import {
  createProcessTreeController,
  resolveScriptRuntimeSync
} from "./chunk-27626ACZ.js";
import "./chunk-OZKYNYCD.js";
import {
  __toESM
} from "./chunk-GX475RD4.js";

// src/kiro/setup.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync6 } from "node:fs";
import { join as join6 } from "node:path";
import { createInterface } from "node:readline/promises";

// src/kiro/doctor.ts
import { mkdtemp as mkdtemp2, mkdir, rm as rm2 } from "node:fs/promises";
import { existsSync as existsSync4, readFileSync as readFileSync4 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join4, resolve as resolve3 } from "node:path";

// src/kiro/supervisor.ts
import { spawn } from "node:child_process";
import path from "node:path";
var STDERR_LIMIT = 4096;
var NODE_SCRIPT_EXTENSIONS = /* @__PURE__ */ new Set([".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"]);
var scriptRuntime = (env) => {
  try {
    return resolveScriptRuntimeSync({ env: { ...process.env, ...env }, requireNode: true });
  } catch {
    return "node";
  }
};
var ProbeError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ProbeError";
  }
};
var spawnJsonRpcProcess = (options) => {
  const command = options.argv[0];
  const script = NODE_SCRIPT_EXTENSIONS.has(path.extname(command).toLowerCase());
  const child = spawn(
    script ? scriptRuntime(options.env) : command,
    script ? [command, ...options.argv.slice(1)] : options.argv.slice(1),
    {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  let earlySpawnError;
  child.on("error", (error) => {
    earlySpawnError = error;
  });
  const pid = child.pid;
  if (pid === void 0) {
    throw new ProbeError(
      earlySpawnError ? `failed to spawn ${options.argv[0]}: ${earlySpawnError.message}` : `failed to spawn ${options.argv[0]}`
    );
  }
  const processTree = createProcessTreeController(pid, { ambientHelpers: false });
  const outboundMethods = [];
  const pending = /* @__PURE__ */ new Map();
  let buffer = "";
  let stderrTail = "";
  let nextId = 1;
  let closed = false;
  let fatal = false;
  let closeError = null;
  let terminatePromise;
  const withStderr = (message) => stderrTail.trim() ? `${message}; stderr: ${stderrTail.trim()}` : message;
  const rejectAll = (error) => {
    closeError = error;
    for (const call2 of pending.values()) call2.reject(error);
    pending.clear();
  };
  const fail = (error) => {
    if (fatal || closed) return;
    fatal = true;
    rejectAll(error);
    void terminate();
  };
  const timer = setTimeout(() => {
    fail(new ProbeError(withStderr(
      `probe timed out after ${options.timeoutMs}ms: ${options.argv.join(" ")}`
    )));
  }, options.timeoutMs);
  timer.unref?.();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (closed || fatal) return;
    buffer += chunk;
    if (Buffer.byteLength(buffer, "utf8") > 4 * 1024 * 1024) {
      fail(new ProbeError("oversized stdout frame from probe child"));
      return;
    }
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const parsed = parseJsonRpcFrame(line);
      if (!parsed.ok) {
        fail(new ProbeError(parsed.message));
        return;
      }
      if (parsed.kind !== "response") continue;
      const frame = parsed.frame;
      const id = frame.id;
      const call2 = pending.get(id);
      if (!call2) {
        fail(new ProbeError(`probe response for unknown id ${id}`));
        return;
      }
      pending.delete(id);
      if (frame.error !== void 0) {
        call2.reject(new ProbeError(formatJsonRpcError(call2.method, frame.error)));
      } else {
        call2.resolve(frame.result);
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_LIMIT);
  });
  child.on("close", () => {
    if (!closed && !fatal && pending.size > 0) {
      fail(new ProbeError(withStderr("probe child exited while requests were pending")));
    }
  });
  async function terminate(graceMs = 3e3, killMs = 2e3) {
    if (terminatePromise) return terminatePromise;
    closed = true;
    clearTimeout(timer);
    rejectAll(closeError ?? new ProbeError("probe child is closed"));
    try {
      child.stdin?.end();
    } catch {
    }
    terminatePromise = processTree.terminate(graceMs, killMs);
    return terminatePromise;
  }
  const call = (method, params) => {
    if (closed || fatal) {
      return Promise.reject(closeError ?? new ProbeError("probe child is closed"));
    }
    const id = nextId++;
    outboundMethods.push(method);
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolvePromise, rejectPromise) => {
      pending.set(id, { resolve: resolvePromise, reject: rejectPromise, method });
      try {
        child.stdin.write(frame + "\n", (error) => {
          if (error) {
            pending.delete(id);
            const failure = new ProbeError(withStderr(`failed writing ${method}: ${error.message}`));
            rejectPromise(failure);
            fail(failure);
          }
        });
      } catch (error) {
        pending.delete(id);
        const failure = new ProbeError(withStderr(
          `failed writing ${method}: ${error instanceof Error ? error.message : String(error)}`
        ));
        rejectPromise(failure);
        fail(failure);
      }
    });
  };
  const notify = (method, params) => {
    if (closed || fatal) return;
    outboundMethods.push(method);
    try {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n", (error) => {
        if (error) fail(new ProbeError(withStderr(`failed writing ${method}: ${error.message}`)));
      });
    } catch (error) {
      fail(new ProbeError(withStderr(
        `failed writing ${method}: ${error instanceof Error ? error.message : String(error)}`
      )));
    }
  };
  return {
    pid,
    call,
    notify,
    terminate,
    outboundMethods,
    get stderrTail() {
      return stderrTail;
    }
  };
};

// src/kiro/install.ts
var import_yaml = __toESM(require_dist(), 1);
import { execFile } from "node:child_process";
import {
  existsSync as existsSync3,
  mkdtempSync,
  readdirSync as readdirSync2,
  readFileSync as readFileSync3,
  rmSync as rmSync2
} from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename as basename2, extname, isAbsolute, join as join3, resolve as resolve2 } from "node:path";
import { promisify } from "node:util";

// src/kiro/install-test-seam.ts
var activeOverrides;
var currentKiroInstallTestOverrides = () => activeOverrides;

// src/kiro/runtime-closure.ts
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

// src/kiro/runtime-closure-test-seam.ts
var beforeQuarantine;
var runBeforeRuntimeQuarantineForTest = (kind, source) => beforeQuarantine?.(kind, source);

// src/kiro/runtime-closure.ts
var runtimeClosurePath = (installRoot, layout) => managedPaths(installRoot, layout).runtimeDir;
var runtimeDirectoryForClosure = (installRoot, layout, closure) => {
  const root = join(installRoot, ...closure.root.split("/"));
  const runtimeDir = dirname(root);
  const paths = managedPaths(installRoot, layout);
  const expectedRoots = [paths.runtimeDir, paths.legacyRuntimeDir].map((parent) => relative(installRoot, join(parent, closure.digest)).split(sep).join("/"));
  if (basename(root) !== closure.digest || !expectedRoots.includes(closure.root) || runtimeDir !== paths.runtimeDir && runtimeDir !== paths.legacyRuntimeDir) {
    throw new KiroInstallError("ownership", "runtime generation root is outside a managed runtime parent");
  }
  return runtimeDir;
};
var runtimeClosureMarkerPath = (installRoot, layout, closure) => join(runtimeDirectoryForClosure(installRoot, layout, closure), ".closure-current");
var resolveSourcePackageRoot = () => {
  const candidates = [
    resolve(import.meta.dirname, ".."),
    resolve(import.meta.dirname, "..", "..")
  ];
  for (const [index, candidate] of candidates.entries()) {
    const packagePath = join(candidate, "package.json");
    if (!existsSync(packagePath)) continue;
    const packaged = join(candidate, "dist", "kiro-closure", "kiro", "mcp-entry.js");
    const installed = join(candidate, "kiro", "mcp-entry.js");
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(packagePath, "utf8"));
    } catch {
      throw new KiroInstallError("ownership", "immediate Fabric artifact metadata is malformed");
    }
    if (pkg.name === "kiro-fabric-runtime-closure") {
      const marker = readFileSync(join(candidate, ".closure-digest"), "utf8").trim();
      if (pkg.digest !== marker || !/^[0-9a-f]{64}$/.test(marker) || !existsSync(installed)) {
        throw new KiroInstallError("ownership", "installed artifact metadata is not bound to its immediate release");
      }
      return candidate;
    }
    if (index === 1 && pkg.name === "kiro-fabric" && existsSync(packaged) && existsSync(join(candidate, "skills"))) return candidate;
    throw new KiroInstallError("ownership", "unexpected immediate Fabric artifact metadata");
  }
  throw new KiroInstallError(
    "fs",
    `cannot resolve current Fabric artifact from ${import.meta.dirname}; run pnpm build first`
  );
};
var closureSourceDirectory = (packageRoot) => {
  const packaged = join(packageRoot, "dist", "kiro-closure");
  return existsSync(join(packaged, "kiro", "mcp-entry.js")) ? packaged : packageRoot;
};
var MANAGED_RELEASE_SKILL_FILES = [
  "fabric-exec/SKILL.md",
  "fabric-exec/references/agents.md",
  "fabric-exec/references/mcp.md",
  "fabric-guide/SKILL.md",
  "fabric-review/SKILL.md",
  "fabric-workflow/SKILL.md"
];
var managedReleaseSkillPath = (packageRoot, relativePath) => {
  const strictPath = join(packageRoot, "strict", "skills", ...relativePath.split("/"));
  return existsSync(strictPath) ? strictPath : join(packageRoot, "skills", ...relativePath.split("/"));
};
var nodeExecutableName = () => process.platform === "win32" ? "node.exe" : "node";
var isDeployableFile = (relativePath) => relativePath.endsWith(".js") || // TS lib files ship with the closure so the bundled compiler can resolve its
// default `lib.es*.d.ts` chain at runtime (Promise/reference globals).
relativePath.endsWith(".d.ts") || relativePath === "package.json";
var closureFileList = (closureDir) => {
  const files = [];
  const visit = (dir, prefix) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        throw new KiroInstallError("symlink", `runtime closure contains a symlink: ${full}`);
      }
      if (entry.isDirectory()) {
        visit(full, rel);
      } else if (entry.isFile()) {
        if (isDeployableFile(rel)) files.push(rel);
      }
    }
  };
  if (existsSync(join(closureDir, "kiro", "mcp-entry.js"))) visit(closureDir, "");
  return files.sort();
};
var stagingDirFor = (runtimeDir) => join(runtimeDir, `.staging-${process.pid}-${Date.now().toString(36)}`);
var deployableSourceFilter = (src) => {
  const stat = lstatOrNull(src);
  if (!stat) return false;
  if (stat.isDirectory()) return true;
  return isDeployableFile(src.slice(src.lastIndexOf("/") + 1));
};
var computeRuntimeClosureDigest = (packageRoot) => {
  const hash = createHash("sha256");
  hash.update("kiro-fabric-runtime-closure-v2\0");
  hash.update(readPackageVersion() + "\0");
  const closureDir = closureSourceDirectory(packageRoot);
  const files = closureFileList(closureDir);
  for (const rel of files) {
    if (rel === "package.json") continue;
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(join(closureDir, ...rel.split("/"))));
    hash.update("\0");
  }
  for (const rel of MANAGED_RELEASE_SKILL_FILES) {
    hash.update("skills/" + rel + "\0");
    hash.update(readFileSync(managedReleaseSkillPath(packageRoot, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
};
var planRuntimeClosureDeployment = (installRoot, layout, options = {}) => {
  const packageRoot = resolveSourcePackageRoot();
  const nodeSourcePath = options.nodeSourcePath ?? process.execPath;
  const nodeAttestation = options.nodeAttestation ?? attestExecutable(nodeSourcePath);
  if (nodeAttestation.path !== resolve(nodeSourcePath)) {
    throw new KiroInstallError("concurrency", "staged Node path does not match its attestation");
  }
  assertExecutableAttestation(nodeAttestation);
  const digestHash = createHash("sha256");
  digestHash.update(computeRuntimeClosureDigest(packageRoot));
  digestHash.update("\0node\0");
  digestHash.update(nodeAttestation.sha256);
  const kiroAttestation = options.kiroAttestation;
  if (!kiroAttestation) {
    throw new KiroInstallError(
      "kiro-version",
      "runtime closure deployment requires a separately attested Kiro executable"
    );
  }
  assertExecutableAttestation(kiroAttestation);
  digestHash.update("\0kiro\0");
  digestHash.update(kiroAttestation.sha256);
  const digest = digestHash.digest("hex");
  const sourceDir = closureSourceDirectory(packageRoot);
  const sourceFiles = closureFileList(sourceDir);
  const runtimeDir = runtimeClosurePath(installRoot, layout);
  const mcpEntryPath = join(runtimeDir, digest, "kiro", "mcp-entry.js");
  const runtimeNodePath = join(runtimeDir, digest, "bin", nodeExecutableName());
  const runtimeKiroPath = join(runtimeDir, digest, "bin", process.platform === "win32" ? "kiro-cli.exe" : "kiro-cli");
  const managementEntryPath = join(runtimeDir, digest, "kiro", "management-entry.js");
  const marker = join(runtimeDir, ".closure-current");
  const markerStat = lstatOrNull(marker);
  if (markerStat && (markerStat.isSymbolicLink() || !markerStat.isFile())) {
    throw new KiroInstallError("symlink", "runtime closure marker is not a regular file");
  }
  const markerDigest = markerStat ? readFileSync(marker, "utf8").trim() : "";
  const published = existsSync(mcpEntryPath);
  const versionRoot = join(runtimeDir, digest);
  const versionStat = lstatOrNull(versionRoot);
  const runtimeRoot = relative(installRoot, versionRoot).split(sep).join("/");
  const generatedPackage = JSON.stringify({
    name: "kiro-fabric-runtime-closure",
    version: readPackageVersion(),
    digest,
    fileCount: sourceFiles.length + MANAGED_RELEASE_SKILL_FILES.length + 2
  }) + "\n";
  const attested = sourceFiles.filter((rel) => rel !== "package.json").map((rel) => ({
    path: runtimeRoot + "/" + rel,
    installedSha256: sha256Bytes(readFileSync(join(sourceDir, ...rel.split("/"))))
  }));
  for (const rel of MANAGED_RELEASE_SKILL_FILES) {
    attested.push({
      path: runtimeRoot + "/skills/" + rel,
      installedSha256: sha256Bytes(readFileSync(managedReleaseSkillPath(packageRoot, rel)))
    });
  }
  attested.push(
    { path: runtimeRoot + "/.closure-digest", installedSha256: sha256Bytes(digest + "\n") },
    { path: runtimeRoot + "/bin/" + nodeExecutableName(), installedSha256: nodeAttestation.sha256, executableMode: 365 },
    { path: runtimeRoot + "/bin/" + (process.platform === "win32" ? "kiro-cli.exe" : "kiro-cli"), installedSha256: kiroAttestation.sha256, executableMode: 365 },
    { path: runtimeRoot + "/package.json", installedSha256: sha256Bytes(generatedPackage) }
  );
  attested.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const attestation = { digest, root: runtimeRoot, files: attested };
  let damaged = false;
  if (versionStat && options.repairExisting) {
    if (versionStat.isSymbolicLink() || !versionStat.isDirectory()) {
      throw new KiroInstallError("symlink", "runtime closure version root is not a real directory");
    }
    try {
      verifyRuntimeClosureAttestation(installRoot, attestation);
    } catch (error) {
      if (!(error instanceof KiroInstallError) || error.code !== "ownership" && error.code !== "fs") {
        throw error;
      }
      damaged = true;
    }
  }
  const skillBytes = MANAGED_RELEASE_SKILL_FILES.reduce(
    (total, rel) => total + statSync(managedReleaseSkillPath(packageRoot, rel)).size,
    0
  );
  return {
    runtimeDir,
    mcpEntryPath,
    runtimeNodePath,
    runtimeKiroPath,
    managementEntryPath,
    digest,
    updated: !published || damaged,
    action: damaged ? "repair" : !published ? "publish" : markerDigest === digest ? "noop" : "activate",
    attestation,
    metrics: {
      stageMs: 0,
      publishMs: 0,
      totalMs: 0,
      fileCount: sourceFiles.length + MANAGED_RELEASE_SKILL_FILES.length + 2,
      bytes: sourceFiles.reduce(
        (total, rel) => total + statSync(join(sourceDir, ...rel.split("/"))).size,
        nodeAttestation.size + kiroAttestation.size + skillBytes
      )
    }
  };
};
var ensurePrivateRuntimeDirectory = (runtimeDir) => {
  ensureManagedDirectory(runtimeDir);
  const stat = lstatSync(runtimeDir);
  if (process.geteuid && stat.uid !== process.geteuid()) {
    throw new KiroInstallError("ownership", "managed runtime directory is not owned by the effective user");
  }
  if ((stat.mode & 511) !== 448) chmodSync(runtimeDir, 448);
  fsyncDirectory(dirname(runtimeDir));
};
var repairJournalPath = (runtimeDir, digest) => join(runtimeDir, `.repair-${digest}.json`);
var damagedGenerationPath = (runtimeDir, digest) => join(runtimeDir, `.damaged-${digest}`);
var serializeRepairJournal = (closure) => JSON.stringify({ format: 1, digest: closure.digest, root: closure.root }, null, 2) + "\n";
var runtimeClosureRepairJournalPath = (installRoot, layout, digest) => repairJournalPath(runtimeClosurePath(installRoot, layout), digest);
var hasPendingRuntimeClosureRepair = (installRoot, layout, digest) => existsSync(runtimeClosureRepairJournalPath(installRoot, layout, digest));
var makeRuntimeTreeRemovable = (dir) => {
  const stat = lstatOrNull(dir);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new KiroInstallError("symlink", "damaged runtime root is not a real directory");
  }
  chmodSync(dir, 448);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) makeRuntimeTreeRemovable(join(dir, entry.name));
  }
};
var recoverRuntimeClosureRepair = (installRoot, layout, closure) => {
  const runtimeDir = runtimeDirectoryForClosure(installRoot, layout, closure);
  const journal = repairJournalPath(runtimeDir, closure.digest);
  const journalStat = lstatOrNull(journal);
  if (!journalStat) return false;
  if (journalStat.isSymbolicLink() || !journalStat.isFile()) {
    throw new KiroInstallError("symlink", "runtime repair journal is not a regular file");
  }
  let record;
  try {
    record = JSON.parse(readFileSync(journal, "utf8"));
  } catch {
    throw new KiroInstallError("manifest", "runtime repair journal is malformed");
  }
  if (typeof record !== "object" || record === null || Array.isArray(record) || record.format !== 1 || record.digest !== closure.digest || record.root !== closure.root) {
    throw new KiroInstallError("manifest", "runtime repair journal does not match the closure");
  }
  ensurePrivateRuntimeDirectory(runtimeDir);
  const versionDir = join(runtimeDir, closure.digest);
  const damagedDir = damagedGenerationPath(runtimeDir, closure.digest);
  const versionExists = existsSync(versionDir);
  const damagedExists = existsSync(damagedDir);
  if (!versionExists && damagedExists) {
    renameSync(damagedDir, versionDir);
    fsyncDirectory(runtimeDir);
  } else if (versionExists) {
    if (damagedExists) {
      verifyRuntimeClosureAttestation(installRoot, closure);
      makeRuntimeTreeRemovable(damagedDir);
      rmSync(damagedDir, { recursive: true, force: false });
      fsyncDirectory(runtimeDir);
    } else {
      try {
        verifyRuntimeClosureAttestation(installRoot, closure);
      } catch {
      }
    }
  } else {
    throw new KiroInstallError("fs", "runtime repair lost both the original and replacement generation");
  }
  unlinkSync(journal);
  fsyncDirectory(runtimeDir);
  return true;
};
var writeClosureMarker = (runtimeDir, digest) => {
  const marker = join(runtimeDir, ".closure-current");
  const markerStat = lstatOrNull(marker);
  if (markerStat && (markerStat.isSymbolicLink() || !markerStat.isFile())) {
    throw new KiroInstallError("symlink", "runtime closure marker is not a regular file");
  }
  writeAtomic(marker, digest + "\n", 384);
};
var deployRuntimeClosure = (installRoot, layout, options) => {
  const startWall = Date.now();
  const packageRoot = resolveSourcePackageRoot();
  const kiroAttestation = options?.kiroAttestation;
  if (!kiroAttestation) {
    throw new KiroInstallError(
      "kiro-version",
      "runtime closure deployment requires a separately attested Kiro executable"
    );
  }
  const planned = planRuntimeClosureDeployment(installRoot, layout, {
    ...options?.nodeSourcePath ? { nodeSourcePath: options.nodeSourcePath } : {},
    ...options?.nodeAttestation ? { nodeAttestation: options.nodeAttestation } : {},
    kiroAttestation,
    ...options?.repairExisting ? { repairExisting: true } : {}
  });
  const digest = planned.digest;
  if (options?.expectedDigest !== void 0 && options.expectedDigest !== digest) {
    throw new KiroInstallError(
      "concurrency",
      "runtime closure changed after preflight: expected " + options.expectedDigest + ", got " + digest
    );
  }
  const runtimeDir = planned.runtimeDir;
  const versionDir = join(runtimeDir, digest);
  const versionMcpEntry = planned.mcpEntryPath;
  const marker = join(runtimeDir, ".closure-current");
  const metadata = {
    stageMs: 0,
    publishMs: 0,
    totalMs: 0,
    fileCount: 0,
    bytes: 0
  };
  if (existsSync(versionMcpEntry) && planned.action !== "repair") {
    ensurePrivateRuntimeDirectory(runtimeDir);
    verifyRuntimeClosureAttestation(installRoot, planned.attestation);
    const markerNow = lstatOrNull(marker);
    if (markerNow && (markerNow.isSymbolicLink() || !markerNow.isFile())) {
      throw new KiroInstallError("symlink", "runtime closure marker is not a regular file");
    }
    const markerDigest = markerNow ? readFileSync(marker, "utf8").trim() : "";
    if (markerDigest !== digest && options?.activate !== false) writeClosureMarker(runtimeDir, digest);
    metadata.totalMs = Date.now() - startWall;
    return {
      runtimeDir,
      mcpEntryPath: versionMcpEntry,
      runtimeNodePath: planned.runtimeNodePath,
      runtimeKiroPath: planned.runtimeKiroPath,
      managementEntryPath: planned.managementEntryPath,
      digest,
      updated: false,
      action: markerDigest === digest ? "noop" : "activate",
      attestation: planned.attestation,
      metrics: { ...metadata, fileCount: planned.metrics.fileCount, bytes: planned.metrics.bytes }
    };
  }
  ensurePrivateRuntimeDirectory(runtimeDir);
  assertNoSymlinkComponents(installRoot, versionDir);
  const closureSource = closureSourceDirectory(packageRoot);
  if (!existsSync(join(closureSource, "kiro", "mcp-entry.js"))) {
    throw new KiroInstallError(
      "fs",
      `runtime closure source not found at ${closureSource}; run the full build first`
    );
  }
  const stagingDir = stagingDirFor(runtimeDir);
  const stageStart = Date.now();
  try {
    mkdirSync(stagingDir, { recursive: true, mode: 448 });
    let bytes = 0;
    let fileCount = 0;
    cpSync(closureSource, stagingDir, {
      recursive: true,
      filter: (src) => {
        if (!deployableSourceFilter(src)) return false;
        if (!lstatOrNull(src)?.isDirectory()) bytes += statSync(src).size;
        return true;
      }
    });
    fileCount = closureFileList(stagingDir).length;
    for (const rel of MANAGED_RELEASE_SKILL_FILES) {
      const target = join(stagingDir, "skills", ...rel.split("/"));
      mkdirSync(dirname(target), { recursive: true, mode: 448 });
      copyFileSync(managedReleaseSkillPath(packageRoot, rel), target);
      bytes += statSync(target).size;
      fileCount += 1;
    }
    const stagedNode = join(stagingDir, "bin", nodeExecutableName());
    mkdirSync(dirname(stagedNode), { recursive: true, mode: 448 });
    const nodeSource = options?.nodeAttestation ?? attestExecutable(options?.nodeSourcePath ?? process.execPath);
    copyAttestedExecutable(nodeSource, stagedNode, 365);
    bytes += nodeSource.size;
    fileCount += 1;
    const stagedKiro = join(stagingDir, "bin", process.platform === "win32" ? "kiro-cli.exe" : "kiro-cli");
    const kiroSource = kiroAttestation;
    copyAttestedExecutable(kiroSource, stagedKiro, 365);
    bytes += kiroSource.size;
    fileCount += 1;
    metadata.fileCount = fileCount;
    metadata.bytes = bytes;
    writeFileSync(join(stagingDir, ".closure-digest"), digest + "\n", { mode: 420 });
    writeFileSync(join(stagingDir, "package.json"), JSON.stringify({
      name: "kiro-fabric-runtime-closure",
      version: readPackageVersion(),
      digest,
      fileCount
    }) + "\n", { mode: 420 });
    for (const file of planned.attestation.files) {
      const rel = file.path.slice(planned.attestation.root.length + 1);
      const stagedPath = join(stagingDir, ...rel.split("/"));
      if (sha256Bytes(readFileSync(stagedPath)) !== file.installedSha256) {
        throw new KiroInstallError("ownership", "staged release hash mismatch: " + rel);
      }
      if (file.executableMode !== void 0 && (statSync(stagedPath).mode & 511) !== file.executableMode) {
        throw new KiroInstallError("ownership", "staged release executable mode mismatch: " + rel);
      }
      const descriptor = openSync(stagedPath, "r");
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
    }
    const syncDirs = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) syncDirs(join(dir, entry.name));
      }
      let descriptor;
      try {
        descriptor = openSync(dir, "r");
        fsyncSync(descriptor);
      } catch {
      } finally {
        if (descriptor !== void 0) closeSync(descriptor);
      }
    };
    syncDirs(stagingDir);
    metadata.stageMs = Date.now() - stageStart;
    const seal = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) seal(full);
        else chmodSync(full, full === stagedNode || full === stagedKiro ? 365 : 292);
      }
      chmodSync(dir, 365);
    };
    seal(stagingDir);
    const publishStart = Date.now();
    if (existsSync(versionDir)) {
      if (planned.action === "repair") {
        const damagedDir = damagedGenerationPath(runtimeDir, digest);
        const journal = repairJournalPath(runtimeDir, digest);
        if (existsSync(damagedDir) || existsSync(journal)) {
          throw new KiroInstallError("concurrency", "a same-digest runtime repair is already pending recovery");
        }
        writeAtomic(journal, serializeRepairJournal(planned.attestation), 384);
        fsyncDirectory(runtimeDir);
        renameSync(versionDir, damagedDir);
        fsyncDirectory(runtimeDir);
        renameSync(stagingDir, versionDir);
        fsyncDirectory(runtimeDir);
        verifyRuntimeClosureAttestation(installRoot, planned.attestation);
        makeRuntimeTreeRemovable(damagedDir);
        rmSync(damagedDir, { recursive: true, force: false });
        fsyncDirectory(runtimeDir);
        unlinkSync(journal);
        fsyncDirectory(runtimeDir);
      } else {
        const unsealStaging = (dir) => {
          chmodSync(dir, 448);
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) unsealStaging(join(dir, entry.name));
          }
        };
        unsealStaging(stagingDir);
        rmSync(stagingDir, { recursive: true, force: true });
        verifyRuntimeClosureAttestation(installRoot, planned.attestation);
      }
    } else {
      renameSync(stagingDir, versionDir);
    }
    if (options?.activate !== false) writeClosureMarker(runtimeDir, digest);
    metadata.publishMs = Date.now() - publishStart;
    metadata.totalMs = Date.now() - startWall;
    return {
      runtimeDir,
      mcpEntryPath: versionMcpEntry,
      runtimeNodePath: planned.runtimeNodePath,
      runtimeKiroPath: planned.runtimeKiroPath,
      managementEntryPath: planned.managementEntryPath,
      digest,
      updated: true,
      action: planned.action === "repair" ? "repair" : "publish",
      attestation: planned.attestation,
      metrics: metadata
    };
  } catch (error) {
    try {
      if (hasPendingRuntimeClosureRepair(installRoot, layout, digest)) {
        recoverRuntimeClosureRepair(installRoot, layout, planned.attestation);
      }
    } catch {
    }
    try {
      const unseal = (dir) => {
        const stat = lstatOrNull(dir);
        if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return;
        chmodSync(dir, 448);
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) unseal(join(dir, entry.name));
        }
      };
      unseal(stagingDir);
      rmSync(stagingDir, { recursive: true, force: true });
    } catch {
    }
    metadata.totalMs = Date.now() - startWall;
    throw new KiroInstallError(
      "fs",
      `failed to deploy runtime closure: ${error.message}`
    );
  }
};
var publishedClosureFileList = (root) => {
  const files = [];
  const visit = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isSymbolicLink()) {
        throw new KiroInstallError("symlink", "installed runtime closure contains a symlink: " + full);
      }
      if (entry.isDirectory()) visit(full, rel);
      else if (entry.isFile()) files.push(rel);
      else throw new KiroInstallError("ownership", "installed runtime closure contains a non-file: " + full);
    }
  };
  visit(root, "");
  return files.sort();
};
var verifyRuntimeClosureAtRoot = (closure, root) => {
  const rootStat = lstatOrNull(root);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new KiroInstallError("ownership", "installed runtime closure root is missing or invalid: " + root);
  }
  const actual = publishedClosureFileList(root);
  const expected = closure.files.map((file) => file.path.slice(closure.root.length + 1));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new KiroInstallError("ownership", "installed runtime closure file set does not match manifest");
  }
  for (const file of closure.files) {
    const relativePath = file.path.slice(closure.root.length + 1);
    const path2 = join(root, ...relativePath.split("/"));
    const bytes = readFileSync(path2);
    if (sha256Bytes(bytes) !== file.installedSha256) {
      throw new KiroInstallError("ownership", "installed runtime closure hash mismatch: " + file.path);
    }
    const mode = statSync(path2).mode & 511;
    const expectedMode = file.executableMode ?? 292;
    if (mode !== expectedMode) {
      throw new KiroInstallError("ownership", "installed runtime release mode mismatch: " + file.path);
    }
  }
  const verifyDirectories = (dir) => {
    if ((statSync(dir).mode & 511) !== 365) {
      throw new KiroInstallError("ownership", "installed runtime directory is not sealed read-only: " + dir);
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) verifyDirectories(join(dir, entry.name));
    }
  };
  verifyDirectories(root);
};
var verifyRuntimeClosureAttestation = (installRoot, closure) => {
  const root = join(installRoot, ...closure.root.split("/"));
  assertNoSymlinkComponents(installRoot, root);
  verifyRuntimeClosureAtRoot(closure, root);
};
var sameHeldIdentity = (held, path2) => {
  try {
    const pathStat = lstatSync(path2, { bigint: true });
    const openStat = fstatSync(held.descriptor, { bigint: true });
    return !pathStat.isSymbolicLink() && openStat.dev === held.dev && openStat.ino === held.ino && pathStat.dev === held.dev && pathStat.ino === held.ino;
  } catch {
    return false;
  }
};
var assertPrivateOwnedDirectory = (path2, label, exactMode) => {
  if (process.platform !== "linux" && process.platform !== "darwin" || !process.geteuid) {
    throw new KiroInstallError(
      "ownership",
      "safe attested quarantine deletion is unavailable on this platform; refusing cleanup"
    );
  }
  const stat = label === "runtime" ? statSync(path2) : lstatSync(path2);
  if (!stat.isDirectory() || label !== "runtime" && stat.isSymbolicLink() || stat.uid !== process.geteuid() || (stat.mode & 63) !== 0 || exactMode !== void 0 && (stat.mode & 511) !== exactMode) {
    throw new KiroInstallError("ownership", `${label} directory is not private and owned by the effective user`);
  }
};
var holdClosureIdentity = (closure, root) => {
  const held = [];
  const hold = (path2, file) => {
    const descriptor = openSync(
      path2,
      constants.O_RDONLY | (file ? 0 : constants.O_DIRECTORY) | (constants.O_NOFOLLOW ?? 0)
    );
    const stat = fstatSync(descriptor, { bigint: true });
    const identity = { path: path2, descriptor, dev: stat.dev, ino: stat.ino, file };
    if (!sameHeldIdentity(identity, path2) || (file ? !stat.isFile() : !stat.isDirectory())) {
      closeSync(descriptor);
      throw new KiroInstallError("concurrency", "quarantined runtime identity changed while opening: " + path2);
    }
    held.push(identity);
    return identity;
  };
  try {
    hold(root, false);
    const directories = /* @__PURE__ */ new Set([root]);
    for (const record of closure.files) {
      const relativePath = record.path.slice(closure.root.length + 1);
      const path2 = join(root, ...relativePath.split("/"));
      let cursor = dirname(path2);
      while (cursor !== root) {
        directories.add(cursor);
        cursor = dirname(cursor);
      }
      const identity = hold(path2, true);
      const bytes = readFileSync(identity.descriptor);
      if (sha256Bytes(bytes) !== record.installedSha256) {
        throw new KiroInstallError("ownership", "quarantined runtime hash changed: " + record.path);
      }
    }
    for (const directory of [...directories].sort((a, b) => a.length - b.length)) {
      if (directory !== root) hold(directory, false);
    }
    return held;
  } catch (error) {
    for (const identity of held.reverse()) closeSync(identity.descriptor);
    throw error;
  }
};
var assertHeldIdentities = (held) => {
  for (const identity of held) {
    if (!sameHeldIdentity(identity, identity.path)) {
      throw new KiroInstallError("concurrency", "quarantined runtime was replaced after verification: " + identity.path);
    }
  }
};
var closeHeldIdentities = (held) => {
  for (const identity of held.reverse()) closeSync(identity.descriptor);
};
var removeAttestedRuntimeClosure = (installRoot, layout, closure) => {
  const root = join(installRoot, ...closure.root.split("/"));
  if (!existsSync(root)) return false;
  const runtimeDir = runtimeDirectoryForClosure(installRoot, layout, closure);
  return withContainedParent(installRoot, root, (parent, leaf) => {
    const source = join(parent, leaf);
    const quarantinedRoot = join(parent, `.quarantine-generation-${process.pid}-${randomBytes(8).toString("hex")}`);
    assertPrivateOwnedDirectory(parent, "runtime");
    let held = [];
    let deletionStarted = false;
    runBeforeRuntimeQuarantineForTest("generation", source);
    renameSync(source, quarantinedRoot);
    try {
      verifyRuntimeClosureAtRoot(closure, quarantinedRoot);
      chmodSync(quarantinedRoot, 448);
      assertPrivateOwnedDirectory(quarantinedRoot, "quarantine", 448);
      held = holdClosureIdentity(closure, quarantinedRoot);
      runBeforeRuntimeQuarantineForTest("generation-post-verify", quarantinedRoot);
      assertHeldIdentities(held);
      const unsealDirectories = (dir) => {
        chmodSync(dir, 448);
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) unsealDirectories(join(dir, entry.name));
        }
      };
      deletionStarted = true;
      unsealDirectories(quarantinedRoot);
      assertHeldIdentities(held);
      rmSync(quarantinedRoot, { recursive: true, force: false });
      for (const identity of held) {
        if (fstatSync(identity.descriptor).nlink !== 0) {
          throw new KiroInstallError("concurrency", "verified runtime inode survived quarantine deletion");
        }
      }
      return true;
    } catch (error) {
      const rootIdentity = held.find((identity) => identity.path === quarantinedRoot);
      if (!deletionStarted && (!rootIdentity || sameHeldIdentity(rootIdentity, quarantinedRoot)) && existsSync(quarantinedRoot) && !existsSync(source)) {
        chmodSync(quarantinedRoot, 365);
        renameSync(quarantinedRoot, source);
      }
      throw error;
    } finally {
      closeHeldIdentities(held);
    }
  });
};
var removeRuntimeActivationMarker = (installRoot, layout, expectedDigest, closure) => {
  if (closure && closure.digest !== expectedDigest) {
    throw new KiroInstallError("ownership", "runtime activation digest differs from its closure");
  }
  const runtimeDir = closure ? runtimeDirectoryForClosure(installRoot, layout, closure) : runtimeClosurePath(installRoot, layout);
  const marker = join(runtimeDir, ".closure-current");
  const markerStat = lstatOrNull(marker);
  if (!markerStat) return false;
  withContainedParent(installRoot, marker, (parent, leaf) => {
    const source = join(parent, leaf);
    const quarantinedMarker = join(parent, `.quarantine-marker-${process.pid}-${randomBytes(8).toString("hex")}`);
    assertPrivateOwnedDirectory(parent, "runtime");
    let held;
    runBeforeRuntimeQuarantineForTest("marker", source);
    renameSync(source, quarantinedMarker);
    try {
      const descriptor = openSync(quarantinedMarker, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = fstatSync(descriptor, { bigint: true });
      held = { path: quarantinedMarker, descriptor, dev: stat.dev, ino: stat.ino, file: true };
      if (!stat.isFile() || !sameHeldIdentity(held, quarantinedMarker)) {
        throw new KiroInstallError("symlink", "runtime closure marker is invalid");
      }
      if (readFileSync(descriptor, "utf8").trim() !== expectedDigest) {
        throw new KiroInstallError("ownership", "runtime closure marker changed during cleanup");
      }
      runBeforeRuntimeQuarantineForTest("marker-post-verify", quarantinedMarker);
      if (!sameHeldIdentity(held, quarantinedMarker)) {
        throw new KiroInstallError("concurrency", "runtime closure marker was replaced after verification");
      }
      unlinkSync(quarantinedMarker);
      if (fstatSync(descriptor).nlink !== 0) {
        throw new KiroInstallError("concurrency", "verified activation marker inode survived deletion");
      }
    } catch (error) {
      if ((!held || sameHeldIdentity(held, quarantinedMarker)) && existsSync(quarantinedMarker) && !existsSync(source)) {
        renameSync(quarantinedMarker, source);
      }
      throw error;
    } finally {
      if (held) closeSync(held.descriptor);
    }
  });
  if (existsSync(runtimeDir) && readdirSync(runtimeDir).length === 0) rmdirSync(runtimeDir);
  return true;
};

// src/kiro/skills.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
var MANAGED_SKILL_FILES = [
  "fabric-exec/SKILL.md",
  "fabric-exec/references/agents.md",
  "fabric-exec/references/mcp.md",
  "fabric-guide/SKILL.md",
  "fabric-review/SKILL.md",
  "fabric-workflow/SKILL.md"
];
var skillPrefix = (layout) => layout === "project" ? ".kiro/skills" : "skills";
var managedKiroSkillSources = (installRoot, layout) => {
  const packageRoot = resolveSourcePackageRoot();
  return MANAGED_SKILL_FILES.map((sourceRelative) => {
    const installedRelative = skillPrefix(layout) + "/" + sourceRelative;
    const strictSource = join2(packageRoot, "strict", "skills", ...sourceRelative.split("/"));
    const bytes = readFileSync2(existsSync2(strictSource) ? strictSource : join2(packageRoot, "skills", ...sourceRelative.split("/")));
    return {
      sourceRelative,
      installedRelative,
      installedPath: join2(installRoot, ...installedRelative.split("/")),
      bytes,
      sha256: sha256Bytes(bytes)
    };
  });
};
var managedKiroSkillBundleSha256 = (sources) => {
  const hash = createHash2("sha256");
  hash.update("kiro-fabric-managed-skills-v1\0");
  for (const source of sources) {
    hash.update(source.sourceRelative);
    hash.update("\0");
    hash.update(source.bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
};
var managedKiroSkillResources = (layout) => ["fabric-exec", "fabric-guide", "fabric-review", "fabric-workflow"].map(
  (name) => layout === "project" ? `skill://.kiro/skills/${name}/SKILL.md` : `skill:///skills/${name}/SKILL.md`
);

// src/kiro/install.ts
var execFileAsync = promisify(execFile);
var buildManifest = (options, projectRoot, layout, profileDigest, backup, skills, closure, previous, grants) => ({
  format: closure ? KIRO_INSTALL_MANIFEST_FORMAT : 1,
  owner: "kiro-fabric",
  packageVersion: readPackageVersion(),
  projectRoot,
  profile: {
    path: managedPaths(projectRoot, layout).profileRelative,
    installedSha256: profileDigest,
    ...backup ? { backup } : {}
  },
  runtime: {
    nodePath: options.nodePath,
    mcpEntryPath: options.mcpEntryPath,
    ...options.kiroIdentity ? {
      kiroBinaryPath: closure?.runtimeKiroPath ?? options.kiroIdentity.sourcePath,
      kiroSourcePath: options.kiroIdentity.sourcePath,
      kiroSha256: options.kiroIdentity.sha256
    } : {},
    kiroCliVersion: options.kiroIdentity?.version ?? KIRO_CLI_VERSION,
    agentEngine: KIRO_AGENT_ENGINE,
    ...closure ? {
      closure: closure.attestation,
      // Keep launch/status verification and eventual uninstall bounded:
      // current plus the immediately preceding active generation only.
      generations: [
        closure.attestation,
        ...previous?.runtime.closure && previous.runtime.closure.root !== closure.attestation.root ? [previous.runtime.closure] : []
      ],
      managerEntryPath: closure.managementEntryPath,
      nodeSha256: closure.attestation.files.find((file) => file.path.endsWith("/bin/node") || file.path.endsWith("/bin/node.exe")).installedSha256
    } : {}
  },
  ...closure ? {
    skills: {
      bundleSha256: managedKiroSkillBundleSha256(skills),
      files: skills.map((skill) => ({
        path: skill.installedRelative,
        installedSha256: skill.sha256,
        ...skill.backup ? { backup: skill.backup } : {}
      })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    }
  } : {},
  grants,
  ...layout === "user" ? { scope: "user" } : {}
});
var backupRecordsEqual = (left, right) => {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.path === right.path && left.sha256 === right.sha256;
};
var manifestIsCurrent = (existing, desired) => existing.format === desired.format && existing.packageVersion === desired.packageVersion && existing.runtime.nodePath === desired.runtime.nodePath && existing.runtime.mcpEntryPath === desired.runtime.mcpEntryPath && existing.runtime.kiroBinaryPath === desired.runtime.kiroBinaryPath && existing.runtime.kiroSourcePath === desired.runtime.kiroSourcePath && existing.runtime.kiroCliVersion === desired.runtime.kiroCliVersion && existing.runtime.kiroSha256 === desired.runtime.kiroSha256 && existing.runtime.agentEngine === desired.runtime.agentEngine && existing.runtime.managerEntryPath === desired.runtime.managerEntryPath && existing.runtime.nodeSha256 === desired.runtime.nodeSha256 && JSON.stringify(existing.grants ?? null) === JSON.stringify(desired.grants ?? null) && existing.profile.installedSha256 === desired.profile.installedSha256 && existing.profile.path === desired.profile.path && backupRecordsEqual(existing.profile.backup, desired.profile.backup) && JSON.stringify(existing.skills ?? null) === JSON.stringify(desired.skills ?? null) && JSON.stringify(existing.runtime.closure ?? null) === JSON.stringify(desired.runtime.closure ?? null) && JSON.stringify(existing.runtime.generations ?? (existing.runtime.closure ? [existing.runtime.closure] : null)) === JSON.stringify(desired.runtime.generations ?? null);
var readManagedKiroGrants = (options = {}) => {
  const roots = resolveKiroInstallRoots(options);
  const manifest = readManifest(roots.installRoot, roots.layout);
  if (!manifest) return null;
  const profile = readManagedFileNoFollow(
    roots.installRoot,
    kiroProfilePath(roots.installRoot, roots.layout)
  );
  if (!profile || sha256Bytes(profile) !== manifest.profile.installedSha256) {
    throw new KiroInstallError("ownership", "cannot preserve grants from an unverified managed profile");
  }
  try {
    const document = JSON.parse(profile.toString("utf8"));
    const env = document.mcpServers?.fabric?.env ?? {};
    const grants = {
      allowShell: env.KIRO_FABRIC_ALLOW_SHELL === "1",
      enableSubagents: env.KIRO_FABRIC_ENABLE_SUBAGENTS === "1",
      allowTools: env.KIRO_FABRIC_ALLOW_TOOLS === "1"
    };
    if (grants.enableSubagents && !grants.allowShell) {
      throw new Error("subagent grant lacks shell grant");
    }
    if (manifest.grants && JSON.stringify(manifest.grants) !== JSON.stringify(grants)) {
      throw new Error("manifest grant state differs from the verified profile");
    }
    return grants;
  } catch (error) {
    throw new KiroInstallError(
      "manifest",
      "cannot recover advanced grants from the managed profile: " + (error instanceof Error ? error.message : String(error))
    );
  }
};
var findNameCollision = (agentsDir, ownProfilePath) => {
  const stat = lstatOrNull(agentsDir);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return null;
  for (const entry of readdirSync2(agentsDir)) {
    const candidate = join3(agentsDir, entry);
    if (candidate === ownProfilePath) continue;
    const entryStat = lstatOrNull(candidate);
    const extension = extname(entry).toLowerCase();
    if (!entryStat?.isFile() || entryStat.isSymbolicLink() || ![".json", ".md"].includes(extension)) {
      continue;
    }
    const filenameName = basename2(entry, extension);
    try {
      const source = readFileSync3(candidate, "utf8");
      let declaredName;
      if (extension === ".json") {
        const parsed = JSON.parse(source);
        declaredName = typeof parsed.name === "string" ? parsed.name : filenameName;
      } else {
        const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/u.exec(source);
        const parsed = frontmatter ? (0, import_yaml.parse)(frontmatter[1]) : void 0;
        declaredName = parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.name === "string" ? parsed.name : filenameName;
      }
      if (declaredName === "kiro-fabric") return candidate;
    } catch {
      if (filenameName === "kiro-fabric") return candidate;
    }
  }
  return null;
};
var planKiroProfileInstall = (options = {}, planning = {}) => {
  const { layout, installRoot, projectRoot: root } = resolveKiroInstallRoots(options);
  const nodePath = options.nodePath ?? process.execPath;
  const mcpEntryPath = options.mcpEntryPath ?? defaultMcpEntryPath();
  if (!isAbsolute(mcpEntryPath)) {
    throw new KiroInstallError("fs", `MCP entry path must be absolute: ${mcpEntryPath}`);
  }
  if (!planning.allowMissingMcpEntry && !existsSync3(mcpEntryPath)) {
    throw new KiroInstallError("fs", `MCP entry not found (run pnpm build first): ${mcpEntryPath}`);
  }
  assertManagedTree(installRoot, layout);
  const paths = managedPaths(installRoot, layout);
  const profilePath = kiroProfilePath(installRoot, layout);
  const skillSources = planning.closure ? managedKiroSkillSources(installRoot, layout) : [];
  const skillBundleSha256 = planning.closure ? managedKiroSkillBundleSha256(skillSources) : void 0;
  const profile = generateKiroProfile({
    projectRoot: root,
    mcpEntryPath,
    nodePath,
    ...layout === "user" ? { kiroHome: installRoot } : {},
    ...planning.kiroIdentity ? {
      kiroBinaryPath: planning.closure?.runtimeKiroPath ?? planning.kiroIdentity.sourcePath,
      kiroCliVersion: planning.kiroIdentity.version,
      kiroSha256: planning.kiroIdentity.sha256
    } : {},
    ...options.allowShell ? { allowShell: true } : {},
    ...options.enableSubagents ? { enableSubagents: true } : {},
    ...options.allowTools ? { allowTools: true } : {},
    ...planning.closure ? {
      resources: managedKiroSkillResources(layout),
      skillBundleSha256
    } : {}
  });
  const profileEnv = profile.mcpServers.fabric?.env;
  if (profileEnv?.KIRO_FABRIC_ENFORCE_PROJECT_ROOT === "1") {
    resolveKiroMcpLaunchEnvironment(profileEnv, root);
  }
  const profileJson = serializeJson(profile);
  const profileSha256 = sha256Bytes(profileJson);
  const collision = findNameCollision(paths.agentsDir, profilePath) ?? (layout === "user" && resolve2(root) !== resolve2(installRoot) ? findNameCollision(join3(root, ".kiro", "agents"), profilePath) : null);
  if (collision) {
    throw new KiroInstallError(
      "collision",
      `another profile already declares or can resolve as name "kiro-fabric": ${collision}`
    );
  }
  const manifest = readManifest(installRoot, layout);
  const activeGeneration = manifest?.runtime.closure;
  if (activeGeneration) {
    const generationRoot = join3(installRoot, ...activeGeneration.root.split("/"));
    const repairingPlannedGeneration = options.repairRuntime === true && activeGeneration.digest === planning.closure?.digest;
    if (existsSync3(generationRoot) && !repairingPlannedGeneration) {
      verifyRuntimeClosureAttestation(installRoot, activeGeneration);
    }
  }
  let existingSha256 = null;
  let existingBytes = null;
  const profileStat = lstatOrNull(profilePath);
  if (profileStat) {
    if (profileStat.isSymbolicLink()) {
      throw new KiroInstallError("symlink", `refusing profile symlink: ${profilePath}`);
    }
    if (!profileStat.isFile()) {
      throw new KiroInstallError(
        "collision",
        `profile target is not a regular file: ${profilePath}`
      );
    }
    existingBytes = readFileSync3(profilePath);
    existingSha256 = sha256Bytes(existingBytes);
  }
  let action;
  let blockedReason = null;
  let requiresForce = false;
  if (existingSha256 === null) {
    action = manifest ? "repair" : "create";
  } else if (existingSha256 === profileSha256) {
    action = manifest ? "noop" : "adopt";
  } else if (manifest) {
    if (existingSha256 === manifest.profile.installedSha256) {
      action = "update";
    } else {
      action = options.force ? "update" : "blocked";
      if (!options.force) {
        blockedReason = "profile modified externally; use --force to overwrite";
        requiresForce = true;
      }
    }
  } else {
    action = options.force ? "create" : "blocked";
    if (!options.force) {
      blockedReason = "unmanaged profile exists; use --force to back up and replace";
      requiresForce = true;
    }
  }
  if (options.force && action === "blocked") {
    action = manifest ? "update" : "create";
  }
  let backupRecord = null;
  let captureBackup = false;
  const captureCurrent = () => {
    if (!existingSha256) return;
    backupRecord = {
      path: backupRelativePath(existingSha256, layout),
      sha256: existingSha256
    };
    captureBackup = true;
  };
  if (action === "adopt" || action === "create" && existingBytes) {
    captureCurrent();
  } else if (action === "update" && options.force && manifest && existingSha256 && existingSha256 !== manifest.profile.installedSha256) {
    captureCurrent();
  } else if ((action === "update" || action === "repair" || action === "noop") && manifest?.profile.backup) {
    backupRecord = manifest.profile.backup;
    assertBackupBytes(installRoot, backupRecord);
  }
  const previousSkills = new Map(
    (manifest?.skills?.files ?? []).map((file) => [file.path, file])
  );
  const skillPlans = skillSources.map((source) => {
    assertNoSymlinkComponents(installRoot, source.installedPath);
    const stat = lstatOrNull(source.installedPath);
    if (stat && (stat.isSymbolicLink() || !stat.isFile())) {
      throw new KiroInstallError(
        "collision",
        "managed skill target is not a regular file: " + source.installedPath
      );
    }
    const current = stat ? readFileSync3(source.installedPath) : null;
    const currentHash = current ? sha256Bytes(current) : null;
    const previous = previousSkills.get(source.installedRelative);
    let backup = previous?.backup ?? null;
    let capture = false;
    const captureCurrentSkill = () => {
      if (!currentHash) return;
      backup = { path: backupRelativePath(currentHash, layout), sha256: currentHash };
      capture = true;
    };
    if (previous) {
      if (currentHash !== null && currentHash !== previous.installedSha256) {
        if (!options.force) {
          action = "blocked";
          blockedReason ??= "managed skill modified externally; use --force to overwrite: " + source.installedRelative;
          requiresForce = true;
        } else {
          captureCurrentSkill();
        }
      } else if (backup) {
        assertBackupBytes(installRoot, backup);
      }
    } else if (currentHash !== null) {
      if (currentHash !== source.sha256 && !options.force) {
        action = "blocked";
        blockedReason ??= "unmanaged skill exists; use --force to back up and replace: " + source.installedRelative;
        requiresForce = true;
      } else {
        captureCurrentSkill();
      }
    }
    return {
      ...source,
      existingSha256: currentHash,
      backupPath: backup ? join3(installRoot, ...backup.path.split("/")) : null,
      backup,
      captureBackup: capture
    };
  });
  const grantsAfter = {
    allowShell: options.allowShell === true,
    enableSubagents: options.enableSubagents === true,
    allowTools: options.allowTools === true
  };
  const inferredBefore = manifest ? manifest.grants ?? (() => {
    if (!existingBytes || sha256Bytes(existingBytes) !== manifest.profile.installedSha256) return null;
    try {
      const document = JSON.parse(existingBytes.toString("utf8"));
      const env = document.mcpServers?.fabric?.env ?? {};
      return {
        allowShell: env.KIRO_FABRIC_ALLOW_SHELL === "1",
        enableSubagents: env.KIRO_FABRIC_ENABLE_SUBAGENTS === "1",
        allowTools: env.KIRO_FABRIC_ALLOW_TOOLS === "1"
      };
    } catch {
      return null;
    }
  })() : null;
  const desiredManifest = buildManifest(
    {
      nodePath,
      mcpEntryPath,
      ...planning.kiroIdentity ? { kiroIdentity: planning.kiroIdentity } : {}
    },
    root,
    layout,
    profileSha256,
    backupRecord,
    skillPlans,
    planning.closure,
    manifest,
    grantsAfter
  );
  if (action === "noop" && manifest && !manifestIsCurrent(manifest, desiredManifest)) {
    action = "update";
  }
  const backupPath = backupRecord ? join3(installRoot, ...backupRecord.path.split("/")) : null;
  const activation = planning.closure ? (() => {
    const path2 = join3(runtimeClosurePath(installRoot, layout), ".closure-current");
    const current = readManagedFileNoFollow(installRoot, path2);
    return {
      path: path2,
      expectedSha256: current === null ? null : sha256Bytes(current),
      nextBytes: planning.closure.digest + "\n"
    };
  })() : null;
  return {
    projectRoot: root,
    installRoot,
    layout,
    profilePath,
    manifestPath: paths.manifest,
    backupDir: paths.backupDir,
    action,
    profileJson,
    profileSha256,
    manifestJson: serializeJson(desiredManifest),
    existingSha256,
    backupPath,
    captureBackup,
    blockedReason,
    requiresForce,
    skills: skillPlans,
    activation,
    grants: {
      before: inferredBefore,
      after: grantsAfter,
      changed: Object.keys(grantsAfter).filter(
        (key) => inferredBefore ? inferredBefore[key] !== grantsAfter[key] : grantsAfter[key]
      )
    }
  };
};
var runKiro = async (kiro, args) => {
  const staged = typeof kiro === "string" ? await assertSupportedKiro(kiro) : void 0;
  const identity = typeof kiro === "string" ? staged : kiro;
  try {
    assertExecutableAttestation(identity);
    const { stdout, stderr } = await execFileAsync(identity.executablePath, args, {
      timeout: 2e4,
      maxBuffer: 1024 * 1024,
      encoding: "utf8"
    });
    assertExecutableAttestation(identity);
    return { stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    const err = error;
    const detail = `${err.stdout ?? ""}
${err.stderr ?? ""}`.trim();
    const timedOut = err.killed === true || err.code === "ETIMEDOUT" || err.signal === "SIGTERM";
    throw new KiroInstallError(
      "kiro-validate",
      `kiro-cli ${args.join(" ")} ${timedOut ? "timed out" : "failed"}` + (detail ? `: ${detail.slice(0, 2e3)}` : `: ${err.message ?? String(error)}`)
    );
  } finally {
    staged?.dispose();
  }
};
var assertKiroVersion = async (kiroBinary = "kiro-cli") => {
  try {
    return await assertSupportedKiro(kiroBinary);
  } catch (error) {
    throw new KiroInstallError(
      "kiro-version",
      error instanceof Error ? error.message : String(error)
    );
  }
};
var assertKiroV3Capabilities = async (kiro = "kiro-cli") => {
  const { stdout, stderr } = await runKiro(kiro, ["acp", "--help"]);
  const text = `${stdout}
${stderr}`;
  if (!/--agent-engine\b/.test(text) || !/\bv3\b/.test(text) || !/--auth-method\b/.test(text) || !/\bcli\b/.test(text)) {
    throw new KiroInstallError(
      "kiro-version",
      "kiro-cli does not advertise the required v3 ACP engine with CLI-owned authentication"
    );
  }
};
var ERROR_DIAGNOSTIC = /^\s*(?:error|fatal|invalid)\s*[:\[]/imu;
var validateKiroProfile = async (profileJson, kiro = "kiro-cli") => {
  const dir = await mkdtemp(join3(tmpdir(), "kiro-fabric-kiro-validate-"));
  try {
    const candidate = join3(dir, "profile.json");
    await writeFile(candidate, profileJson, { mode: 384 });
    const { stdout, stderr } = await runKiro(kiro, [
      "agent",
      "validate",
      "--path",
      candidate
    ]);
    const combined = `${stdout}
${stderr}`;
    if (ERROR_DIAGNOSTIC.test(combined)) {
      throw new KiroInstallError(
        "kiro-validate",
        `kiro-cli agent validate reported an error: ${combined.trim().slice(0, 2e3)}`
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
var resultFromPlan = (plan, dryRun, runtimeClosure) => {
  const operations = [];
  if (runtimeClosure) {
    operations.push({
      kind: "runtime",
      action: runtimeClosure.action === "noop" ? "noop" : runtimeClosure.action,
      path: join3(runtimeClosure.runtimeDir, runtimeClosure.digest),
      sha256: runtimeClosure.digest
    });
  }
  operations.push({
    kind: "profile",
    action: plan.existingSha256 === null ? "create" : plan.existingSha256 === plan.profileSha256 ? "noop" : "update",
    path: plan.profilePath,
    sha256: plan.profileSha256
  });
  for (const skill of plan.skills) {
    operations.push({
      kind: "skill",
      action: skill.existingSha256 === null ? "create" : skill.existingSha256 === skill.sha256 ? "noop" : "update",
      path: skill.installedPath,
      sha256: skill.sha256
    });
  }
  operations.push({
    kind: "manifest",
    action: plan.action === "create" || plan.action === "adopt" ? "create" : plan.action === "noop" ? "noop" : "update",
    path: plan.manifestPath,
    sha256: sha256Bytes(plan.manifestJson)
  });
  return {
    ok: true,
    dryRun,
    action: plan.action,
    projectRoot: plan.projectRoot,
    profilePath: plan.profilePath,
    manifestPath: plan.manifestPath,
    backupPath: plan.backupPath,
    profileSha256: plan.profileSha256,
    ...runtimeClosure ? { runtimeClosure } : {},
    operations,
    grants: plan.grants
  };
};
var cleanupSupersededRuntimeGenerations = (plan) => {
  const previous = readManifest(plan.installRoot, plan.layout);
  if (!previous?.runtime.closure) return;
  const desired = JSON.parse(plan.manifestJson);
  const retained = new Set((desired.runtime.generations ?? []).map((generation) => generation.root));
  for (const generation of previous.runtime.generations ?? [previous.runtime.closure]) {
    if (generation.root !== previous.runtime.closure.root && !retained.has(generation.root)) {
      removeAttestedRuntimeClosure(plan.installRoot, plan.layout, generation);
    }
  }
};
var commitInstall = (plan) => {
  if (plan.action === "blocked") {
    throw new KiroInstallError("collision", plan.blockedReason ?? "profile collision");
  }
  const paths = managedPaths(plan.installRoot, plan.layout);
  assertManagedTree(plan.installRoot, plan.layout);
  if (plan.layout === "project") {
    ensureManagedDirectory(join3(plan.installRoot, ".kiro"));
  }
  ensureManagedDirectory(paths.agentsDir);
  ensureManagedDirectory(paths.manifestDir);
  ensureManagedDirectory(plan.backupDir);
  assertManagedTree(plan.installRoot, plan.layout);
  if (plan.captureBackup && plan.backupPath && plan.existingSha256) {
    const current = readManagedFileNoFollow(plan.installRoot, plan.profilePath);
    if (current === null || sha256Bytes(current) !== plan.existingSha256) {
      throw new KiroInstallError(
        "concurrency",
        `profile changed while installing: ${plan.profilePath}`
      );
    }
    const existingBackup = lstatOrNull(plan.backupPath);
    if (!existingBackup) {
      writeExclusive(plan.backupPath, current, 384);
    } else {
      assertNoSymlinkComponents(plan.installRoot, plan.backupPath);
      if (existingBackup.isSymbolicLink() || !existingBackup.isFile()) {
        throw new KiroInstallError("backup", `backup target is not a regular file: ${plan.backupPath}`);
      }
      if (sha256Bytes(readFileSync3(plan.backupPath)) !== plan.existingSha256) {
        throw new KiroInstallError("backup", `recorded backup hash mismatch: ${plan.backupPath}`);
      }
    }
  } else if (plan.backupPath) {
    const manifest = JSON.parse(plan.manifestJson);
    if (manifest.profile.backup) assertBackupBytes(plan.installRoot, manifest.profile.backup);
  }
  for (const skill of plan.skills) {
    const current = readManagedFileNoFollow(plan.installRoot, skill.installedPath);
    const currentHash = current === null ? null : sha256Bytes(current);
    if (currentHash !== skill.existingSha256) {
      throw new KiroInstallError(
        "concurrency",
        "managed skill changed while installing: " + skill.installedPath
      );
    }
    if (skill.captureBackup && skill.backupPath && current) {
      const existingBackup = lstatOrNull(skill.backupPath);
      if (!existingBackup) {
        writeExclusive(skill.backupPath, current, 384);
      } else {
        assertNoSymlinkComponents(plan.installRoot, skill.backupPath);
        if (existingBackup.isSymbolicLink() || !existingBackup.isFile()) {
          throw new KiroInstallError("backup", "skill backup target is not a regular file");
        }
        if (sha256Bytes(readFileSync3(skill.backupPath)) !== skill.existingSha256) {
          throw new KiroInstallError("backup", "skill backup hash mismatch");
        }
      }
    } else if (skill.backup) {
      assertBackupBytes(plan.installRoot, skill.backup);
    }
  }
  const currentManifest = readManagedFileNoFollow(plan.installRoot, plan.manifestPath);
  commitManagedFileTransaction(
    plan.installRoot,
    plan.layout,
    "install",
    [
      ...plan.activation ? [{
        path: plan.activation.path,
        transition: managedFileTransition(
          plan.activation.expectedSha256,
          plan.activation.nextBytes
        )
      }] : [],
      {
        path: plan.profilePath,
        transition: managedFileTransition(plan.existingSha256, plan.profileJson)
      },
      ...plan.skills.map((skill) => ({
        path: skill.installedPath,
        transition: managedFileTransition(skill.existingSha256, skill.bytes)
      })),
      {
        path: plan.manifestPath,
        transition: managedFileTransition(
          currentManifest === null ? null : sha256Bytes(currentManifest),
          plan.manifestJson
        )
      }
    ]
  );
  fsyncDirectory(paths.agentsDir);
  if (plan.skills.length > 0) fsyncDirectory(paths.skillsDir);
  fsyncDirectory(paths.manifestDir);
};
var installKiroProfile = async (options = {}) => {
  const testOverrides = currentKiroInstallTestOverrides();
  const skipRuntimeClosure = testOverrides?.skipRuntimeClosure === true;
  const runtimeNodeSourcePath = testOverrides?.runtimeNodeSourcePath;
  if (options.enableSubagents === true) {
    const fabricConfig = options.fabricConfig ?? inspectFabricConfig({
      cwd: options.projectRoot ?? process.cwd(),
      agentDir: resolveAgentDir(),
      projectTrusted: false
    });
    assertKiroAccountingCompatible(fabricConfig.agents, true);
  }
  let stagedNodeDir;
  let stagedNode;
  let kiroIdentity;
  try {
    if (!skipRuntimeClosure) {
      stagedNodeDir = mkdtempSync(join3(tmpdir(), "kiro-fabric-node-stage-"));
      const source = attestExecutable(runtimeNodeSourcePath ?? options.nodePath ?? process.execPath);
      stagedNode = copyAttestedExecutable(source, join3(stagedNodeDir, process.platform === "win32" ? "node.exe" : "node"));
    }
    let nodeIdentity;
    try {
      nodeIdentity = await assertSupportedNode(
        runtimeNodeSourcePath ? options.nodePath ?? process.execPath : stagedNode?.path ?? options.nodePath ?? process.execPath
      );
    } catch (error) {
      throw new KiroInstallError(
        "kiro-version",
        error instanceof Error ? error.message : String(error)
      );
    }
    const requestedKiroBinary = options.kiroBinary ?? "kiro-cli";
    kiroIdentity = await assertKiroVersion(requestedKiroBinary);
    const kiroBinary = kiroIdentity.executablePath;
    await assertKiroV3Capabilities(kiroIdentity);
    const roots = resolveKiroInstallRoots(options);
    const recoveryPaths = managedPaths(roots.installRoot, roots.layout);
    if (existsSync3(recoveryPaths.transaction)) {
      if (options.dryRun) {
        probeManagedTransactionRecovery(roots.installRoot, roots.layout);
        throw new KiroInstallError(
          "concurrency",
          "a recoverable lifecycle transaction is pending; dry-run left it unchanged"
        );
      }
      const recoveryLock = acquireOperationLock(roots.installRoot, roots.layout);
      try {
        recoverManagedTransaction(roots.installRoot, roots.layout);
      } finally {
        recoveryLock.release();
      }
    }
    if (options.repairRuntime) {
      const existingClosure = readManifest(roots.installRoot, roots.layout)?.runtime.closure;
      if (existingClosure) {
        const sourceRoot = resolve2(resolveSourcePackageRoot());
        const installedReleaseRoot = resolve2(
          roots.installRoot,
          ...existingClosure.root.split("/")
        );
        if (sourceRoot === installedReleaseRoot) {
          try {
            verifyRuntimeClosureAttestation(roots.installRoot, existingClosure);
          } catch {
            throw new KiroInstallError(
              "ownership",
              "installed release is damaged and cannot be its own repair source; run repair from a trusted package or source bootstrap artifact"
            );
          }
        }
      }
    }
    const closurePlan = skipRuntimeClosure ? void 0 : planRuntimeClosureDeployment(roots.installRoot, roots.layout, {
      nodeSourcePath: stagedNode.path,
      nodeAttestation: stagedNode,
      kiroAttestation: kiroIdentity,
      ...options.repairRuntime ? { repairExisting: true } : {}
    });
    if (options.dryRun && closurePlan && hasPendingRuntimeClosureRepair(roots.installRoot, roots.layout, closurePlan.digest)) {
      throw new KiroInstallError(
        "concurrency",
        "a recoverable runtime repair is pending; dry-run left it unchanged"
      );
    }
    const effectiveMcpEntry = closurePlan?.mcpEntryPath ?? options.mcpEntryPath;
    const planOptions = {
      ...options,
      nodePath: closurePlan?.runtimeNodePath ?? nodeIdentity.executablePath,
      kiroBinary,
      ...effectiveMcpEntry ? { mcpEntryPath: effectiveMcpEntry } : {}
    };
    const planned = planKiroProfileInstall(planOptions, {
      allowMissingMcpEntry: closurePlan?.action === "publish" || closurePlan?.action === "repair",
      ...closurePlan ? { closure: closurePlan } : {},
      kiroIdentity
    });
    if (planned.action === "blocked") {
      throw new KiroInstallError("collision", planned.blockedReason ?? "profile collision");
    }
    await validateKiroProfile(planned.profileJson, kiroIdentity);
    if (options.dryRun) return resultFromPlan(planned, true, closurePlan);
    const lock = acquireOperationLock(planned.installRoot, planned.layout);
    try {
      recoverManagedTransaction(planned.installRoot, planned.layout);
      if (closurePlan) recoverRuntimeClosureRepair(roots.installRoot, roots.layout, closurePlan.attestation);
      if (stagedNode) assertExecutableAttestation(stagedNode);
      assertSupportedKiroUnchanged(kiroIdentity);
      const lockedClosurePlan = skipRuntimeClosure ? void 0 : planRuntimeClosureDeployment(roots.installRoot, roots.layout, {
        nodeSourcePath: stagedNode.path,
        nodeAttestation: stagedNode,
        kiroAttestation: kiroIdentity,
        ...options.repairRuntime ? { repairExisting: true } : {}
      });
      if (closurePlan && lockedClosurePlan?.digest !== closurePlan.digest) {
        throw new KiroInstallError("concurrency", "runtime closure changed after preflight");
      }
      const lockedMcpEntry = lockedClosurePlan?.mcpEntryPath ?? options.mcpEntryPath;
      assertSupportedKiroUnchanged(kiroIdentity);
      const lockedKiroIdentity = kiroIdentity;
      const lockedOptions = {
        ...options,
        nodePath: lockedClosurePlan?.runtimeNodePath ?? nodeIdentity.executablePath,
        kiroBinary,
        ...lockedMcpEntry ? { mcpEntryPath: lockedMcpEntry } : {}
      };
      const plan = planKiroProfileInstall(lockedOptions, {
        allowMissingMcpEntry: lockedClosurePlan?.action === "publish" || lockedClosurePlan?.action === "repair",
        ...lockedClosurePlan ? { closure: lockedClosurePlan } : {},
        kiroIdentity: lockedKiroIdentity
      });
      if (plan.action === "blocked") {
        throw new KiroInstallError("collision", plan.blockedReason ?? "profile collision");
      }
      if (plan.profileSha256 !== planned.profileSha256) {
        throw new KiroInstallError("concurrency", "generated profile changed after preflight");
      }
      const closureResult = lockedClosurePlan ? deployRuntimeClosure(roots.installRoot, roots.layout, {
        ...options.force !== void 0 ? { force: options.force } : {},
        expectedDigest: lockedClosurePlan.digest,
        nodeSourcePath: stagedNode.path,
        nodeAttestation: stagedNode,
        kiroAttestation: lockedKiroIdentity,
        ...options.repairRuntime ? { repairExisting: true } : {},
        activate: false
      }) : void 0;
      const activationCurrent = plan.activation ? readManagedFileNoFollow(plan.installRoot, plan.activation.path) : null;
      const activationNeeded = plan.activation !== null && sha256Bytes(plan.activation.nextBytes) !== (activationCurrent === null ? null : sha256Bytes(activationCurrent));
      if (plan.action !== "noop" || activationNeeded) {
        cleanupSupersededRuntimeGenerations(plan);
        commitInstall(plan);
      }
      return resultFromPlan(plan, false, closureResult);
    } finally {
      lock.release();
    }
  } finally {
    kiroIdentity?.dispose();
    if (stagedNodeDir) rmSync2(stagedNodeDir, { recursive: true, force: true });
  }
};

// src/kiro/doctor.ts
var defaultMcpEntry = () => {
  const layout = join4(import.meta.dirname, "mcp-entry.js");
  if (existsSync4(layout)) return layout;
  return resolve3(import.meta.dirname, "..", "kiro", "mcp-entry.js");
};
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var deepEqual = (a, b) => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => deepEqual(value, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
  }
  return false;
};
var runKiroDoctor = async (options = {}) => {
  let kiroBinary = options.kiroBinary ?? "kiro-cli";
  let managedKiroBinaryPath;
  let managedKiroSha256;
  let observedKiro;
  const requestedMcpEntryPath = options.mcpEntryPath ?? defaultMcpEntry();
  const checkingInstalled = Boolean(
    options.checkInstalled || options.projectRoot || options.kiroHome
  );
  let attestedInstalledMcpEntryPath;
  let attestedInstalledNodePath;
  let observedNodeVersion = process.versions.node;
  const checks = [];
  let tupleFailed = false;
  const run = async (id, probe) => {
    const started = Date.now();
    try {
      const message = await probe();
      checks.push({ id, status: "pass", durationMs: Date.now() - started, message });
      return true;
    } catch (error) {
      checks.push({
        id,
        status: "fail",
        durationMs: Date.now() - started,
        message: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  };
  const skip = (id, message) => {
    checks.push({ id, status: "skipped", durationMs: 0, message });
  };
  if (checkingInstalled) {
    const roots = resolveKiroInstallRoots(options);
    const paths = managedPaths(roots.installRoot, roots.layout);
    const manifestOk = await run("install.manifest", async () => {
      const manifest = readManifest(roots.installRoot, roots.layout);
      if (!manifest) throw new Error("managed install manifest is absent");
      if (manifest.format !== 3) {
        throw new Error(
          `legacy format-${manifest.format} installation cannot be checked as installed; run kiro-fabric-setup update (or repair from a trusted current package) to create a fully attested format-3 release`
        );
      }
      if (!manifest.grants) throw new Error("format-3 advanced-grant attestation is absent; run update or repair");
      const profile = readManagedFileNoFollow(roots.installRoot, paths.profile);
      if (!profile) throw new Error("managed installed profile is absent");
      if (sha256Bytes(profile) !== manifest.profile.installedSha256) {
        throw new Error("managed installed profile hash mismatch");
      }
      if (manifest.runtime.kiroBinaryPath) {
        managedKiroBinaryPath = manifest.runtime.kiroBinaryPath;
        managedKiroSha256 = manifest.runtime.kiroSha256;
        if (!managedKiroSha256) throw new Error("managed manifest has no Kiro executable digest");
        if (options.kiroBinary === void 0) kiroBinary = managedKiroBinaryPath;
        const document = JSON.parse(profile.toString("utf8"));
        const env = document.mcpServers?.fabric?.env;
        if (env?.[KIRO_BINARY_ENV] !== manifest.runtime.kiroBinaryPath || env?.[KIRO_VERSION_ENV] !== manifest.runtime.kiroCliVersion || env?.[KIRO_SHA256_ENV] !== manifest.runtime.kiroSha256) {
          throw new Error("managed profile Kiro executable identity does not match manifest");
        }
        const profileGrants = {
          allowShell: env?.KIRO_FABRIC_ALLOW_SHELL === "1",
          enableSubagents: env?.KIRO_FABRIC_ENABLE_SUBAGENTS === "1",
          allowTools: env?.KIRO_FABRIC_ALLOW_TOOLS === "1"
        };
        if (manifest.grants && JSON.stringify(manifest.grants) !== JSON.stringify(profileGrants)) {
          throw new Error("managed manifest grant state differs from profile");
        }
      }
      return "format-3 profile and manifest ownership verified";
    });
    const installedManifest = manifestOk ? readManifest(roots.installRoot, roots.layout) : null;
    if (!manifestOk || !installedManifest) {
      skip("install.skills", "dependency_failed");
      skip("install.runtime-closure", "dependency_failed");
    } else {
      await run("install.skills", async () => {
        const records = installedManifest.skills?.files;
        if (!records || records.length === 0) throw new Error("managed skill attestation is absent");
        const sources = records.map((record) => {
          const path2 = join4(roots.installRoot, ...record.path.split("/"));
          const bytes = readManagedFileNoFollow(roots.installRoot, path2);
          if (!bytes) throw new Error("managed skill is absent: " + record.path);
          if (sha256Bytes(bytes) !== record.installedSha256) {
            throw new Error("managed skill hash mismatch: " + record.path);
          }
          const marker = record.path.indexOf("skills/");
          return {
            sourceRelative: record.path.slice(marker + "skills/".length),
            installedRelative: record.path,
            installedPath: path2,
            bytes,
            sha256: record.installedSha256
          };
        });
        if (managedKiroSkillBundleSha256(sources) !== installedManifest.skills.bundleSha256) {
          throw new Error("managed skill bundle digest mismatch");
        }
        return records.length + " managed skill files verified";
      });
      await run("install.runtime-closure", async () => {
        const closure = installedManifest.runtime.closure;
        if (!closure) throw new Error("runtime closure attestation is absent");
        const generations = installedManifest.runtime.generations;
        if (!generations?.length) throw new Error("runtime generation attestation is absent");
        for (const generation of generations) {
          verifyRuntimeClosureAttestation(roots.installRoot, generation);
        }
        const releasePackage = JSON.parse(readFileSync4(
          join4(roots.installRoot, ...closure.root.split("/"), "package.json"),
          "utf8"
        ));
        if (releasePackage.version !== installedManifest.packageVersion || releasePackage.digest !== closure.digest) {
          throw new Error("manifest package identity does not match the attested release");
        }
        const marker = runtimeClosureMarkerPath(roots.installRoot, roots.layout, closure);
        const stat = lstatOrNull(marker);
        if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
          throw new Error("runtime closure marker is missing or invalid");
        }
        if (readFileSync4(marker, "utf8").trim() !== closure.digest) {
          throw new Error("runtime closure marker digest mismatch");
        }
        attestedInstalledMcpEntryPath = installedManifest.runtime.mcpEntryPath;
        attestedInstalledNodePath = installedManifest.runtime.nodePath;
        return closure.files.length + " immutable release files verified";
      });
    }
  }
  await run("config.accounting", async () => {
    const config = options.fabricConfig ?? inspectFabricConfig({
      cwd: process.cwd(),
      agentDir: resolveAgentDir(),
      projectTrusted: false
    });
    assertKiroAccountingCompatible(config.agents);
    return config.agents.runner === "kiro" ? "configured Kiro accounting ceilings are disabled" : `configured agent runner ${config.agents.runner} does not use Kiro ACP`;
  });
  const workspace = await mkdtemp2(join4(tmpdir2(), "kiro-fabric-kiro-doctor-"));
  const projectRoot = join4(workspace, "project");
  try {
    await mkdir(projectRoot, { recursive: true });
    await run("tuple", async () => {
      if (checkingInstalled && (!attestedInstalledNodePath || !attestedInstalledMcpEntryPath || !managedKiroBinaryPath)) {
        throw new Error("installed format-3 runtime is not fully attested; run update or repair before doctor");
      }
      const node = await assertSupportedNode(attestedInstalledNodePath ?? process.execPath);
      observedNodeVersion = node.version;
      const kiro = await assertKiroVersion(kiroBinary);
      observedKiro = kiro;
      if (managedKiroBinaryPath && (!sameExecutableIdentity(kiro.sourcePath, managedKiroBinaryPath) || kiro.version !== KIRO_CLI_VERSION || kiro.sha256 !== managedKiroSha256)) {
        throw new Error("selected Kiro executable does not match the managed manifest identity");
      }
      await assertKiroV3Capabilities(kiro);
      kiroBinary = kiro.executablePath;
      return `Node ${node.version} + kiro-cli ${kiro.version} / ${KIRO_AGENT_ENGINE} / auth ${KIRO_ACP_AUTH_METHOD}`;
    }).then((ok) => {
      tupleFailed = !ok;
    });
    const profile = generateKiroProfile({
      projectRoot,
      mcpEntryPath: attestedInstalledMcpEntryPath ?? requestedMcpEntryPath,
      nodePath: attestedInstalledNodePath ?? process.execPath,
      ...observedKiro ? {
        kiroBinaryPath: observedKiro.executablePath,
        kiroCliVersion: observedKiro.version,
        kiroSha256: observedKiro.sha256
      } : {}
    });
    const profileJson = JSON.stringify(profile, null, 2) + "\n";
    const shapeOk = await run("profile.shape", async () => {
      const keys = Object.keys(profile.mcpServers);
      if (keys.length !== 1 || keys[0] !== "fabric") {
        throw new Error(`expected exactly one MCP server "fabric", got ${JSON.stringify(keys)}`);
      }
      if (JSON.stringify(profile.tools) !== JSON.stringify(["@fabric/fabric_exec"])) {
        throw new Error("profile tools must be exactly @fabric/fabric_exec");
      }
      if (JSON.stringify(profile.allowedTools) !== JSON.stringify(["@fabric/fabric_exec"])) {
        throw new Error("profile allowedTools compatibility mirror must be exactly @fabric/fabric_exec");
      }
      if (profile.includeMcpJson !== false) throw new Error("includeMcpJson must be false");
      if (profile.includePowers !== false) throw new Error("includePowers must be false");
      const rules = profile.permissions.rules;
      if (rules.length !== 1 || rules[0]?.capability !== "mcp" || rules[0]?.effect !== "ask" || rules[0]?.match?.length !== 1 || rules[0]?.match[0] !== "fabric/fabric_exec") {
        throw new Error("default profile must carry exactly one exact Fabric ask rule");
      }
      if (JSON.stringify(profile).includes("--trust-all-tools")) {
        throw new Error("profile contains --trust-all-tools");
      }
      return "fail-closed profile shape";
    });
    let profileValid = false;
    if (!tupleFailed && shapeOk) {
      profileValid = await run("profile.validate", async () => {
        await validateKiroProfile(profileJson, observedKiro);
        return "kiro-cli agent validate clean";
      });
      await run("profile.negative-control", async () => {
        const invalid = { ...profile };
        delete invalid.name;
        let diagnosed = false;
        try {
          await validateKiroProfile(JSON.stringify(invalid, null, 2) + "\n", observedKiro);
        } catch {
          diagnosed = true;
        }
        if (!diagnosed) {
          throw new Error("validator accepted a profile missing required name; validator is not proving anything");
        }
        return "invalid profile produces a diagnostic";
      });
    } else {
      skip("profile.validate", "dependency_failed");
      skip("profile.negative-control", "dependency_failed");
    }
    if (checkingInstalled && !attestedInstalledMcpEntryPath) {
      skip("mcp.initialize", "installed_runtime_unattested");
      skip("mcp.tools-list", "dependency_failed");
      skip("mcp.fabric-exec", "dependency_failed");
      skip("mcp.shutdown", "dependency_failed");
    } else {
      const mcpEntryPath = attestedInstalledMcpEntryPath ?? requestedMcpEntryPath;
      const mcp = spawnJsonRpcProcess({
        argv: [attestedInstalledNodePath ?? process.execPath, mcpEntryPath],
        cwd: projectRoot,
        env: { ...process.env, KIRO_FABRIC_PROJECT_ROOT: projectRoot },
        timeoutMs: 3e4
      });
      let mcpOk = true;
      mcpOk = await run("mcp.initialize", async () => {
        const result = await mcp.call("initialize", {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "kiro-fabric-doctor", version: "1" }
        });
        const serverInfo = result.serverInfo;
        if (serverInfo?.name !== "kiro-fabric") {
          throw new Error(`unexpected serverInfo: ${JSON.stringify(serverInfo)}`);
        }
        if (!isRecord(result.capabilities) || !("tools" in result.capabilities)) {
          throw new Error("tools capability missing");
        }
        mcp.notify("notifications/initialized", {});
        return `initialize negotiated via ${mcpEntryPath}`;
      }) && mcpOk;
      if (mcpOk) {
        await run("mcp.tools-list", async () => {
          const result = await mcp.call("tools/list", {});
          const tools = result.tools ?? [];
          if (tools.length !== 1) throw new Error(`expected exactly one tool, got ${tools.length}`);
          const tool = tools[0];
          if (tool.name !== "fabric_exec") throw new Error(`unexpected tool ${String(tool.name)}`);
          if (!deepEqual(tool.inputSchema, fabricExecInputSchemaJson())) {
            throw new Error("inputSchema differs from the kernel golden schema");
          }
          return "exactly fabric_exec with the golden schema";
        }).then((ok) => {
          mcpOk = ok;
        });
      } else {
        skip("mcp.tools-list", "dependency_failed");
      }
      if (mcpOk) {
        await run("mcp.fabric-exec", async () => {
          const result = await mcp.call("tools/call", {
            name: "fabric_exec",
            arguments: { code: "return 1 + 2;" }
          });
          const text = result.content?.find((entry) => entry.type === "text")?.text;
          if (result.isError === true || text !== "3") {
            throw new Error(`fabric_exec deterministic probe failed: ${JSON.stringify(result).slice(0, 500)}`);
          }
          return "fabric_exec returned the deterministic result 3";
        });
      } else {
        skip("mcp.fabric-exec", "dependency_failed");
      }
      await run("mcp.shutdown", async () => {
        const { escalated } = await mcp.terminate();
        if (escalated) throw new Error("MCP server ignored SIGTERM; SIGKILL required");
        return "process group reaped";
      });
    }
    if (tupleFailed || !profileValid || checkingInstalled && !attestedInstalledMcpEntryPath) {
      skip("acp.initialize", "dependency_failed");
      skip("acp.session-new", "dependency_failed");
      skip("acp.no-prompt", "dependency_failed");
      skip("acp.shutdown", "dependency_failed");
      skip("acp.resume-initialize", "dependency_failed");
      skip("acp.session-load", "dependency_failed");
      skip("acp.resume-no-prompt", "dependency_failed");
      skip("acp.session-delete", "dependency_failed");
      skip("acp.resume-shutdown", "dependency_failed");
    } else {
      const doctorKiroHome = join4(workspace, "kiro-runtime-v3", ".kiro");
      await mkdir(doctorKiroHome, { recursive: true });
      const acpArgv = [
        kiroBinary,
        "acp",
        "--agent-engine",
        KIRO_AGENT_ENGINE,
        "--auth-method",
        KIRO_ACP_AUTH_METHOD
      ];
      const spawnDoctorAcp = () => {
        if (observedKiro && attestExecutable(observedKiro.executablePath).sha256 !== observedKiro.sha256) {
          throw new Error("Kiro executable changed immediately before doctor ACP spawn");
        }
        return spawnJsonRpcProcess({
          argv: acpArgv,
          cwd: projectRoot,
          env: { ...process.env, KIRO_HOME: doctorKiroHome },
          timeoutMs: 6e4
        });
      };
      const initializeAcp = async (acp2) => {
        const result = await acp2.call("initialize", {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: {
            name: "kiro-fabric-doctor",
            version: readPackageVersion()
          }
        });
        if (result.protocolVersion !== 1 || !isRecord(result.agentCapabilities)) {
          throw new Error(`unexpected ACP initialize result: ${JSON.stringify(result).slice(0, 300)}`);
        }
      };
      const activateAgent = async (acp2, sessionId) => {
        await acp2.call("session/set_mode", {
          sessionId,
          modeId: KIRO_V3_AGENT_MODE
        });
        await acp2.call("session/set_config_option", {
          sessionId,
          configId: "autopilot",
          value: "off"
        });
      };
      const assertNoPrompt = (acp2) => {
        if (acp2.outboundMethods.includes("session/prompt")) {
          throw new Error("doctor sent session/prompt; that would be a billable turn");
        }
        return `outbound methods: ${acp2.outboundMethods.join(", ") || "(none)"}`;
      };
      const acp = spawnDoctorAcp();
      let acpOk = await run("acp.initialize", async () => {
        await initializeAcp(acp);
        return "ACP initialize negotiated";
      });
      let createdSessionId;
      if (acpOk) {
        acpOk = await run("acp.session-new", async () => {
          const result = await acp.call(
            "session/new",
            buildKiroV3SessionParams(profile, projectRoot)
          );
          assertKiroV3AgentModeAvailable(result);
          createdSessionId = typeof result.sessionId === "string" ? result.sessionId : void 0;
          if (!createdSessionId) throw new Error("session/new returned no sessionId");
          await activateAgent(acp, createdSessionId);
          return `session ${createdSessionId}; injected mode ${KIRO_V3_AGENT_MODE}`;
        });
      } else {
        skip("acp.session-new", "dependency_failed");
      }
      const noPromptOk = await run("acp.no-prompt", async () => assertNoPrompt(acp));
      const shutdownOk = await run("acp.shutdown", async () => {
        const { escalated } = await acp.terminate();
        if (escalated) throw new Error("kiro acp ignored SIGTERM; SIGKILL required");
        return "process group reaped";
      });
      if (!acpOk || !noPromptOk || !shutdownOk || !createdSessionId) {
        skip("acp.resume-initialize", "dependency_failed");
        skip("acp.session-load", "dependency_failed");
        skip("acp.resume-no-prompt", "dependency_failed");
        skip("acp.session-delete", "dependency_failed");
        skip("acp.resume-shutdown", "dependency_failed");
      } else {
        const resumeSessionId = createdSessionId;
        const resumed = spawnDoctorAcp();
        const resumeInitOk = await run("acp.resume-initialize", async () => {
          await initializeAcp(resumed);
          return "second ACP process initialized";
        });
        if (resumeInitOk) {
          await run("acp.session-load", async () => {
            const result = await resumed.call("session/load", {
              sessionId: resumeSessionId,
              ...buildKiroV3SessionParams(profile, projectRoot)
            });
            assertKiroV3AgentModeAvailable(result);
            if (typeof result.sessionId === "string" && result.sessionId !== resumeSessionId) {
              throw new Error("session/load returned a different sessionId");
            }
            await activateAgent(resumed, resumeSessionId);
            return `reloaded session ${resumeSessionId} with injected mode ${KIRO_V3_AGENT_MODE}`;
          });
        } else {
          skip("acp.session-load", "dependency_failed");
        }
        await run("acp.resume-no-prompt", async () => assertNoPrompt(resumed));
        if (resumeInitOk) {
          await run("acp.session-delete", async () => {
            await resumed.call("_kiro/session/delete", { sessionId: resumeSessionId });
            return "empty doctor session deleted";
          });
        } else {
          skip("acp.session-delete", "dependency_failed");
        }
        await run("acp.resume-shutdown", async () => {
          const { escalated } = await resumed.terminate();
          if (escalated) throw new Error("resumed kiro acp ignored SIGTERM; SIGKILL required");
          return "second process group reaped";
        });
      }
    }
  } finally {
    observedKiro?.dispose();
    await rm2(workspace, { recursive: true, force: true });
  }
  const passed = checks.filter((check) => check.status === "pass").length;
  const failed = checks.filter((check) => check.status === "fail").length;
  const skipped = checks.filter((check) => check.status === "skipped").length;
  return {
    schemaVersion: 1,
    kind: "kiro-fabric.kiro-doctor",
    ok: failed === 0,
    nonBillable: true,
    modelTurnsRequested: 0,
    observed: {
      node: {
        path: attestedInstalledNodePath ?? process.execPath,
        version: observedNodeVersion
      },
      kiro: {
        path: observedKiro?.sourcePath ?? kiroBinary,
        version: tupleFailed ? null : observedKiro?.version ?? null
      },
      agentEngine: KIRO_AGENT_ENGINE,
      authMethod: KIRO_ACP_AUTH_METHOD,
      platform: process.platform,
      arch: process.arch
    },
    checks,
    summary: { passed, failed, skipped }
  };
};

// src/kiro/uninstall.ts
import { existsSync as existsSync5, readFileSync as readFileSync5, unlinkSync as unlinkSync2 } from "node:fs";
import { dirname as dirname2, join as join5 } from "node:path";
var backupAbs = (root, record) => join5(root, ...record.path.split("/"));
var planKiroProfileUninstall = (options = {}) => {
  const { layout, installRoot, projectRoot: root } = resolveKiroInstallRoots(options);
  assertManagedTree(installRoot, layout);
  const paths = managedPaths(installRoot, layout);
  const empty = (action) => ({
    action,
    projectRoot: root,
    installRoot,
    layout,
    profilePath: paths.profile,
    manifestPath: paths.manifest,
    backupPath: null,
    managedSha256: null,
    restoredSha256: null,
    needsProfileMutation: false,
    needsManifestRemoval: false,
    warnings: [],
    skills: [],
    manifest: null
  });
  const manifestStat = lstatOrNull(paths.manifest);
  if (!manifestStat) return empty("noop");
  if (manifestStat.isSymbolicLink()) {
    throw new KiroInstallError("symlink", `refusing manifest symlink: ${paths.manifest}`);
  }
  if (!manifestStat.isFile()) {
    throw new KiroInstallError("manifest", `install manifest is not a regular file: ${paths.manifest}`);
  }
  const manifest = readManifest(installRoot, layout);
  const backup = manifest.profile.backup ?? null;
  if (backup) assertBackupBytes(installRoot, backup);
  const ownershipWarnings = [];
  const skills = (manifest.skills?.files ?? []).map((record) => {
    const path2 = join5(installRoot, ...record.path.split("/"));
    const current = readManagedFileNoFollow(installRoot, path2);
    const currentSha256 = current === null ? null : sha256Bytes(current);
    const backupBytes = record.backup ? assertBackupBytes(installRoot, record.backup) : null;
    let nextBytes = current;
    let needsMutation = false;
    if (currentSha256 === record.installedSha256) {
      nextBytes = backupBytes;
      needsMutation = true;
    } else if (currentSha256 === null && backupBytes === null) {
      nextBytes = null;
    } else if (currentSha256 === null && backupBytes !== null) {
      nextBytes = backupBytes;
      needsMutation = true;
    } else if (record.backup && currentSha256 === record.backup.sha256) {
      nextBytes = current;
    } else {
      throw new KiroInstallError(
        "ownership",
        "managed skill changed; refusing to uninstall: " + path2
      );
    }
    return { record, path: path2, currentSha256, nextBytes, needsMutation };
  });
  if (manifest.runtime.closure) {
    const generations = manifest.runtime.generations ?? [manifest.runtime.closure];
    const markerOwners = /* @__PURE__ */ new Map();
    for (const generation of generations) {
      const generationRoot = join5(installRoot, ...generation.root.split("/"));
      if (existsSync5(generationRoot)) verifyRuntimeClosureAttestation(installRoot, generation);
      else ownershipWarnings.push("recorded runtime generation is already absent: " + generation.digest);
      const marker = runtimeClosureMarkerPath(installRoot, layout, generation);
      markerOwners.set(marker, [...markerOwners.get(marker) ?? [], generation]);
    }
    const activeMarker = runtimeClosureMarkerPath(installRoot, layout, manifest.runtime.closure);
    const activeRoot = join5(installRoot, ...manifest.runtime.closure.root.split("/"));
    for (const [marker, owners] of markerOwners) {
      const markerStat = lstatOrNull(marker);
      if (markerStat && (markerStat.isSymbolicLink() || !markerStat.isFile())) {
        throw new KiroInstallError("ownership", "runtime closure marker does not match manifest");
      }
      const markerDigest = markerStat ? readFileSync5(marker, "utf8").trim() : void 0;
      if (markerDigest && !owners.some((owner) => owner.digest === markerDigest)) {
        throw new KiroInstallError("ownership", "runtime closure marker is not owned by the manifest");
      }
      if (marker === activeMarker && existsSync5(activeRoot) && markerDigest !== manifest.runtime.closure.digest) {
        throw new KiroInstallError("ownership", "runtime closure marker does not match manifest");
      }
    }
  }
  const ownedState = { warnings: ownershipWarnings, skills, manifest };
  const profileStat = lstatOrNull(paths.profile);
  let currentHash = null;
  if (profileStat) {
    if (profileStat.isSymbolicLink()) {
      throw new KiroInstallError("symlink", `refusing profile symlink: ${paths.profile}`);
    }
    if (!profileStat.isFile()) {
      throw new KiroInstallError("ownership", `profile target is not a regular file: ${paths.profile}`);
    }
    currentHash = sha256Bytes(readFileSync5(paths.profile));
  }
  const installed = manifest.profile.installedSha256;
  const backupPath = backup ? backupAbs(installRoot, backup) : null;
  if (currentHash === installed) {
    return {
      action: backup ? "restore" : "remove",
      projectRoot: root,
      installRoot,
      layout,
      profilePath: paths.profile,
      manifestPath: paths.manifest,
      backupPath,
      managedSha256: installed,
      restoredSha256: backup?.sha256 ?? null,
      needsProfileMutation: true,
      needsManifestRemoval: true,
      ...ownedState
    };
  }
  if (currentHash === null && !backup) {
    return {
      action: "remove",
      projectRoot: root,
      installRoot,
      layout,
      profilePath: paths.profile,
      manifestPath: paths.manifest,
      backupPath: null,
      managedSha256: installed,
      restoredSha256: null,
      needsProfileMutation: false,
      needsManifestRemoval: true,
      ...ownedState
    };
  }
  if (currentHash === null && backup) {
    return {
      action: "restore",
      projectRoot: root,
      installRoot,
      layout,
      profilePath: paths.profile,
      manifestPath: paths.manifest,
      backupPath,
      managedSha256: installed,
      restoredSha256: backup.sha256,
      needsProfileMutation: true,
      needsManifestRemoval: true,
      ...ownedState
    };
  }
  if (backup && currentHash === backup.sha256) {
    return {
      action: "restore",
      projectRoot: root,
      installRoot,
      layout,
      profilePath: paths.profile,
      manifestPath: paths.manifest,
      backupPath,
      managedSha256: installed,
      restoredSha256: backup.sha256,
      needsProfileMutation: false,
      needsManifestRemoval: true,
      ...ownedState
    };
  }
  throw new KiroInstallError(
    "ownership",
    `managed profile changed; refusing to uninstall: ${paths.profile}`
  );
};
var resultFromPlan2 = (plan, dryRun, extraWarnings = []) => ({
  ok: true,
  dryRun,
  action: plan.action,
  changed: !dryRun && (plan.needsProfileMutation || plan.needsManifestRemoval || plan.skills.some((skill) => skill.needsMutation)),
  projectRoot: plan.projectRoot,
  profilePath: plan.profilePath,
  manifestPath: plan.manifestPath,
  backupPath: plan.backupPath,
  managedSha256: plan.managedSha256,
  restoredSha256: plan.restoredSha256,
  warnings: [...plan.warnings, ...extraWarnings]
});
var commitUninstall = (plan) => {
  const warnings = [];
  const paths = managedPaths(plan.installRoot, plan.layout);
  assertManagedTree(plan.installRoot, plan.layout);
  const currentProfile = readManagedFileNoFollow(plan.installRoot, plan.profilePath);
  const currentProfileHash = currentProfile === null ? null : sha256Bytes(currentProfile);
  if (plan.needsProfileMutation && currentProfileHash !== null && currentProfileHash !== plan.managedSha256) {
    throw new KiroInstallError(
      "ownership",
      `profile changed while uninstalling: ${plan.profilePath}`
    );
  }
  let nextProfile = currentProfile;
  if (plan.needsProfileMutation && plan.action === "restore" && plan.restoredSha256) {
    nextProfile = assertBackupBytes(plan.installRoot, {
      path: backupRelativePath(plan.restoredSha256, plan.layout),
      sha256: plan.restoredSha256
    });
  } else if (plan.needsProfileMutation && plan.action === "remove") {
    nextProfile = null;
  }
  for (const skill of plan.skills) {
    const current = readManagedFileNoFollow(plan.installRoot, skill.path);
    const hash = current === null ? null : sha256Bytes(current);
    if (hash !== skill.currentSha256) {
      throw new KiroInstallError("concurrency", "managed skill changed while uninstalling: " + skill.path);
    }
  }
  if (plan.manifest?.runtime.closure) {
    const generations = plan.manifest.runtime.generations ?? [plan.manifest.runtime.closure];
    const markers = /* @__PURE__ */ new Map();
    for (const generation of generations) {
      const marker = runtimeClosureMarkerPath(plan.installRoot, plan.layout, generation);
      const markerStat = lstatOrNull(marker);
      if (!markerStat) continue;
      const digest = readFileSync5(marker, "utf8").trim();
      const owner = generations.find((candidate) => runtimeClosureMarkerPath(plan.installRoot, plan.layout, candidate) === marker && candidate.digest === digest);
      if (!owner) throw new KiroInstallError("ownership", "runtime closure marker is not owned by the manifest");
      markers.set(marker, { digest, owner });
    }
    for (const generation of generations) {
      removeAttestedRuntimeClosure(plan.installRoot, plan.layout, generation);
    }
    for (const { digest, owner } of markers.values()) {
      removeRuntimeActivationMarker(plan.installRoot, plan.layout, digest, owner);
    }
  }
  const currentManifest = readManagedFileNoFollow(plan.installRoot, plan.manifestPath);
  commitManagedFileTransaction(
    plan.installRoot,
    plan.layout,
    "uninstall",
    [
      {
        path: plan.profilePath,
        transition: managedFileTransition(currentProfileHash, nextProfile)
      },
      ...plan.skills.map((skill) => ({
        path: skill.path,
        transition: managedFileTransition(skill.currentSha256, skill.nextBytes)
      })),
      {
        path: plan.manifestPath,
        transition: managedFileTransition(
          currentManifest === null ? null : sha256Bytes(currentManifest),
          plan.needsManifestRemoval ? null : currentManifest
        )
      }
    ]
  );
  fsyncDirectory(paths.agentsDir);
  if (plan.skills.length > 0) fsyncDirectory(paths.skillsDir);
  fsyncDirectory(paths.manifestDir);
  if (plan.backupPath) {
    const stat = lstatOrNull(plan.backupPath);
    if (stat?.isFile() && !stat.isSymbolicLink()) unlinkSync2(plan.backupPath);
  }
  for (const skill of plan.skills) {
    if (skill.record.backup) {
      const backupPath = backupAbs(plan.installRoot, skill.record.backup);
      const stat = lstatOrNull(backupPath);
      if (stat?.isFile() && !stat.isSymbolicLink()) unlinkSync2(backupPath);
    }
  }
  if (plan.manifest?.format === 1) {
    warnings.push("legacy format-1 manifest has no runtime ownership proof; runtime left untouched");
  }
  const skillDirs = [...new Set(plan.skills.map((skill) => dirname2(skill.path)))].sort(
    (left, right) => right.length - left.length
  );
  for (const dir of skillDirs) {
    rmdirIfEmpty(dir);
    rmdirIfEmpty(dirname2(dir));
  }
  return warnings;
};
var cleanupEmptyManagedDirs = (root, layout) => {
  const paths = managedPaths(root, layout);
  rmdirIfEmpty(paths.runtimeDir);
  rmdirIfEmpty(dirname2(paths.runtimeDir));
  rmdirIfEmpty(paths.legacyRuntimeDir);
  rmdirIfEmpty(paths.skillsDir);
  rmdirIfEmpty(paths.backupDir);
  rmdirIfEmpty(paths.manifestDir);
  rmdirIfEmpty(paths.agentsDir);
  if (layout === "project") {
    rmdirIfEmpty(join5(root, ".kiro"));
  }
};
var uninstallKiroProfile = (options = {}) => {
  if (!options.dryRun) {
    const roots = resolveKiroInstallRoots(options);
    const transaction = managedPaths(roots.installRoot, roots.layout).transaction;
    if (existsSync5(transaction)) {
      const recoveryLock = acquireOperationLock(roots.installRoot, roots.layout);
      try {
        recoverManagedTransaction(roots.installRoot, roots.layout);
      } finally {
        recoveryLock.release();
      }
    }
  }
  const planned = planKiroProfileUninstall(options);
  if (options.dryRun) return resultFromPlan2(planned, true);
  if (planned.action === "noop" && !planned.needsManifestRemoval && !existsSync5(managedPaths(planned.installRoot, planned.layout).transaction)) {
    cleanupEmptyManagedDirs(planned.installRoot, planned.layout);
    return resultFromPlan2(planned, false);
  }
  const lock = acquireOperationLock(planned.installRoot, planned.layout);
  let result;
  try {
    recoverManagedTransaction(planned.installRoot, planned.layout);
    const plan = planKiroProfileUninstall(options);
    if (plan.action === "noop" && !plan.needsManifestRemoval) {
      result = resultFromPlan2(plan, false);
    } else {
      result = resultFromPlan2(plan, false, commitUninstall(plan));
    }
  } finally {
    lock.release();
  }
  cleanupEmptyManagedDirs(planned.installRoot, planned.layout);
  return result;
};

// src/kiro/setup.ts
var STRICT_LAUNCH_ARGS = ["--v3", "--agent", "kiro-fabric"];
var POWER_LAUNCH_ARGS = ["--v3"];
var USAGE = [
  "kiro-fabric-setup \u2014 install and maintain the managed Kiro v3 profile",
  "",
  "Usage:",
  "  kiro-fabric-setup <command> [options]",
  "",
  "Commands:",
  "  status                    Show node, kiro-cli, and per-scope install state",
  "  install                   Install the managed Kiro v3 profile (project scope by default)",
  "  update                    Update from the current npm/source artifact; preserve grants",
  "  repair                    Re-attest and restore from the current trusted artifact",
  "  uninstall                 Remove a managed profile or restore the backup",
  "  doctor                    Read-only non-billable health checks",
  "  launch                    Launch kiro-cli with the strict kiro-fabric agent",
  "  launch-power              Launch kiro-cli --v3 with IDE-installed Powers enabled",
  "",
  "Bare invocation on a TTY shows an interactive menu; otherwise this usage is",
  "printed. New installs default advanced grants off; update/repair preserve them.",
  "",
  "Options:",
  "  --user                    Target the user Kiro home (~/.kiro) instead of <project>/.kiro",
  "  --project-root <dir>      Project root (default: cwd; never walks up)",
  "  --kiro-home <dir>         Kiro home for --user (default: $KIRO_HOME or ~/.kiro)",
  "  --kiro-binary <path>      Kiro CLI binary (default: kiro-cli)",
  "  --dry-run                 Validate and report without changing files",
  "  --yes                     Suppress confirmation prompts (never implies --force)",
  "  --force                   Install/repair: back up and replace modified managed content",
  "  --allow-shell             Trusted opt-in: enable k.bash",
  "  --subagents               Enable bounded ACP fan-out (requires shell grant)",
  "  --allow-tools             Trusted opt-in: auto-approve fabric_exec meta-capability",
  "                            (it can invoke all configured Fabric providers/tools)",
  "  --revoke-shell            Revoke shell and dependent subagent grants",
  "  --revoke-subagents        Revoke only the subagent grant",
  "  --revoke-tools            Restore the exact Fabric MCP rule to ask",
  "  --reset-grants            Revoke every advanced grant",
  "  --json                    Machine-readable output (exactly one object on stdout)",
  "  -h, --help                Show this help",
  "",
  "Exit codes: 0 success \xB7 1 failure \xB7 2 usage \xB7 130 interactive cancel."
].join("\n") + "\n";
var UsageError = class extends Error {
};
var InteractiveCancelError = class extends Error {
};
var baseArgs = (command) => ({
  command,
  json: false,
  dryRun: false,
  yes: false,
  force: false,
  allowShell: false,
  enableSubagents: false,
  allowTools: false,
  revokeShell: false,
  revokeSubagents: false,
  revokeTools: false,
  resetGrants: false,
  user: false
});
var parseSetupArgs = (argv) => {
  if (argv.length === 0) return baseArgs("menu");
  const [head, ...rest] = argv;
  if (head === "-h" || head === "--help" || head === "help") return baseArgs("help");
  const command = head;
  if (command !== "status" && command !== "install" && command !== "update" && command !== "repair" && command !== "uninstall" && command !== "doctor" && command !== "launch" && command !== "launch-power") {
    throw new UsageError("unknown command: " + command);
  }
  const mutating = command === "install" || command === "update" || command === "repair" || command === "uninstall";
  const parsed = baseArgs(command);
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = () => {
      const next = rest[++i];
      if (next === void 0 || next.startsWith("--")) {
        throw new UsageError("missing value for " + flag);
      }
      return next;
    };
    switch (flag) {
      case "--json":
        if (command === "launch" || command === "launch-power") {
          throw new UsageError("--json is not valid for launch commands");
        }
        parsed.json = true;
        break;
      case "--dry-run":
        if (!mutating) throw new UsageError("--dry-run is only valid for lifecycle mutations");
        parsed.dryRun = true;
        break;
      case "--yes":
        if (!mutating) throw new UsageError("--yes is only valid for lifecycle mutations");
        parsed.yes = true;
        break;
      case "--force":
        if (command !== "install" && command !== "repair") throw new UsageError("--force is install/repair-only");
        parsed.force = true;
        break;
      case "--allow-shell":
        if (command !== "install" && command !== "update" && command !== "repair") {
          throw new UsageError("--allow-shell is install/update/repair-only");
        }
        parsed.allowShell = true;
        break;
      case "--subagents":
        if (command !== "install" && command !== "update" && command !== "repair") {
          throw new UsageError("--subagents is install/update/repair-only");
        }
        parsed.enableSubagents = true;
        break;
      case "--allow-tools":
        if (command !== "install" && command !== "update" && command !== "repair") {
          throw new UsageError("--allow-tools is install/update/repair-only");
        }
        parsed.allowTools = true;
        break;
      case "--revoke-shell":
      case "--revoke-subagents":
      case "--revoke-tools":
      case "--reset-grants":
        if (command !== "update" && command !== "repair") {
          throw new UsageError(flag + " is update/repair-only");
        }
        if (flag === "--revoke-shell") parsed.revokeShell = true;
        if (flag === "--revoke-subagents") parsed.revokeSubagents = true;
        if (flag === "--revoke-tools") parsed.revokeTools = true;
        if (flag === "--reset-grants") parsed.resetGrants = true;
        break;
      case "--project-root":
        if (parsed.projectRoot !== void 0) throw new UsageError("duplicate --project-root");
        parsed.projectRoot = value();
        break;
      case "--user":
        if (command === "launch" || command === "launch-power") {
          throw new UsageError("--user is not valid for launch commands");
        }
        parsed.user = true;
        break;
      case "--kiro-home":
        if (command === "launch" || command === "launch-power") {
          throw new UsageError("--kiro-home is not valid for launch commands");
        }
        if (parsed.kiroHome !== void 0) throw new UsageError("duplicate --kiro-home");
        parsed.kiroHome = value();
        break;
      case "--kiro-binary":
        if (command === "uninstall") {
          throw new UsageError("--kiro-binary is not valid for uninstall");
        }
        if (parsed.kiroBinary !== void 0) throw new UsageError("duplicate --kiro-binary");
        parsed.kiroBinary = value();
        break;
      case "-h":
      case "--help":
        return baseArgs("help");
      default:
        throw new UsageError("unknown option: " + flag);
    }
  }
  if (parsed.kiroHome !== void 0 && !parsed.user && command !== "status") {
    throw new UsageError("--kiro-home requires --user");
  }
  if (parsed.allowShell && parsed.revokeShell) throw new UsageError("--allow-shell conflicts with --revoke-shell");
  if (parsed.enableSubagents && parsed.revokeSubagents) throw new UsageError("--subagents conflicts with --revoke-subagents");
  if (parsed.allowTools && parsed.revokeTools) throw new UsageError("--allow-tools conflicts with --revoke-tools");
  if (parsed.enableSubagents && parsed.revokeShell) {
    throw new UsageError("--subagents conflicts with --revoke-shell");
  }
  if (parsed.resetGrants && (parsed.allowShell || parsed.enableSubagents || parsed.allowTools || parsed.revokeShell || parsed.revokeSubagents || parsed.revokeTools)) {
    throw new UsageError("--reset-grants conflicts with other grant-changing flags");
  }
  return parsed;
};
var MANIFEST_RELATIVE_PATH = {
  project: ".kiro/.kiro-fabric/install.json",
  user: ".kiro-fabric/install.json"
};
var managedManifestPath = (roots) => join6(roots.installRoot, ...MANIFEST_RELATIVE_PATH[roots.layout].split("/"));
var UNAVAILABLE_SCOPE = {
  installed: false,
  packageVersion: null,
  path: null,
  healthy: false,
  issue: "scope unavailable",
  kiroBinaryPath: null,
  kiroCliVersion: null,
  kiroSha256: null
};
var scopeStatusFor = (scope, projectRoot, kiroHome) => {
  let roots;
  try {
    roots = resolveKiroInstallRoots({
      ...scope === "user" ? { scope: "user" } : {},
      ...scope === "project" && projectRoot !== void 0 ? { projectRoot } : {},
      ...scope === "user" && kiroHome !== void 0 ? { kiroHome } : {}
    });
  } catch {
    return UNAVAILABLE_SCOPE;
  }
  const manifestPath = managedManifestPath(roots);
  if (!existsSync6(manifestPath)) {
    return {
      installed: false,
      packageVersion: null,
      path: manifestPath,
      healthy: false,
      issue: null,
      kiroBinaryPath: null,
      kiroCliVersion: null,
      kiroSha256: null
    };
  }
  let packageVersion = null;
  let kiroBinaryPath = null;
  let kiroCliVersion = null;
  let kiroSha256 = null;
  try {
    const manifest = readManifest(roots.installRoot, roots.layout);
    if (!manifest) throw new Error("managed install manifest is absent");
    packageVersion = manifest.packageVersion;
    kiroBinaryPath = manifest.runtime.kiroBinaryPath ?? null;
    kiroCliVersion = manifest.runtime.kiroCliVersion ?? null;
    kiroSha256 = manifest.runtime.kiroSha256 ?? null;
    if (manifest.format !== 3) {
      throw new Error(
        `legacy format-${manifest.format} installation is not launchable or doctorable; run kiro-fabric-setup update (or repair from a trusted current package) to create a fully attested format-3 release`
      );
    }
    const profile = readManagedFileNoFollow(
      roots.installRoot,
      kiroProfilePath(roots.installRoot, roots.layout)
    );
    if (!profile || sha256Bytes(profile) !== manifest.profile.installedSha256) {
      throw new Error("managed profile hash mismatch");
    }
    const profileDocument = JSON.parse(profile.toString("utf8"));
    const profileEnv = profileDocument.mcpServers?.fabric?.env ?? {};
    const profileGrants = {
      allowShell: profileEnv.KIRO_FABRIC_ALLOW_SHELL === "1",
      enableSubagents: profileEnv.KIRO_FABRIC_ENABLE_SUBAGENTS === "1",
      allowTools: profileEnv.KIRO_FABRIC_ALLOW_TOOLS === "1"
    };
    if (manifest.grants && JSON.stringify(manifest.grants) !== JSON.stringify(profileGrants)) {
      throw new Error("manifest grant state differs from the verified profile");
    }
    {
      const records = manifest.skills?.files;
      if (!records?.length) throw new Error("managed skill attestation is absent");
      const sources = records.map((record) => {
        const installedPath = join6(roots.installRoot, ...record.path.split("/"));
        const bytes = readManagedFileNoFollow(roots.installRoot, installedPath);
        if (!bytes || sha256Bytes(bytes) !== record.installedSha256) {
          throw new Error("managed skill hash mismatch: " + record.path);
        }
        const marker = record.path.indexOf("skills/");
        return {
          sourceRelative: record.path.slice(marker + "skills/".length),
          installedRelative: record.path,
          installedPath,
          bytes,
          sha256: record.installedSha256
        };
      });
      if (managedKiroSkillBundleSha256(sources) !== manifest.skills.bundleSha256) {
        throw new Error("managed skill bundle digest mismatch");
      }
      if (!manifest.runtime.closure) throw new Error("runtime closure attestation is absent");
      const generations = manifest.runtime.generations;
      if (!generations?.length) throw new Error("format-3 runtime generation lineage is absent; run update or repair");
      if (!generations.some((generation) => generation.root === manifest.runtime.closure.root)) {
        throw new Error("active runtime generation is absent from lineage");
      }
      verifyRuntimeClosureAttestation(roots.installRoot, manifest.runtime.closure);
      const releasePackagePath = join6(
        roots.installRoot,
        ...manifest.runtime.closure.root.split("/"),
        "package.json"
      );
      const releasePackageBytes = readManagedFileNoFollow(roots.installRoot, releasePackagePath);
      if (!releasePackageBytes) throw new Error("attested release package metadata is absent");
      const releasePackage = JSON.parse(releasePackageBytes.toString("utf8"));
      if (releasePackage.version !== manifest.packageVersion || releasePackage.digest !== manifest.runtime.closure.digest) {
        throw new Error("manifest package identity does not match the attested release");
      }
      const markerPath = runtimeClosureMarkerPath(roots.installRoot, roots.layout, manifest.runtime.closure);
      const markerStat = lstatOrNull(markerPath);
      if (!markerStat || markerStat.isSymbolicLink() || !markerStat.isFile()) {
        throw new Error("runtime activation marker is missing or invalid");
      }
      const markerBytes = readManagedFileNoFollow(roots.installRoot, markerPath);
      if (!markerBytes || markerBytes.toString("utf8").trim() !== manifest.runtime.closure.digest) {
        throw new Error("runtime activation marker digest mismatch");
      }
      if (!manifest.grants) {
        throw new Error("format-3 advanced-grant state is absent; run update or repair");
      }
    }
    return {
      installed: true,
      packageVersion,
      path: manifestPath,
      healthy: true,
      issue: null,
      kiroBinaryPath,
      kiroCliVersion,
      kiroSha256
    };
  } catch (error) {
    return {
      installed: true,
      packageVersion,
      path: manifestPath,
      healthy: false,
      issue: error instanceof Error ? error.message : String(error),
      kiroBinaryPath,
      kiroCliVersion,
      kiroSha256
    };
  }
};
var collectStatus = async (parsed) => {
  const scopes = {
    user: scopeStatusFor("user", parsed.projectRoot, parsed.kiroHome),
    project: scopeStatusFor("project", parsed.projectRoot, parsed.kiroHome)
  };
  const binary = parsed.kiroBinary ?? scopes.project.kiroBinaryPath ?? scopes.user.kiroBinaryPath ?? "kiro-cli";
  const [node, kiro] = await Promise.all([
    inspectNodeCompatibility(process.execPath),
    inspectKiroCompatibility(binary)
  ]);
  return { node, kiro, scopes };
};
var describeKiroCli = (kiro) => {
  switch (kiro.state) {
    case "ok":
      return kiro.version + " (ok)";
    case "not-found":
      return "not found";
    case "exec-failure":
      return "version check failed";
    case "timeout":
      return "version check timed out";
    case "unparsable":
      return "unparsable version output";
    case "ambiguous":
      return "ambiguous version output";
    case "wrong-product":
      return "wrong product identity";
    case "prerelease":
      return kiro.version + " (prerelease is not certified)";
    case "older":
      return kiro.version + " (unsupported; requires " + KIRO_CLI_VERSION + ")";
    case "newer":
      return kiro.version + " (newer but uncertified; requires " + KIRO_CLI_VERSION + ")";
    case "not-executable":
      return "not an executable regular file";
    case "unsupported-launcher":
      return "unsupported launcher (require native executable or complete attested closure)";
  }
};
var describeScope = (label, scope) => {
  if (scope.path === null) return label + ": unavailable";
  const where = " (" + scope.path + ")";
  if (!scope.installed) return label + ": not installed" + where;
  const version = scope.packageVersion ?? "unknown version";
  const health = scope.healthy ? "healthy" : "unhealthy: " + (scope.issue ?? "verification failed");
  return label + ": installed (kiro-fabric " + version + ", " + health + ")" + where;
};
var renderStatus = (status) => {
  const node = status.node.ok ? status.node.version + " (ok; " + status.node.executablePath + ")" : (status.node.version ?? status.node.state) + " (unsupported; requires stable >= " + MIN_NODE_MAJOR + ")";
  return [
    "node: " + node,
    "kiro-cli: " + describeKiroCli(status.kiro),
    describeScope("scope user", status.scopes.user),
    describeScope("scope project", status.scopes.project)
  ].join("\n");
};
var runStatus = async (parsed) => {
  const status = await collectStatus(parsed);
  process.stdout.write(
    parsed.json ? JSON.stringify(status, null, 2) + "\n" : renderStatus(status) + "\n"
  );
  return 0;
};
var isInteractive = () => process.stdin.isTTY === true && process.stdout.isTTY === true;
var needsConfirmation = (parsed) => !parsed.yes && !parsed.dryRun;
var freshReadlineConfirm = async (prompt) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const cancel = () => {
    process.exit(130);
  };
  rl.on("SIGINT", cancel);
  try {
    const answer = await rl.question(prompt + " [y/N] ").catch(() => "");
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    process.removeListener("SIGINT", cancel);
    rl.close();
  }
};
var errorMessage = (error) => error instanceof Error ? error.message : String(error);
var resolveRoots = (parsed) => resolveKiroInstallRoots({
  ...parsed.user ? { scope: "user" } : {},
  ...parsed.projectRoot !== void 0 ? { projectRoot: parsed.projectRoot } : {},
  ...parsed.kiroHome !== void 0 ? { kiroHome: parsed.kiroHome } : {}
});
var ZERO_GRANTS = {
  allowShell: false,
  enableSubagents: false,
  allowTools: false
};
var resolveDesiredGrants = (parsed) => {
  const updating = parsed.command === "update" || parsed.command === "repair";
  const previous = updating ? readManagedKiroGrants({
    ...parsed.projectRoot !== void 0 ? { projectRoot: parsed.projectRoot } : {},
    ...parsed.user ? { scope: "user" } : {},
    ...parsed.kiroHome !== void 0 ? { kiroHome: parsed.kiroHome } : {}
  }) : null;
  const grants = { ...parsed.resetGrants ? ZERO_GRANTS : previous ?? ZERO_GRANTS };
  if (parsed.allowShell) grants.allowShell = true;
  if (parsed.enableSubagents) grants.enableSubagents = true;
  if (parsed.allowTools) grants.allowTools = true;
  if (parsed.revokeShell) {
    grants.allowShell = false;
    grants.enableSubagents = false;
  }
  if (parsed.revokeSubagents) grants.enableSubagents = false;
  if (parsed.revokeTools) grants.allowTools = false;
  if (grants.enableSubagents && !grants.allowShell) {
    throw new UsageError("the resulting --subagents grant requires --allow-shell");
  }
  return grants;
};
var buildInstallOptions = (parsed) => {
  let installedKiroBinary;
  if (parsed.kiroBinary === void 0) {
    const roots = resolveRoots(parsed);
    installedKiroBinary = readManifest(roots.installRoot, roots.layout)?.runtime.kiroBinaryPath;
  }
  const pinnedKiroBinary = parsed.kiroBinary ?? installedKiroBinary;
  const grants = resolveDesiredGrants(parsed);
  return {
    ...parsed.projectRoot !== void 0 ? { projectRoot: parsed.projectRoot } : {},
    ...parsed.user ? { scope: "user" } : {},
    ...parsed.kiroHome !== void 0 ? { kiroHome: parsed.kiroHome } : {},
    ...pinnedKiroBinary !== void 0 ? { kiroBinary: pinnedKiroBinary } : {},
    ...parsed.force || parsed.command === "repair" ? { force: true } : {},
    ...grants.allowShell ? { allowShell: true } : {},
    ...grants.enableSubagents ? { enableSubagents: true } : {},
    ...grants.allowTools ? { allowTools: true } : {},
    ...parsed.command === "update" || parsed.command === "repair" ? { repairRuntime: true } : {},
    ...process.env.KIRO_FABRIC_MCP_ENTRY ? { mcpEntryPath: process.env.KIRO_FABRIC_MCP_ENTRY } : {}
  };
};
var renderGrantDiff = (before, after) => Object.keys(after).map((key) => `${key}: ${before?.[key] === true ? "on" : "off"} -> ${after[key] ? "on" : "off"}`).join(", ");
var runInstall = async (parsed, io) => {
  const command = parsed.command === "update" ? "update" : parsed.command === "repair" ? "repair" : "install";
  const roots = resolveRoots(parsed);
  const transaction = managedPaths(roots.installRoot, roots.layout).transaction;
  const pendingRecovery = existsSync6(transaction);
  let confirmed = false;
  if (pendingRecovery) {
    probeManagedTransactionRecovery(roots.installRoot, roots.layout);
    if (parsed.dryRun) {
      throw new KiroInstallError(
        "concurrency",
        "a recoverable lifecycle transaction is pending; dry-run left it unchanged"
      );
    }
    if (needsConfirmation(parsed)) {
      if (!isInteractive()) {
        throw new Error("refusing to recover and " + command + " without a terminal; pass --yes to confirm");
      }
      if (!await io.confirm(
        "Recover the interrupted lifecycle transaction, then proceed with " + command + " (" + roots.layout + " scope: " + roots.installRoot + ")?"
      )) throw new InteractiveCancelError("cancelled");
      confirmed = true;
    }
    const recoveryLock = acquireOperationLock(roots.installRoot, roots.layout);
    try {
      recoverManagedTransaction(roots.installRoot, roots.layout);
    } finally {
      recoveryLock.release();
    }
  }
  if ((command === "update" || command === "repair") && !existsSync6(managedManifestPath(roots))) {
    throw new KiroInstallError("manifest", "no managed installation to " + command + "; run install first");
  }
  const installOptions = buildInstallOptions(parsed);
  const beforeGrants = command === "install" ? null : readManagedKiroGrants({
    ...parsed.projectRoot !== void 0 ? { projectRoot: parsed.projectRoot } : {},
    ...parsed.user ? { scope: "user" } : {},
    ...parsed.kiroHome !== void 0 ? { kiroHome: parsed.kiroHome } : {}
  });
  const afterGrants = {
    allowShell: installOptions.allowShell === true,
    enableSubagents: installOptions.enableSubagents === true,
    allowTools: installOptions.allowTools === true
  };
  if (needsConfirmation(parsed) && !confirmed) {
    if (!isInteractive()) {
      throw new Error("refusing to " + command + " without a terminal; pass --yes to confirm");
    }
    const proceed = await io.confirm(
      "Proceed with " + command + " (" + roots.layout + " scope: " + roots.installRoot + ")\n  grants: " + renderGrantDiff(beforeGrants, afterGrants) + (afterGrants.allowTools ? "\n  WARNING: fabric/fabric_exec is an auto-approved meta-capability that may invoke every configured Fabric provider/tool; workspace access is confined to " + roots.projectRoot : "") + "?"
    );
    if (!proceed) throw new InteractiveCancelError("cancelled");
  }
  const result = await installKiroProfile({
    ...installOptions,
    dryRun: parsed.dryRun
  });
  if (parsed.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const verb = parsed.dryRun ? "planned" : command === "update" ? "updated" : command === "repair" ? "repaired" : "installed";
    process.stdout.write(
      verb + " (" + result.action + "): " + result.profilePath + "\nsha256: " + result.profileSha256 + "\ngrants: " + renderGrantDiff(result.grants.before, result.grants.after) + "\n" + (result.backupPath ? "backup: " + result.backupPath + "\n" : "")
    );
  }
  return 0;
};
var isUninstallNoop = (options) => {
  try {
    const plan = planKiroProfileUninstall(options);
    return plan.action === "noop" && !plan.needsProfileMutation && !plan.needsManifestRemoval;
  } catch {
    return false;
  }
};
var buildUninstallOptions = (parsed) => ({
  ...parsed.projectRoot !== void 0 ? { projectRoot: parsed.projectRoot } : {},
  ...parsed.user ? { scope: "user" } : {},
  ...parsed.kiroHome !== void 0 ? { kiroHome: parsed.kiroHome } : {}
});
var runUninstall = async (parsed, io) => {
  const options = buildUninstallOptions(parsed);
  if (needsConfirmation(parsed) && !isUninstallNoop(options)) {
    if (!isInteractive()) {
      throw new Error("refusing to uninstall without a terminal; pass --yes to confirm");
    }
    const roots = resolveRoots(parsed);
    const proceed = await io.confirm(
      "Proceed with uninstall (" + roots.layout + " scope: " + roots.installRoot + ")?"
    );
    if (!proceed) throw new InteractiveCancelError("cancelled");
  }
  const result = uninstallKiroProfile({ ...options, dryRun: parsed.dryRun });
  if (parsed.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const verb = parsed.dryRun ? "planned" : "uninstalled";
    process.stdout.write(verb + " (" + result.action + "): " + result.profilePath + "\n");
    if (result.backupPath && result.action === "restore") {
      process.stdout.write("restored backup: " + result.backupPath + "\n");
    }
  }
  return 0;
};
var runDoctor = async (parsed) => {
  const report = await runKiroDoctor({
    checkInstalled: true,
    ...parsed.projectRoot !== void 0 ? { projectRoot: parsed.projectRoot } : {},
    ...parsed.user ? { scope: "user" } : {},
    ...parsed.kiroHome !== void 0 ? { kiroHome: parsed.kiroHome } : {},
    ...parsed.kiroBinary !== void 0 ? { kiroBinary: parsed.kiroBinary } : {}
  });
  if (parsed.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    for (const check of report.checks) {
      const marker = check.status === "pass" ? "ok" : check.status.toUpperCase();
      process.stdout.write(marker.padEnd(7) + " " + check.id + " \u2014 " + check.message + "\n");
    }
    process.stdout.write(
      "\n" + (report.ok ? "PASS" : "FAIL") + ": " + report.summary.passed + " passed, " + report.summary.failed + " failed, " + report.summary.skipped + " skipped (non-billable; 0 model turns)\n"
    );
  }
  return report.ok ? 0 : 1;
};
var SIGNAL_EXIT_CODES = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
  SIGQUIT: 131
};
var superviseKiro = async (executablePath, args, projectRoot) => {
  const child = spawn2(executablePath, args, {
    stdio: "inherit",
    cwd: projectRoot,
    detached: process.platform !== "win32"
  });
  const processTree = child.pid ? createProcessTreeController(child.pid, { ambientHelpers: false }) : void 0;
  let interruptedCode;
  let escalation;
  const forward = (signal, code) => {
    interruptedCode ??= code;
    if (!processTree || processTree.gone()) return;
    if (escalation) {
      if (!processTree.gone()) void processTree.terminate(0, 2e3);
      return;
    }
    escalation = processTree.signal(signal).then(async () => {
      if (processTree.gone()) return;
      await new Promise((resolve4) => setTimeout(resolve4, 3e3));
      if (!processTree.gone()) await processTree.terminate(0, 2e3);
    }).catch(() => {
    });
  };
  const onSighup = () => forward("SIGHUP", 129);
  const onSigint = () => forward("SIGINT", 130);
  const onSigterm = () => forward("SIGTERM", 143);
  const onSigquit = () => forward("SIGQUIT", 131);
  process.on("SIGHUP", onSighup);
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  process.on("SIGQUIT", onSigquit);
  const outcome = await new Promise(
    (resolvePromise) => {
      child.once("error", (error) => {
        resolvePromise({ missing: error.code === "ENOENT" });
      });
      child.once("close", (code, signal) => {
        resolvePromise({
          code: interruptedCode ?? (signal !== null ? SIGNAL_EXIT_CODES[signal] ?? 128 : code ?? 1)
        });
      });
    }
  ).finally(async () => {
    process.removeListener("SIGHUP", onSighup);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("SIGQUIT", onSigquit);
    if (interruptedCode !== void 0 && processTree && !processTree.gone()) {
      await processTree.terminate(0, 2e3);
    }
    await escalation;
  });
  if ("missing" in outcome) {
    throw new Error(outcome.missing ? "Kiro execution artifact disappeared" : "failed to launch Kiro");
  }
  return outcome.code;
};
var runLaunch = async (parsed) => {
  const projectRoot = resolveKiroProjectRoot(parsed.projectRoot);
  const scopes = {
    project: scopeStatusFor("project", parsed.projectRoot, parsed.kiroHome),
    user: scopeStatusFor("user", parsed.projectRoot, parsed.kiroHome)
  };
  const selected = scopes.project.installed ? scopes.project : scopes.user;
  const selectedLabel = scopes.project.installed ? "project" : "user";
  if (!selected.installed) {
    throw new Error("refusing to launch: no managed Kiro installation is selected");
  }
  if (!selected.healthy || !selected.kiroBinaryPath || !selected.kiroSha256) {
    throw new Error(
      `refusing to launch: selected ${selectedLabel} installation is unhealthy` + (selected.issue ? `: ${selected.issue}` : "")
    );
  }
  if (parsed.kiroBinary && !sameExecutableIdentity(parsed.kiroBinary, selected.kiroBinaryPath)) {
    throw new Error("refusing to launch a Kiro executable that differs from the selected managed artifact");
  }
  const identity = await assertSupportedKiro(selected.kiroBinaryPath);
  try {
    if (identity.sourcePath !== selected.kiroBinaryPath || identity.sha256 !== selected.kiroSha256) {
      throw new Error("refusing to launch a Kiro executable that differs from the managed manifest");
    }
    assertSupportedKiroUnchanged(identity);
    return await superviseKiro(identity.executablePath, STRICT_LAUNCH_ARGS, projectRoot);
  } finally {
    identity.dispose();
  }
};
var runLaunchPower = async (parsed) => {
  const projectRoot = resolveKiroProjectRoot(parsed.projectRoot);
  const identity = await assertSupportedKiro(parsed.kiroBinary ?? "kiro-cli");
  try {
    assertSupportedKiroUnchanged(identity);
    return await superviseKiro(identity.executablePath, POWER_LAUNCH_ARGS, projectRoot);
  } finally {
    identity.dispose();
  }
};
var MENU_TEXT = ["", "Actions:", "  1) install", "  2) update", "  3) repair", "  4) uninstall", "  5) doctor", "  6) launch", "  q) quit", ""].join(
  "\n"
);
var runMenuAction = async (action) => {
  try {
    return await action();
  } catch (error) {
    process.stderr.write("kiro-fabric: " + errorMessage(error) + "\n");
    return 1;
  }
};
var runMenu = async (parsed) => {
  const cancel = () => {
    process.stdout.write("\n");
    process.exit(130);
  };
  process.on("SIGINT", cancel);
  let rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", cancel);
  const menuIo = {
    confirm: async (prompt) => {
      const answer = await rl.question(prompt + " [y/N] ").catch(() => "");
      const normalized = answer.trim().toLowerCase();
      return normalized === "y" || normalized === "yes";
    }
  };
  try {
    for (; ; ) {
      const status = await collectStatus(parsed);
      process.stdout.write(renderStatus(status) + "\n" + MENU_TEXT);
      const rawChoice = await rl.question("select [1-6, q]: ").catch(() => null);
      if (rawChoice === null) return 0;
      const choice = rawChoice.trim().toLowerCase();
      switch (choice) {
        case "":
          continue;
        case "1": {
          const code = await runMenuAction(() => runInstall({ ...parsed, command: "install" }, menuIo));
          if (code !== 0) return code;
          break;
        }
        case "2": {
          const code = await runMenuAction(() => runInstall({ ...parsed, command: "update" }, menuIo));
          if (code !== 0) return code;
          break;
        }
        case "3": {
          const code = await runMenuAction(() => runInstall({ ...parsed, command: "repair" }, menuIo));
          if (code !== 0) return code;
          break;
        }
        case "4": {
          const code = await runMenuAction(() => runUninstall({ ...parsed, command: "uninstall" }, menuIo));
          if (code !== 0) return code;
          break;
        }
        case "5": {
          const code = await runMenuAction(() => runDoctor({ ...parsed, command: "doctor" }));
          if (code !== 0) return code;
          break;
        }
        case "6":
          rl.close();
          process.removeListener("SIGINT", cancel);
          let launchCode;
          try {
            launchCode = await runLaunch({ ...parsed, command: "launch" });
          } catch (error) {
            process.stderr.write(`kiro-fabric: ${errorMessage(error)}
`);
          } finally {
            process.on("SIGINT", cancel);
            rl = createInterface({ input: process.stdin, output: process.stdout });
            rl.on("SIGINT", cancel);
          }
          if (launchCode !== void 0 && launchCode !== 0) return launchCode;
          break;
        case "q":
        case "quit":
          return 0;
        default:
          process.stdout.write("unknown choice: " + choice + "\n");
          break;
      }
    }
  } finally {
    process.removeListener("SIGINT", cancel);
    rl.close();
  }
};
var writeSetupFailure = (json, error, fallbackCode = "setup") => {
  const message = errorMessage(error);
  if (json) {
    const code = error instanceof KiroInstallError ? error.code : error instanceof UsageError ? "usage" : fallbackCode;
    process.stdout.write(JSON.stringify({ ok: false, error: { code, message } }, null, 2) + "\n");
  } else {
    process.stderr.write("kiro-fabric: " + message + "\n");
  }
};
var runKiroSetup = async (argv) => {
  const jsonRequested = argv.includes("--json");
  let parsed;
  try {
    parsed = parseSetupArgs(argv);
  } catch (error) {
    writeSetupFailure(jsonRequested, error, "usage");
    if (!jsonRequested) process.stderr.write("\n" + USAGE);
    return 2;
  }
  if (parsed.command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.command === "menu") {
    if (!isInteractive()) {
      process.stderr.write(
        "kiro-fabric: the interactive menu requires a TTY; pass a command instead\n\n" + USAGE
      );
      return 2;
    }
    return runMenu(parsed);
  }
  const io = { confirm: freshReadlineConfirm };
  try {
    switch (parsed.command) {
      case "status":
        return await runStatus(parsed);
      case "install":
      case "update":
      case "repair":
        return await runInstall(parsed, io);
      case "uninstall":
        return await runUninstall(parsed, io);
      case "doctor":
        return await runDoctor(parsed);
      case "launch":
        return await runLaunch(parsed);
      case "launch-power":
        return await runLaunchPower(parsed);
    }
  } catch (error) {
    writeSetupFailure(parsed.json, error);
    return error instanceof UsageError ? 2 : error instanceof InteractiveCancelError ? 130 : 1;
  }
  return 2;
};

// src/kiro/management.ts
var runInstalledManagement = (argv) => runKiroSetup(argv);
export {
  runInstalledManagement
};
