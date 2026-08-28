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
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";

import {
  assertNoSymlinkComponents,
  ensureManagedDirectory,
  KiroInstallError,
  lstatOrNull,
  readPackageVersion,
  type KiroManagedLayout,
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
  /** Bounded phase timing and size metrics (PR1). */
  metrics: RuntimeClosureMetrics;
}

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
  options?: { force?: boolean },
): RuntimeClosureResult => {
  const startWall = Date.now();
  const packageRoot = resolveSourcePackageRoot();
  const digest = computeRuntimeClosureDigest(packageRoot);
  const runtimeDir = runtimeClosurePath(installRoot, layout);
  const versionDir = join(runtimeDir, digest);
  const versionMcpEntry = join(versionDir, "kiro", "mcp-entry.js");
  const marker = join(runtimeDir, ".closure-current");

  const metadata: RuntimeClosureMetrics = {
    stageMs: 0,
    publishMs: 0,
    totalMs: 0,
    fileCount: 0,
    bytes: 0,
  };

  // If this digest is already published and current, no work is needed.
  if (!options?.force && existsSync(versionMcpEntry)) {
    const markerDigest = existsSync(marker)
      ? readFileSync(marker, "utf8").trim()
      : "";
    if (markerDigest !== digest) {
      writeFileSync(marker, digest + "\n", { mode: 0o644 });
    }
    metadata.totalMs = Date.now() - startWall;
    return {
      runtimeDir,
      mcpEntryPath: versionMcpEntry,
      digest,
      updated: false,
      metrics: metadata,
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

  // Ensure a stale staging directory from a crash is cleaned before reuse.
  const stagingDir = stagingDirFor(runtimeDir);
  for (const existing of readdirSync(runtimeDir)) {
    if (existing.startsWith(".staging-")) {
      rmSync(join(runtimeDir, existing), { recursive: true, force: true });
    }
  }

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

    // Atomic publish: rename the completed staging directory into place. This
    // is a single same-filesystem rename; the old runtime is untouched.
    const publishStart = Date.now();
    if (existsSync(versionDir)) {
      rmSync(versionDir, { recursive: true, force: true });
    }
    renameSync(stagingDir, versionDir);
    writeFileSync(marker, digest + "\n", { mode: 0o644 });
    metadata.publishMs = Date.now() - publishStart;
    metadata.totalMs = Date.now() - startWall;

    return {
      runtimeDir,
      mcpEntryPath: versionMcpEntry,
      digest,
      updated: true,
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

/**
 * Remove the runtime closure directory. Called during uninstall.
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
