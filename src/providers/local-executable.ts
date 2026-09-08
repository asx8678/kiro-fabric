import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";

const MISSING_RG = "ripgrep (rg) is required for local.grep/local.find but was not found";

/** Search is an explicitly selected host executable, not an OS sandbox. No
 * ambient loader, credential, HOME, or ripgrep configuration reaches it. */
export const searchEnvironment = (): NodeJS.ProcessEnv => ({ LANG: "C.UTF-8", LC_ALL: "C" });

export interface ManagedSearchExecutable {
  generationRoot: string;
  path: string;
  sha256: string;
  mode: 0o700;
  /** Exact release version (optional exact upstream revision banner). */
  version: string;
}
export interface SearchExecutable { path: string; version: string; dev: number; ino: number; managed?: ManagedSearchExecutable }

/** Manifest identity is a same-user integrity check, not OS isolation. */
function verifyManagedExecutable(expected: ManagedSearchExecutable): void {
  if (!path.isAbsolute(expected.generationRoot) || fs.realpathSync(expected.generationRoot) !== expected.generationRoot ||
      expected.path !== path.join(expected.generationRoot, "tools", "rg") ||
      fs.realpathSync(expected.path) !== expected.path || expected.mode !== 0o700 ||
      !/^[a-f0-9]{64}$/u.test(expected.sha256) || !/^ripgrep \d+\.\d+\.\d+(?: .*)?$/u.test(expected.version)) {
    throw new Error("managed ripgrep containment or expected identity is invalid");
  }
  for (const directory of [expected.generationRoot, path.join(expected.generationRoot, "tools")]) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o7777) !== 0o700 ||
        (process.getuid && stat.uid !== process.getuid())) throw new Error("managed ripgrep directory trust changed");
  }
  const stat = fs.lstatSync(expected.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o7777) !== expected.mode ||
      (process.getuid && stat.uid !== process.getuid()) ||
      createHash("sha256").update(fs.readFileSync(expected.path)).digest("hex") !== expected.sha256) {
    throw new Error("managed ripgrep hash or mode identity changed");
  }
}
export function verifySearchExecutable(executable: SearchExecutable): void {
  if (executable.managed) verifyManagedExecutable(executable.managed);
  let stat: fs.Stats;
  try { stat = fs.lstatSync(executable.path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(MISSING_RG);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== executable.dev || stat.ino !== executable.ino ||
      (stat.mode & 0o022) !== 0 || (stat.mode & 0o111) === 0 ||
      (process.getuid && stat.uid !== 0 && stat.uid !== process.getuid())) {
    throw new Error("ripgrep executable identity or trust changed; restart after repairing rg");
  }
}

export function resolveSearchExecutable(managed?: ManagedSearchExecutable): SearchExecutable {
  if (managed !== undefined) {
    const expected = Object.freeze({ ...managed });
    verifyManagedExecutable(expected);
    const stat = fs.lstatSync(expected.path);
    const executable: SearchExecutable = { path: expected.path, version: expected.version, dev: stat.dev, ino: stat.ino, managed: expected };
    const version = execFileSync(expected.path, ["--no-config", "--version"], { encoding: "utf8", env: searchEnvironment(), timeout: 2000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] }).split("\n")[0];
    const banner = /^(ripgrep \d+\.\d+\.\d+)(?: \(rev [a-f0-9]+\))?$/u.exec(version ?? "");
    if (!banner || (version !== expected.version && banner[1] !== expected.version)) throw new Error("managed ripgrep version identity mismatch");
    executable.version = version!;
    verifySearchExecutable(executable);
    return executable;
  }
  // Ignore relative/empty PATH components: workspace files never select rg.
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    let target: string;
    try { target = fs.realpathSync(path.join(directory, "rg")); }
    catch (error) {
      if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
      throw error;
    }
    const stat = fs.lstatSync(target);
    const executable: SearchExecutable = { path: target, version: "", dev: stat.dev, ino: stat.ino };
    verifySearchExecutable(executable);
    try {
      const version = execFileSync(target, ["--no-config", "--version"], { encoding: "utf8", env: searchEnvironment(), timeout: 2000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] }).split("\n")[0]!;
      if (!/^ripgrep \d+\.\d+/u.test(version)) throw new Error("unexpected version response");
      executable.version = version.slice(0, 200);
      verifySearchExecutable(executable);
      return executable;
    } catch { throw new Error("ripgrep (rg) prerequisite check failed; install a working ripgrep executable"); }
  }
  throw new Error(MISSING_RG);
}
