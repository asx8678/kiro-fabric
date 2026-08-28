// Runtime closure management. Copies the pre-built self-contained bundle
// (dist/kiro-closure/) into the managed .kiro-fabric tree so the installed
// profile executes without depending on the source checkout or the global
// npm installation path. The closure is built by scripts/build-kiro-closure.mjs
// and bundles all runtime dependencies inline (zero node_modules needed).

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import {
  assertNoSymlinkComponents,
  ensureManagedDirectory,
  KiroInstallError,
  lstatOrNull,
  readPackageVersion,
  sha256Bytes,
  writeAtomic,
  type KiroManagedLayout,
  type KiroRuntimeClosureManifest,
} from "./managed.js";

/**
 * Relative path within the managed tree where the runtime closure is deployed.
 *
 * Deployments are content-addressed: each published closure lives under an
 * immutable `runtime/<digest>/` directory so an install is never destructive
 * to an already-referenced runtime. The digest is computed over every
 * deployable file's canonical relative path AND full content bytes (PR1:
 * full-content digest), so same-size chunk-content changes still invalidate
 * it.
 */
const RUNTIME_DIR_RELATIVE: Record<KiroManagedLayout, string> = {
  project: ".kiro/.kiro-fabric/runtime",
  user: ".kiro-fabric/runtime",
};

/**
 * Root that holds content-addressed closure versions
 * (`<root>/<digest>/kiro/mcp-entry.js`).
 */
export const runtimeClosurePath = (
  installRoot: string,
  layout: KiroManagedLayout,
): string => join(installRoot, ...RUNTIME_DIR_RELATIVE[layout].split("/"));

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
  // import.meta.dirname is dist/kiro/ or src/kiro/
  const candidates = [
    resolve(import.meta.dirname, "..", ".."),  // dist/kiro/../../ = package root
    resolve(import.meta.dirname, ".."),        // fallback
  ];
  for (const candidate of candidates) {
    if (
      existsSync(join(candidate, "package.json")) &&
      existsSync(join(candidate, "dist", "kiro-closure", "kiro", "mcp-entry.js"))
    ) {
      return candidate;
    }
  }
  throw new KiroInstallError(
    "fs",
    `cannot resolve source package root from ${import.meta.dirname}; run pnpm build first`,
  );
};

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
  const closureDir = join(packageRoot, "dist", "kiro-closure");
  const files = closureFileList(closureDir);
  for (const rel of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(join(closureDir, ...rel.split("/"))));
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
  /** The content digest of the deployed closure. */
  digest: string;
  /** Whether a new closure version was published (false when already current). */
  updated: boolean;
  /** Exact filesystem operation required for this closure. */
  action: "publish" | "activate" | "noop";
  /** Exact final published file-set attestation. */
  attestation: KiroRuntimeClosureManifest;
  /** Bounded phase timing and size metrics (PR1). */
  metrics: RuntimeClosureMetrics;
}

/** Pure deployment plan used by dry-run and the real installer preflight. */
export type RuntimeClosurePlan = RuntimeClosureResult;

export const planRuntimeClosureDeployment = (
  installRoot: string,
  layout: KiroManagedLayout,
): RuntimeClosurePlan => {
  const packageRoot = resolveSourcePackageRoot();
  const digest = computeRuntimeClosureDigest(packageRoot);
  const sourceDir = join(packageRoot, "dist", "kiro-closure");
  const sourceFiles = closureFileList(sourceDir);
  const runtimeDir = runtimeClosurePath(installRoot, layout);
  const mcpEntryPath = join(runtimeDir, digest, "kiro", "mcp-entry.js");
  const marker = join(runtimeDir, ".closure-current");
  const markerStat = lstatOrNull(marker);
  if (markerStat && (markerStat.isSymbolicLink() || !markerStat.isFile())) {
    throw new KiroInstallError("symlink", "runtime closure marker is not a regular file");
  }
  const markerDigest = markerStat ? readFileSync(marker, "utf8").trim() : "";
  const published = existsSync(mcpEntryPath);
  const runtimeRoot = relative(installRoot, join(runtimeDir, digest)).split(sep).join("/");
  const generatedPackage = JSON.stringify({
    name: "kiro-fabric-runtime-closure",
    version: readPackageVersion(),
    digest,
    fileCount: sourceFiles.length,
  }) + "\n";
  const attested = sourceFiles
    .filter((rel) => rel !== "package.json")
    .map((rel) => ({
      path: runtimeRoot + "/" + rel,
      installedSha256: sha256Bytes(readFileSync(join(sourceDir, ...rel.split("/")))),
    }));
  attested.push(
    { path: runtimeRoot + "/.closure-digest", installedSha256: sha256Bytes(digest + "\n") },
    { path: runtimeRoot + "/package.json", installedSha256: sha256Bytes(generatedPackage) },
  );
  attested.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return {
    runtimeDir,
    mcpEntryPath,
    digest,
    updated: !published,
    action: !published ? "publish" : markerDigest === digest ? "noop" : "activate",
    attestation: { digest, root: runtimeRoot, files: attested },
    metrics: {
      stageMs: 0,
      publishMs: 0,
      totalMs: 0,
      fileCount: sourceFiles.length,
      bytes: sourceFiles.reduce(
        (total, rel) => total + statSync(join(sourceDir, ...rel.split("/"))).size,
        0,
      ),
    },
  };
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
 * `runtime/<digest>/`. The old runtime is NEVER removed before the new one is
 * fully in place, so an interrupted install always leaves either the previous
 * complete runtime or the complete new runtime. Source maps are excluded.
 */
export const deployRuntimeClosure = (
  installRoot: string,
  layout: KiroManagedLayout,
  options?: { force?: boolean; expectedDigest?: string },
): RuntimeClosureResult => {
  const startWall = Date.now();
  const packageRoot = resolveSourcePackageRoot();
  const planned = planRuntimeClosureDeployment(installRoot, layout);
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

  // Digest directories are immutable. Re-hash the exact installed tree before
  // trusting the content-addressed name; --force never recursively replaces it.
  if (existsSync(versionMcpEntry)) {
    verifyRuntimeClosureAttestation(installRoot, planned.attestation);
    const markerNow = lstatOrNull(marker);
    if (markerNow && (markerNow.isSymbolicLink() || !markerNow.isFile())) {
      throw new KiroInstallError("symlink", "runtime closure marker is not a regular file");
    }
    const markerDigest = markerNow ? readFileSync(marker, "utf8").trim() : "";
    if (markerDigest !== digest) writeClosureMarker(runtimeDir, digest);
    metadata.totalMs = Date.now() - startWall;
    return {
      runtimeDir,
      mcpEntryPath: versionMcpEntry,
      digest,
      updated: false,
      action: markerDigest === digest ? "noop" : "activate",
      attestation: planned.attestation,
      metrics: { ...metadata, fileCount: planned.metrics.fileCount, bytes: planned.metrics.bytes },
    };
  }

  // Ensure parent managed directory exists.
  ensureManagedDirectory(runtimeDir);
  assertNoSymlinkComponents(installRoot, versionDir);

  // Source: the pre-built closure bundle.
  const closureSource = join(packageRoot, "dist", "kiro-closure");
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
    metadata.stageMs = Date.now() - stageStart;

    // Atomic immutable publish. A racing publisher may win before this point;
    // its exact final tree must attest identically and is never replaced.
    const publishStart = Date.now();
    if (existsSync(versionDir)) {
      rmSync(stagingDir, { recursive: true, force: true });
      verifyRuntimeClosureAttestation(installRoot, planned.attestation);
    } else {
      renameSync(stagingDir, versionDir);
    }
    writeClosureMarker(runtimeDir, digest);
    metadata.publishMs = Date.now() - publishStart;
    metadata.totalMs = Date.now() - startWall;

    return {
      runtimeDir,
      mcpEntryPath: versionMcpEntry,
      digest,
      updated: true,
      action: "publish",
      attestation: planned.attestation,
      metrics: metadata,
    };
  } catch (error) {
    // Clean up staging on failure. The prior runtime is left intact.
    try {
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

export const verifyRuntimeClosureAttestation = (
  installRoot: string,
  closure: KiroRuntimeClosureManifest,
): void => {
  const root = join(installRoot, ...closure.root.split("/"));
  assertNoSymlinkComponents(installRoot, root);
  const rootStat = lstatOrNull(root);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new KiroInstallError("ownership", "installed runtime closure root is missing or invalid: " + root);
  }
  const actual = publishedClosureFileList(root).map((rel) => closure.root + "/" + rel);
  const expected = closure.files.map((file) => file.path);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new KiroInstallError("ownership", "installed runtime closure file set does not match manifest");
  }
  for (const file of closure.files) {
    const path = join(installRoot, ...file.path.split("/"));
    const bytes = readFileSync(path);
    if (sha256Bytes(bytes) !== file.installedSha256) {
      throw new KiroInstallError("ownership", "installed runtime closure hash mismatch: " + file.path);
    }
  }
};

export const removeAttestedRuntimeClosure = (
  installRoot: string,
  layout: KiroManagedLayout,
  closure: KiroRuntimeClosureManifest,
): boolean => {
  const root = join(installRoot, ...closure.root.split("/"));
  if (!existsSync(root)) return false;
  verifyRuntimeClosureAttestation(installRoot, closure);
  for (const file of [...closure.files].sort((left, right) => right.path.length - left.path.length)) {
    unlinkSync(join(installRoot, ...file.path.split("/")));
  }
  const removeEmpty = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) removeEmpty(join(dir, entry.name));
    }
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  };
  removeEmpty(root);
  const runtimeDir = runtimeClosurePath(installRoot, layout);
  const marker = join(runtimeDir, ".closure-current");
  const markerStat = lstatOrNull(marker);
  if (markerStat) {
    if (markerStat.isSymbolicLink() || !markerStat.isFile()) {
      throw new KiroInstallError("symlink", "runtime closure marker is invalid");
    }
    if (readFileSync(marker, "utf8").trim() === closure.digest) unlinkSync(marker);
  }
  if (existsSync(runtimeDir) && readdirSync(runtimeDir).length === 0) rmdirSync(runtimeDir);
  return true;
};

/**
 * Legacy recursive removal for format-1 manifests only.
 */
export const removeRuntimeClosure = (
  installRoot: string,
  layout: KiroManagedLayout,
): boolean => {
  const runtimeDir = runtimeClosurePath(installRoot, layout);
  if (!existsSync(runtimeDir)) return false;
  rmSync(runtimeDir, { recursive: true, force: true });
  return true;
};
