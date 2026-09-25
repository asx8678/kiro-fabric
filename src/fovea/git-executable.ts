import fs from "node:fs";
import path from "node:path";
/** Native analysis uses only an explicitly verified host Git or the fixed OS
 * Git. PATH, project configuration and environment never choose an executable. */
export function resolveFoveaGit(explicit?: string): string | undefined {
  // Apple's /usr/bin/git is a hard-linked xcrun shim. Select the fixed
  // Command Line Tools binary on Darwin instead, retaining all trust checks.
  // No PATH/xcode-select/environment fallback if the optional tool is absent.
  const candidate = explicit ?? (process.platform === "darwin"
    ? "/Library/Developer/CommandLineTools/usr/bin/git"
    : "/usr/bin/git");
  let canonical: string;
  try { canonical = fs.realpathSync(candidate); } catch (error) { if (!explicit && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  if (!path.isAbsolute(candidate) || canonical !== candidate) throw new Error("Navigator Git path must be canonical");
  const file = fs.lstatSync(candidate);
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || !(file.mode & 0o111) || (file.mode & 0o022) || (process.getuid && file.uid !== 0 && file.uid !== process.getuid())) throw new Error("Navigator Git executable is not trusted");
  for (let directory = path.dirname(candidate);;) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022) || (process.getuid && stat.uid !== 0 && stat.uid !== process.getuid())) throw new Error("Navigator Git executable ancestry is not trusted");
    const next = path.dirname(directory); if (next === directory) break; directory = next;
  }
  return candidate;
}
