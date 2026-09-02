import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);


// src/kiro/canonical-path.ts
import {
  lstatSync,
  realpathSync,
  statSync
} from "node:fs";
import path from "node:path";
var inspectCanonicalPath = (value, options = {}) => {
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
      ctimeNs: typeof targetStats.ctimeNs === "bigint" ? targetStats.ctimeNs : void 0
    }
  };
};
var canonicalPathContains = (canonicalAncestor, canonicalTarget) => {
  const relative = path.relative(canonicalAncestor, canonicalTarget);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
var sameCanonicalFilesystemIdentity = (left, right, options = {}) => left.dev === right.dev && left.ino === right.ino && (options.includeCtime !== true || left.ctimeNs !== void 0 && right.ctimeNs !== void 0 && left.ctimeNs === right.ctimeNs);

export {
  inspectCanonicalPath,
  canonicalPathContains,
  sameCanonicalFilesystemIdentity
};
