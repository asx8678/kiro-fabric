// Runtime closure management. Copies the pre-built self-contained bundle
// (dist/kiro-closure/) into the managed .fabric runtime tree so the installed
// profile executes without depending on the source checkout or the global
// npm installation path. The closure is built by scripts/build-kiro-closure.mjs
// and bundles all runtime dependencies inline (zero node_modules needed).

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
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import {
  assertExecutableAttestation,
  assertNoSymlinkComponents,
  attestExecutable,
  copyAttestedExecutable,
  ensureManagedDirectory,
  fsyncDirectory,
  KiroInstallError,
  lstatOrNull,
  managedPaths,
  readPackageVersion,
  sha256Bytes,
  withContainedParent,
  writeAtomic,
  type ExecutableAttestation,
  type KiroManagedLayout,
  type KiroRuntimeClosureManifest,
} from "./managed.js";
import { runBeforeRuntimeQuarantineForTest } from "./runtime-closure-test-seam.js";

/**
 * Root that holds content-addressed closure versions
 * (`<install-root>/.fabric/runtime/<digest>/kiro/mcp-entry.js`). Keeping the
 * executable closure outside Kiro's profile directory makes the runtime
 * location explicit while profile discovery remains under `.kiro/agents`.
 */
export const runtimeClosurePath = (
  installRoot: string,
  layout: KiroManagedLayout,
): string => managedPaths(installRoot, layout).runtimeDir;

const runtimeDirectoryForClosure = (
  installRoot: string,
  layout: KiroManagedLayout,
  closure: Pick<KiroRuntimeClosureManifest, "digest" | "root">,
): string => {
  const root = join(installRoot, ...closure.root.split("/"));
  const runtimeDir = dirname(root);
  const paths = managedPaths(installRoot, layout);
  const expectedRoots = [paths.runtimeDir, paths.legacyRuntimeDir]
    .map((parent) => relative(installRoot, join(parent, closure.digest)).split(sep).join("/"));
  if (
    basename(root) !== closure.digest ||
    !expectedRoots.includes(closure.root) ||
    (runtimeDir !== paths.runtimeDir && runtimeDir !== paths.legacyRuntimeDir)
  ) {
    throw new KiroInstallError("ownership", "runtime generation root is outside a managed runtime parent");
  }
  return runtimeDir;
};

/** Marker for an attested active closure, including pre-.fabric installations. */
export const runtimeClosureMarkerPath = (
  installRoot: string,
  layout: KiroManagedLayout,
  closure: Pick<KiroRuntimeClosureManifest, "digest" | "root">,
): string => join(runtimeDirectoryForClosure(installRoot, layout, closure), ".closure-current");

/**
 * Entry point for the current digest-addressed closure. As this is a fixed
 * name used in legacy installs and tests before content addressing, it points
 * at a legacy (non-digest) `runtime/kiro/mcp-entry.js` when a legacy layout is
 * still present, otherwise honors the directory's `.closure-current` pointer.
 * Deployments write `.closure-current` to resolve this entry without scanning.
 */
export const runtimeClosureMcpEntry = (
  installRoot: string,
  layout: KiroManagedLayout,
): string => {
  const runtimeDir = runtimeClosurePath(installRoot, layout);
  const marker = join(runtimeDir, ".closure-current");
  if (existsSync(marker)) {
    const digest = readFileSync(marker, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(digest)) {
      return join(runtimeDir, digest, "kiro", "mcp-entry.js");
    }
  }
  return join(runtimeDir, "kiro", "mcp-entry.js");
};

/**
 * Resolves the source package root from import.meta context. Works whether
 * invoked from dist/kiro/ (normal) or src/kiro/ (test harness via ts path).
 */
export const resolveSourcePackageRoot = (): string => {
  // import.meta.dirname is dist/kiro/, src/kiro/, or <release>/kiro/ for the
  // detached self-hosted manager. An installed release is itself a complete
  // update/repair artifact; no npm/source origin is required.
  const candidates = [
    resolve(import.meta.dirname, ".."),
    resolve(import.meta.dirname, "..", ".."),
  ];
  for (const [index, candidate] of candidates.entries()) {
    const packagePath = join(candidate, "package.json");
    if (!existsSync(packagePath)) continue;
    const packaged = join(candidate, "dist", "kiro-closure", "kiro", "mcp-entry.js");
    const installed = join(candidate, "kiro", "mcp-entry.js");
    let pkg: { name?: string; digest?: string };
    try {
      pkg = JSON.parse(readFileSync(packagePath, "utf8")) as typeof pkg;
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
    if (
      index === 1 && pkg.name === "kiro-fabric" &&
      existsSync(packaged) && existsSync(join(candidate, "skills"))
    ) return candidate;
    throw new KiroInstallError("ownership", "unexpected immediate Fabric artifact metadata");
  }
  throw new KiroInstallError(
    "fs",
    `cannot resolve current Fabric artifact from ${import.meta.dirname}; run pnpm build first`,
  );
};

const closureSourceDirectory = (packageRoot: string): string => {
  const packaged = join(packageRoot, "dist", "kiro-closure");
  return existsSync(join(packaged, "kiro", "mcp-entry.js")) ? packaged : packageRoot;
};

const MANAGED_RELEASE_SKILL_FILES = [
  "fabric-exec/SKILL.md",
  "fabric-exec/references/agents.md",
  "fabric-exec/references/mcp.md",
  "fabric-guide/SKILL.md",
  "fabric-review/SKILL.md",
  "fabric-workflow/SKILL.md",
] as const;

const managedReleaseSkillPath = (packageRoot: string, relativePath: string): string => {
  const strictPath = join(packageRoot, "strict", "skills", ...relativePath.split("/"));
  return existsSync(strictPath) ? strictPath : join(packageRoot, "skills", ...relativePath.split("/"));
};

const nodeExecutableName = (): string => process.platform === "win32" ? "node.exe" : "node";

/**
 * Files copied into a deployed closure. Anything outside these extensions
 * (notably `.js.map` source maps, which are excluded for production) is
 * rejected. `package.json` and zero-node_modules stub are always included.
 */
const isDeployableFile = (relativePath: string): boolean =>
  relativePath.endsWith(".js") ||
  // TS lib files ship with the closure so the bundled compiler can resolve its
  // default `lib.es*.d.ts` chain at runtime (Promise/reference globals).
  relativePath.endsWith(".d.ts") ||
  relativePath === "package.json";

/**
 * Deterministically enumerate all deployable closure files as canonical
 * POSIX-style relative paths (sorted for stability across platforms).
 * Rejects symlinks and unexpected file types throughout the traversal.
 */
const closureFileList = (closureDir: string): string[] => {
  const files: string[] = [];
  const visit = (dir: string, prefix: string): void => {
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
      // Ignore sockets/devices/fifos rather than shipping them.
    }
  };
  if (existsSync(join(closureDir, "kiro", "mcp-entry.js"))) visit(closureDir, "");
  return files.sort();
};

/** Where a staging directory is created so `renameSync` is same-filesystem. */
const stagingDirFor = (runtimeDir: string): string =>
  join(runtimeDir, `.staging-${process.pid}-${Date.now().toString(36)}`);

/** Reject `.map` files (and any non-JS non-package.json) from a staged copy. */
const deployableSourceFilter = (src: string): boolean => {
  const stat = lstatOrNull(src);
  if (!stat) return false;
  if (stat.isDirectory()) return true;
  return isDeployableFile(src.slice(src.lastIndexOf("/") + 1));
};

/**
 * Compute a full-content digest over the closure source directory.
 *
 * Unlike the previous implementation (package version + entry content +
 * chunk names/sizes), this hashes every deployable file's canonical relative
 * path AND full content bytes, so a same-size chunk-content change, renamed
 * file, or added/removed file all invalidate the digest.
 */
export const computeRuntimeClosureDigest = (packageRoot: string): string => {
  const hash = createHash("sha256");
  hash.update("kiro-fabric-runtime-closure-v2\0");
  hash.update(readPackageVersion() + "\0");
  const closureDir = closureSourceDirectory(packageRoot);
  const files = closureFileList(closureDir);
  for (const rel of files) {
    // package.json is generated canonically for the release, so the installed
    // release can reproduce its own artifact digest during detached repair.
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

export interface RuntimeClosureMetrics {
  /** Milliseconds of the copy+stage+fsync phase. */
  stageMs: number;
  /** Milliseconds of the atomic rename/publish phase. */
  publishMs: number;
  /** Total deployment wall time in milliseconds. */
  totalMs: number;
  /** Number of deployable files in the published closure. */
  fileCount: number;
  /** Total bytes copied. */
  bytes: number;
}

export interface RuntimeClosureResult {
  /** Absolute path to the content-addressed runtime root (parent of digest). */
  runtimeDir: string;
  /** Absolute path to the deployed, digest-addressed mcp-entry.js. */
  mcpEntryPath: string;
  /** Attested Node copied into this immutable release. */
  runtimeNodePath: string;
  /** Installed Kiro execution artifact copied from the private staged inode. */
  runtimeKiroPath: string;
  /** Self-hosted lifecycle entry executed by runtimeNodePath. */
  managementEntryPath: string;
  /** The content digest of the deployed closure. */
  digest: string;
  /** Whether a new closure version was published (false when already current). */
  updated: boolean;
  /** Exact filesystem operation required for this closure. */
  action: "publish" | "repair" | "activate" | "noop";
  /** Exact final published file-set attestation. */
  attestation: KiroRuntimeClosureManifest;
  /** Bounded phase timing and size metrics (PR1). */
  metrics: RuntimeClosureMetrics;
}

/** Pure deployment plan used by dry-run and the real installer preflight. */
export type RuntimeClosurePlan = RuntimeClosureResult;

export interface RuntimeClosureDeploymentOptions {
  /** Injectable runtime artifact for unit fixtures; production uses the certified bootstrap Node. */
  nodeSourcePath?: string;
  /** Descriptor-bound identity retained from installer staging. */
  nodeAttestation?: ExecutableAttestation;
  /** Private staged Kiro artifact; production installer always supplies this. */
  kiroAttestation?: ExecutableAttestation;
  /** Verify and atomically restore a damaged same-digest release from this source artifact. */
  repairExisting?: boolean;
}

export const planRuntimeClosureDeployment = (
  installRoot: string,
  layout: KiroManagedLayout,
  options: RuntimeClosureDeploymentOptions = {},
): RuntimeClosurePlan => {
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
      "runtime closure deployment requires a separately attested Kiro executable",
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
    fileCount: sourceFiles.length + MANAGED_RELEASE_SKILL_FILES.length + 2,
  }) + "\n";
  const attested: KiroRuntimeClosureManifest["files"] = sourceFiles
    .filter((rel) => rel !== "package.json")
    .map((rel) => ({
      path: runtimeRoot + "/" + rel,
      installedSha256: sha256Bytes(readFileSync(join(sourceDir, ...rel.split("/")))),
    }));
  for (const rel of MANAGED_RELEASE_SKILL_FILES) {
    attested.push({
      path: runtimeRoot + "/skills/" + rel,
      installedSha256: sha256Bytes(readFileSync(managedReleaseSkillPath(packageRoot, rel))),
    });
  }
  attested.push(
    { path: runtimeRoot + "/.closure-digest", installedSha256: sha256Bytes(digest + "\n") },
    { path: runtimeRoot + "/bin/" + nodeExecutableName(), installedSha256: nodeAttestation.sha256, executableMode: 0o555 },
    { path: runtimeRoot + "/bin/" + (process.platform === "win32" ? "kiro-cli.exe" : "kiro-cli"), installedSha256: kiroAttestation.sha256, executableMode: 0o555 },
    { path: runtimeRoot + "/package.json", installedSha256: sha256Bytes(generatedPackage) },
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
      if (!(error instanceof KiroInstallError) || (error.code !== "ownership" && error.code !== "fs")) {
        throw error;
      }
      damaged = true;
    }
  }
  const skillBytes = MANAGED_RELEASE_SKILL_FILES.reduce(
    (total, rel) => total + statSync(managedReleaseSkillPath(packageRoot, rel)).size,
    0,
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
        nodeAttestation.size + kiroAttestation.size + skillBytes,
      ),
    },
  };
};

const ensurePrivateRuntimeDirectory = (runtimeDir: string): void => {
  ensureManagedDirectory(runtimeDir);
  const stat = lstatSync(runtimeDir);
  if (process.geteuid && stat.uid !== process.geteuid()) {
    throw new KiroInstallError("ownership", "managed runtime directory is not owned by the effective user");
  }
  if ((stat.mode & 0o777) !== 0o700) chmodSync(runtimeDir, 0o700);
  fsyncDirectory(dirname(runtimeDir));
};

const repairJournalPath = (runtimeDir: string, digest: string): string =>
  join(runtimeDir, `.repair-${digest}.json`);

const damagedGenerationPath = (runtimeDir: string, digest: string): string =>
  join(runtimeDir, `.damaged-${digest}`);

const serializeRepairJournal = (closure: KiroRuntimeClosureManifest): string =>
  JSON.stringify({ format: 1, digest: closure.digest, root: closure.root }, null, 2) + "\n";

export const runtimeClosureRepairJournalPath = (
  installRoot: string,
  layout: KiroManagedLayout,
  digest: string,
): string => repairJournalPath(runtimeClosurePath(installRoot, layout), digest);

export const hasPendingRuntimeClosureRepair = (
  installRoot: string,
  layout: KiroManagedLayout,
  digest: string,
): boolean => existsSync(runtimeClosureRepairJournalPath(installRoot, layout, digest));

const makeRuntimeTreeRemovable = (dir: string): void => {
  const stat = lstatOrNull(dir);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new KiroInstallError("symlink", "damaged runtime root is not a real directory");
  }
  chmodSync(dir, 0o700);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) makeRuntimeTreeRemovable(join(dir, entry.name));
  }
};

/** Recover either side of the two-rename same-digest repair protocol. */
export const recoverRuntimeClosureRepair = (
  installRoot: string,
  layout: KiroManagedLayout,
  closure: KiroRuntimeClosureManifest,
): boolean => {
  const runtimeDir = runtimeDirectoryForClosure(installRoot, layout, closure);
  const journal = repairJournalPath(runtimeDir, closure.digest);
  const journalStat = lstatOrNull(journal);
  if (!journalStat) return false;
  if (journalStat.isSymbolicLink() || !journalStat.isFile()) {
    throw new KiroInstallError("symlink", "runtime repair journal is not a regular file");
  }
  let record: unknown;
  try { record = JSON.parse(readFileSync(journal, "utf8")); } catch {
    throw new KiroInstallError("manifest", "runtime repair journal is malformed");
  }
  if (
    typeof record !== "object" || record === null || Array.isArray(record) ||
    (record as { format?: unknown }).format !== 1 ||
    (record as { digest?: unknown }).digest !== closure.digest ||
    (record as { root?: unknown }).root !== closure.root
  ) {
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
      // Both names means the replacement rename completed. Prove it before
      // discarding the parked original.
      verifyRuntimeClosureAttestation(installRoot, closure);
      makeRuntimeTreeRemovable(damagedDir);
      rmSync(damagedDir, { recursive: true, force: false });
      fsyncDirectory(runtimeDir);
    } else {
      // Journal-only is the kill point before the first rename (the reason for
      // repair may be that this version does not attest). A valid version can
      // also mean cleanup finished just before journal unlink; both converge by
      // consuming the journal and letting a damaged version be repaired anew.
      try { verifyRuntimeClosureAttestation(installRoot, closure); } catch { /* retry on next repair */ }
    }
  } else {
    throw new KiroInstallError("fs", "runtime repair lost both the original and replacement generation");
  }
  unlinkSync(journal);
  fsyncDirectory(runtimeDir);
  return true;
};

const writeClosureMarker = (runtimeDir: string, digest: string): void => {
  const marker = join(runtimeDir, ".closure-current");
  const markerStat = lstatOrNull(marker);
  if (markerStat && (markerStat.isSymbolicLink() || !markerStat.isFile())) {
    throw new KiroInstallError("symlink", "runtime closure marker is not a regular file");
  }
  writeAtomic(marker, digest + "\n", 0o600);
};

/**
 * Deploy (or update) the runtime closure.
 *
 * PR1 correctness: publication is content-addressed and non-destructive. Each
 * digest is staged as a sibling then atomically `renameSync`d into
 * `runtime/<digest>/`. Publication never mutates an existing release. Explicit
 * trusted repair swaps a damaged same-digest directory only after the staged
 * replacement attests completely. Source maps are excluded.
 */
export const deployRuntimeClosure = (
  installRoot: string,
  layout: KiroManagedLayout,
  options?: {
    force?: boolean;
    expectedDigest?: string;
    nodeSourcePath?: string;
    nodeAttestation?: ExecutableAttestation;
    kiroAttestation?: ExecutableAttestation;
    /** Restore a damaged release only from this invocation's trusted source. */
    repairExisting?: boolean;
    /** Installer activation is committed with profile+manifest, not here. */
    activate?: boolean;
  },
): RuntimeClosureResult => {
  const startWall = Date.now();
  const packageRoot = resolveSourcePackageRoot();
  const kiroAttestation = options?.kiroAttestation;
  if (!kiroAttestation) {
    throw new KiroInstallError(
      "kiro-version",
      "runtime closure deployment requires a separately attested Kiro executable",
    );
  }
  const planned = planRuntimeClosureDeployment(installRoot, layout, {
    ...(options?.nodeSourcePath ? { nodeSourcePath: options.nodeSourcePath } : {}),
    ...(options?.nodeAttestation ? { nodeAttestation: options.nodeAttestation } : {}),
    kiroAttestation,
    ...(options?.repairExisting ? { repairExisting: true } : {}),
  });
  const digest = planned.digest;
  if (options?.expectedDigest !== undefined && options.expectedDigest !== digest) {
    throw new KiroInstallError(
      "concurrency",
      "runtime closure changed after preflight: expected " + options.expectedDigest + ", got " + digest,
    );
  }
  const runtimeDir = planned.runtimeDir;
  const versionDir = join(runtimeDir, digest);
  const versionMcpEntry = planned.mcpEntryPath;
  const marker = join(runtimeDir, ".closure-current");

  const metadata: RuntimeClosureMetrics = {
    stageMs: 0,
    publishMs: 0,
    totalMs: 0,
    fileCount: 0,
    bytes: 0,
  };

  // Re-hash the exact installed tree before trusting the content-addressed
  // name. Ordinary publication refuses drift; trusted repair stages a complete
  // replacement and swaps the directory without mutating leaves in place.
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
      metrics: { ...metadata, fileCount: planned.metrics.fileCount, bytes: planned.metrics.bytes },
    };
  }

  // Ensure uninstall's quarantine precondition is established by install.
  ensurePrivateRuntimeDirectory(runtimeDir);
  assertNoSymlinkComponents(installRoot, versionDir);

  // Source: the pre-built closure bundle.
  const closureSource = closureSourceDirectory(packageRoot);
  if (!existsSync(join(closureSource, "kiro", "mcp-entry.js"))) {
    throw new KiroInstallError(
      "fs",
      `runtime closure source not found at ${closureSource}; run the full build first`,
    );
  }

  // Each operation owns one unique sibling staging directory and never removes
  // another publisher's staging tree.
  const stagingDir = stagingDirFor(runtimeDir);

  const stageStart = Date.now();
  try {
    mkdirSync(stagingDir, { recursive: true, mode: 0o700 });

    // Copy deployable files, EXCLUDING source maps and any non-JS/JSON.
    let bytes = 0;
    let fileCount = 0;
    cpSync(closureSource, stagingDir, {
      recursive: true,
      filter: (src) => {
        if (!deployableSourceFilter(src)) return false;
        if (!lstatOrNull(src)?.isDirectory()) bytes += statSync(src).size;
        return true;
      },
    });
    fileCount = closureFileList(stagingDir).length;

    // Complete immutable release: exact managed skill sources support detached
    // repair/update, and the current certified Node is copied as an executable
    // rather than rediscovered through process.execPath or PATH after install.
    for (const rel of MANAGED_RELEASE_SKILL_FILES) {
      const target = join(stagingDir, "skills", ...rel.split("/"));
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(managedReleaseSkillPath(packageRoot, rel), target);
      bytes += statSync(target).size;
      fileCount += 1;
    }
    const stagedNode = join(stagingDir, "bin", nodeExecutableName());
    mkdirSync(dirname(stagedNode), { recursive: true, mode: 0o700 });
    const nodeSource = options?.nodeAttestation ?? attestExecutable(options?.nodeSourcePath ?? process.execPath);
    copyAttestedExecutable(nodeSource, stagedNode, 0o555);
    bytes += nodeSource.size;
    fileCount += 1;
    const stagedKiro = join(stagingDir, "bin", process.platform === "win32" ? "kiro-cli.exe" : "kiro-cli");
    const kiroSource = kiroAttestation;
    copyAttestedExecutable(kiroSource, stagedKiro, 0o555);
    bytes += kiroSource.size;
    fileCount += 1;
    metadata.fileCount = fileCount;
    metadata.bytes = bytes;

    // Write an idempotency marker inside the versioned directory.
    writeFileSync(join(stagingDir, ".closure-digest"), digest + "\n", { mode: 0o644 });
    writeFileSync(join(stagingDir, "package.json"), JSON.stringify({
      name: "kiro-fabric-runtime-closure",
      version: readPackageVersion(),
      digest,
      fileCount,
    }) + "\n", { mode: 0o644 });

    // Verify every staged byte and executable mode before publication, then
    // fsync each leaf and directory so rename cannot expose an undurable release.
    for (const file of planned.attestation.files) {
      const rel = file.path.slice(planned.attestation.root.length + 1);
      const stagedPath = join(stagingDir, ...rel.split("/"));
      if (sha256Bytes(readFileSync(stagedPath)) !== file.installedSha256) {
        throw new KiroInstallError("ownership", "staged release hash mismatch: " + rel);
      }
      if (file.executableMode !== undefined && (statSync(stagedPath).mode & 0o777) !== file.executableMode) {
        throw new KiroInstallError("ownership", "staged release executable mode mismatch: " + rel);
      }
      const descriptor = openSync(stagedPath, "r");
      try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    }
    const syncDirs = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) syncDirs(join(dir, entry.name));
      }
      let descriptor: number | undefined;
      try {
        descriptor = openSync(dir, "r");
        fsyncSync(descriptor);
      } catch {
        // Directory fsync/open is unavailable on some platforms/filesystems.
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
    };
    syncDirs(stagingDir);
    metadata.stageMs = Date.now() - stageStart;

    // Seal every release leaf and directory before publication. This keeps
    // normal Fabric workspace operations from mutating runtime bytes and makes
    // accidental writes fail even when they bypass the higher-level guard.
    const seal = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) seal(full);
        else chmodSync(full, full === stagedNode || full === stagedKiro ? 0o555 : 0o444);
      }
      chmodSync(dir, 0o555);
    };
    seal(stagingDir);

    // Atomic immutable publish. A racing publisher may win before this point;
    // its exact final tree must attest identically and is never replaced.
    const publishStart = Date.now();
    if (existsSync(versionDir)) {
      if (planned.action === "repair") {
        const damagedDir = damagedGenerationPath(runtimeDir, digest);
        const journal = repairJournalPath(runtimeDir, digest);
        if (existsSync(damagedDir) || existsSync(journal)) {
          throw new KiroInstallError("concurrency", "a same-digest runtime repair is already pending recovery");
        }
        writeAtomic(journal, serializeRepairJournal(planned.attestation), 0o600);
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
        const unsealStaging = (dir: string): void => {
          chmodSync(dir, 0o700);
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
      metrics: metadata,
    };
  } catch (error) {
    // A repair journal is durable before either rename. Converge it now when
    // possible; after SIGKILL the next locked installer performs the same step.
    try {
      if (hasPendingRuntimeClosureRepair(installRoot, layout, digest)) {
        recoverRuntimeClosureRepair(installRoot, layout, planned.attestation);
      }
    } catch {
      // Preserve the original failure and durable journal for explicit retry.
    }
    // Clean up staging on failure. The prior runtime is left intact. A failure
    // after sealing must first restore directory owner-write permissions.
    try {
      const unseal = (dir: string): void => {
        const stat = lstatOrNull(dir);
        if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return;
        chmodSync(dir, 0o700);
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) unseal(join(dir, entry.name));
        }
      };
      unseal(stagingDir);
      rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
    metadata.totalMs = Date.now() - startWall;
    throw new KiroInstallError(
      "fs",
      `failed to deploy runtime closure: ${(error as Error).message}`,
    );
  }
};

const publishedClosureFileList = (root: string): string[] => {
  const files: string[] = [];
  const visit = (dir: string, prefix: string): void => {
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

const verifyRuntimeClosureAtRoot = (
  closure: KiroRuntimeClosureManifest,
  root: string,
): void => {
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
    const path = join(root, ...relativePath.split("/"));
    const bytes = readFileSync(path);
    if (sha256Bytes(bytes) !== file.installedSha256) {
      throw new KiroInstallError("ownership", "installed runtime closure hash mismatch: " + file.path);
    }
    const mode = statSync(path).mode & 0o777;
    const expectedMode = file.executableMode ?? 0o444;
    if (mode !== expectedMode) {
      throw new KiroInstallError("ownership", "installed runtime release mode mismatch: " + file.path);
    }
  }
  const verifyDirectories = (dir: string): void => {
    if ((statSync(dir).mode & 0o777) !== 0o555) {
      throw new KiroInstallError("ownership", "installed runtime directory is not sealed read-only: " + dir);
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) verifyDirectories(join(dir, entry.name));
    }
  };
  verifyDirectories(root);
};

export const verifyRuntimeClosureAttestation = (
  installRoot: string,
  closure: KiroRuntimeClosureManifest,
): void => {
  const root = join(installRoot, ...closure.root.split("/"));
  assertNoSymlinkComponents(installRoot, root);
  verifyRuntimeClosureAtRoot(closure, root);
};

interface HeldPathIdentity {
  path: string;
  descriptor: number;
  dev: bigint | number;
  ino: bigint | number;
  file: boolean;
}

const sameHeldIdentity = (held: HeldPathIdentity, path: string): boolean => {
  try {
    const pathStat = lstatSync(path, { bigint: true });
    const openStat = fstatSync(held.descriptor, { bigint: true });
    return !pathStat.isSymbolicLink() && openStat.dev === held.dev && openStat.ino === held.ino &&
      pathStat.dev === held.dev && pathStat.ino === held.ino;
  } catch {
    return false;
  }
};

const assertPrivateOwnedDirectory = (path: string, label: string, exactMode?: number): void => {
  if ((process.platform !== "linux" && process.platform !== "darwin") || !process.geteuid) {
    throw new KiroInstallError(
      "ownership",
      "safe attested quarantine deletion is unavailable on this platform; refusing cleanup",
    );
  }
  // A Linux descriptor-relative /proc path is a magic link, so stat (not
  // lstat) intentionally checks the held directory it names.
  const stat = label === "runtime" ? statSync(path) : lstatSync(path);
  if (!stat.isDirectory() || (label !== "runtime" && stat.isSymbolicLink()) ||
      stat.uid !== process.geteuid() || (stat.mode & 0o077) !== 0 ||
      (exactMode !== undefined && (stat.mode & 0o777) !== exactMode)) {
    throw new KiroInstallError("ownership", `${label} directory is not private and owned by the effective user`);
  }
};

const holdClosureIdentity = (
  closure: KiroRuntimeClosureManifest,
  root: string,
): HeldPathIdentity[] => {
  const held: HeldPathIdentity[] = [];
  const hold = (path: string, file: boolean): HeldPathIdentity => {
    const descriptor = openSync(
      path,
      constants.O_RDONLY | (file ? 0 : constants.O_DIRECTORY) | (constants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(descriptor, { bigint: true });
    const identity = { path, descriptor, dev: stat.dev, ino: stat.ino, file };
    if (!sameHeldIdentity(identity, path) || (file ? !stat.isFile() : !stat.isDirectory())) {
      closeSync(descriptor);
      throw new KiroInstallError("concurrency", "quarantined runtime identity changed while opening: " + path);
    }
    held.push(identity);
    return identity;
  };
  try {
    hold(root, false);
    const directories = new Set<string>([root]);
    for (const record of closure.files) {
      const relativePath = record.path.slice(closure.root.length + 1);
      const path = join(root, ...relativePath.split("/"));
      let cursor = dirname(path);
      while (cursor !== root) {
        directories.add(cursor);
        cursor = dirname(cursor);
      }
      const identity = hold(path, true);
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

const assertHeldIdentities = (held: HeldPathIdentity[]): void => {
  for (const identity of held) {
    if (!sameHeldIdentity(identity, identity.path)) {
      throw new KiroInstallError("concurrency", "quarantined runtime was replaced after verification: " + identity.path);
    }
  }
};

const closeHeldIdentities = (held: HeldPathIdentity[]): void => {
  for (const identity of held.reverse()) closeSync(identity.descriptor);
};

export const removeAttestedRuntimeClosure = (
  installRoot: string,
  layout: KiroManagedLayout,
  closure: KiroRuntimeClosureManifest,
): boolean => {
  const root = join(installRoot, ...closure.root.split("/"));
  if (!existsSync(root)) return false;
  const runtimeDir = runtimeDirectoryForClosure(installRoot, layout, closure);
  return withContainedParent(installRoot, root, (parent, leaf) => {
    const source = join(parent, leaf);
    const quarantinedRoot = join(parent, `.quarantine-generation-${process.pid}-${randomBytes(8).toString("hex")}`);
    assertPrivateOwnedDirectory(parent, "runtime");
    let held: HeldPathIdentity[] = [];
    let deletionStarted = false;
    runBeforeRuntimeQuarantineForTest("generation", source);
    renameSync(source, quarantinedRoot);
    try {
      verifyRuntimeClosureAtRoot(closure, quarantinedRoot);
      chmodSync(quarantinedRoot, 0o700);
      assertPrivateOwnedDirectory(quarantinedRoot, "quarantine", 0o700);
      held = holdClosureIdentity(closure, quarantinedRoot);
      runBeforeRuntimeQuarantineForTest("generation-post-verify", quarantinedRoot);
      assertHeldIdentities(held);
      const unsealDirectories = (dir: string): void => {
        chmodSync(dir, 0o700);
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
      if (!deletionStarted && (!rootIdentity || sameHeldIdentity(rootIdentity, quarantinedRoot)) &&
          existsSync(quarantinedRoot) && !existsSync(source)) {
        chmodSync(quarantinedRoot, 0o555);
        renameSync(quarantinedRoot, source);
      }
      throw error;
    } finally {
      closeHeldIdentities(held);
    }
  });
};

export const removeRuntimeActivationMarker = (
  installRoot: string,
  layout: KiroManagedLayout,
  expectedDigest: string,
  closure?: Pick<KiroRuntimeClosureManifest, "digest" | "root">,
): boolean => {
  if (closure && closure.digest !== expectedDigest) {
    throw new KiroInstallError("ownership", "runtime activation digest differs from its closure");
  }
  const runtimeDir = closure
    ? runtimeDirectoryForClosure(installRoot, layout, closure)
    : runtimeClosurePath(installRoot, layout);
  const marker = join(runtimeDir, ".closure-current");
  const markerStat = lstatOrNull(marker);
  if (!markerStat) return false;
  withContainedParent(installRoot, marker, (parent, leaf) => {
    const source = join(parent, leaf);
    const quarantinedMarker = join(parent, `.quarantine-marker-${process.pid}-${randomBytes(8).toString("hex")}`);
    assertPrivateOwnedDirectory(parent, "runtime");
    let held: HeldPathIdentity | undefined;
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
      if ((!held || sameHeldIdentity(held, quarantinedMarker)) &&
          existsSync(quarantinedMarker) && !existsSync(source)) {
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

export const removeRuntimeClosure = (
  installRoot: string,
  layout: KiroManagedLayout,
): boolean => {
  const runtimeDir = runtimeClosurePath(installRoot, layout);
  if (!existsSync(runtimeDir)) return false;
  const makeRemovable = (dir: string): void => {
    const stat = lstatOrNull(dir);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new KiroInstallError("symlink", "legacy runtime root is not a real directory");
    }
    chmodSync(dir, 0o700);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) makeRemovable(join(dir, entry.name));
    }
  };
  makeRemovable(runtimeDir);
  rmSync(runtimeDir, { recursive: true, force: true });
  return true;
};
