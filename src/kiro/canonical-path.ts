import {
  lstatSync,
  realpathSync,
  statSync,
  type BigIntStats,
  type Stats,
} from "node:fs";
import path from "node:path";

/** Filesystem identity for one resolved object. ctime protects short approval
 * windows from delete/recreate and inode-reuse races; long-lived bindings may
 * intentionally compare only dev/ino because directory ctime changes during
 * normal repository work. */
export interface CanonicalFilesystemIdentity {
  dev: bigint;
  ino: bigint;
  ctimeNs: bigint | undefined;
}

/** One path spelling and the exact object to which the filesystem resolved it.
 * `lexicalPath` is diagnostic/input provenance only. Authorization, hashes,
 * containment, persistence, and user approval must use `canonicalPath`. */
export interface CanonicalPathIdentity {
  lexicalPath: string;
  canonicalPath: string;
  finalEntryIsSymlink: boolean;
  lexicalStats: Stats;
  targetStats: BigIntStats;
  identity: CanonicalFilesystemIdentity;
}

export interface InspectCanonicalPathOptions {
  kind?: "directory" | "file";
  rejectFinalSymlink?: boolean;
}

/** Resolve an existing path while distinguishing a parent-component alias
 * (for example macOS `/var` -> `/private/var`) from a symlink at the selected
 * final entry. */
export const inspectCanonicalPath = (
  value: string,
  options: InspectCanonicalPathOptions = {},
): CanonicalPathIdentity => {
  if (!path.isAbsolute(value)) throw new Error("path must be absolute");
  const lexicalPath = path.resolve(value);
  const lexicalStats = lstatSync(lexicalPath);
  const canonicalPath = realpathSync(lexicalPath);
  const targetStats = statSync(canonicalPath, { bigint: true });
  const finalEntryIsSymlink = lexicalStats.isSymbolicLink();
  if (options.rejectFinalSymlink && finalEntryIsSymlink) {
    throw new Error("selected entry must not be a symlink");
  }
  if (options.kind === "directory" && !targetStats.isDirectory()) {
    throw new Error("selected entry must be a directory");
  }
  if (options.kind === "file" && !targetStats.isFile()) {
    throw new Error("selected entry must be a regular file");
  }
  return {
    lexicalPath,
    canonicalPath,
    finalEntryIsSymlink,
    lexicalStats,
    targetStats,
    identity: {
      dev: targetStats.dev,
      ino: targetStats.ino,
      ctimeNs: typeof targetStats.ctimeNs === "bigint" ? targetStats.ctimeNs : undefined,
    },
  };
};

/** Canonical containment predicate. Callers must pass realpath-derived paths;
 * keeping the word in the API makes accidental lexical/canonical mixing
 * visible during review. */
export const canonicalPathContains = (
  canonicalAncestor: string,
  canonicalTarget: string,
): boolean => {
  const relative = path.relative(canonicalAncestor, canonicalTarget);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

export const sameCanonicalFilesystemIdentity = (
  left: CanonicalFilesystemIdentity,
  right: CanonicalFilesystemIdentity,
  options: { includeCtime?: boolean } = {},
): boolean => left.dev === right.dev && left.ino === right.ino && (
  options.includeCtime !== true ||
  (left.ctimeNs !== undefined && right.ctimeNs !== undefined && left.ctimeNs === right.ctimeNs)
);
