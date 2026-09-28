import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const MISSING_RG = "ripgrep (rg) is required for local.grep/local.find but was not found";

/** Search is an explicitly selected host executable, not an OS sandbox. No
 * ambient loader, credential, HOME, or ripgrep configuration reaches it. */
export const searchEnvironment = (): NodeJS.ProcessEnv => ({ LANG: "C.UTF-8", LC_ALL: "C" });

export interface SearchExecutable { path: string; version: string; dev: number; ino: number }

export function verifySearchExecutable(executable: SearchExecutable): void {
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

export function resolveSearchExecutable(): SearchExecutable {
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
