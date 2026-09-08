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

// src/providers/local-executable.ts
import fs from "node:fs";
import { createHash } from "node:crypto";
import path2 from "node:path";
import { execFileSync } from "node:child_process";
var MISSING_RG = "ripgrep (rg) is required for local.grep/local.find but was not found";
var searchEnvironment = () => ({ LANG: "C.UTF-8", LC_ALL: "C" });
function verifyManagedExecutable(expected) {
  if (!path2.isAbsolute(expected.generationRoot) || fs.realpathSync(expected.generationRoot) !== expected.generationRoot || expected.path !== path2.join(expected.generationRoot, "tools", "rg") || fs.realpathSync(expected.path) !== expected.path || expected.mode !== 448 || !/^[a-f0-9]{64}$/u.test(expected.sha256) || !/^ripgrep \d+\.\d+\.\d+(?: .*)?$/u.test(expected.version)) {
    throw new Error("managed ripgrep containment or expected identity is invalid");
  }
  for (const directory of [expected.generationRoot, path2.join(expected.generationRoot, "tools")]) {
    const stat2 = fs.lstatSync(directory);
    if (!stat2.isDirectory() || stat2.isSymbolicLink() || (stat2.mode & 4095) !== 448 || process.getuid && stat2.uid !== process.getuid()) throw new Error("managed ripgrep directory trust changed");
  }
  const stat = fs.lstatSync(expected.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 4095) !== expected.mode || process.getuid && stat.uid !== process.getuid() || createHash("sha256").update(fs.readFileSync(expected.path)).digest("hex") !== expected.sha256) {
    throw new Error("managed ripgrep hash or mode identity changed");
  }
}
function verifySearchExecutable(executable) {
  if (executable.managed) verifyManagedExecutable(executable.managed);
  let stat;
  try {
    stat = fs.lstatSync(executable.path);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(MISSING_RG);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== executable.dev || stat.ino !== executable.ino || (stat.mode & 18) !== 0 || (stat.mode & 73) === 0 || process.getuid && stat.uid !== 0 && stat.uid !== process.getuid()) {
    throw new Error("ripgrep executable identity or trust changed; restart after repairing rg");
  }
}
function resolveSearchExecutable(managed) {
  if (managed !== void 0) {
    const expected = Object.freeze({ ...managed });
    verifyManagedExecutable(expected);
    const stat = fs.lstatSync(expected.path);
    const executable = { path: expected.path, version: expected.version, dev: stat.dev, ino: stat.ino, managed: expected };
    const version = execFileSync(expected.path, ["--no-config", "--version"], { encoding: "utf8", env: searchEnvironment(), timeout: 2e3, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] }).split("\n")[0];
    const banner = /^(ripgrep \d+\.\d+\.\d+)(?: \(rev [a-f0-9]+\))?$/u.exec(version ?? "");
    if (!banner || version !== expected.version && banner[1] !== expected.version) throw new Error("managed ripgrep version identity mismatch");
    executable.version = version;
    verifySearchExecutable(executable);
    return executable;
  }
  for (const directory of (process.env.PATH ?? "").split(path2.delimiter)) {
    if (!path2.isAbsolute(directory)) continue;
    let target;
    try {
      target = fs.realpathSync(path2.join(directory, "rg"));
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code ?? "")) continue;
      throw error;
    }
    const stat = fs.lstatSync(target);
    const executable = { path: target, version: "", dev: stat.dev, ino: stat.ino };
    verifySearchExecutable(executable);
    try {
      const version = execFileSync(target, ["--no-config", "--version"], { encoding: "utf8", env: searchEnvironment(), timeout: 2e3, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] }).split("\n")[0];
      if (!/^ripgrep \d+\.\d+/u.test(version)) throw new Error("unexpected version response");
      executable.version = version.slice(0, 200);
      verifySearchExecutable(executable);
      return executable;
    } catch {
      throw new Error("ripgrep (rg) prerequisite check failed; install a working ripgrep executable");
    }
  }
  throw new Error(MISSING_RG);
}

export {
  searchEnvironment,
  verifySearchExecutable,
  resolveSearchExecutable,
  inspectCanonicalPath,
  canonicalPathContains,
  sameCanonicalFilesystemIdentity
};
