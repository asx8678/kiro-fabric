import fs from "node:fs";
import path from "node:path";
/** Native analysis uses only an explicitly verified host Git or the fixed OS
 * Git. PATH, project configuration and environment never choose an executable. */
export function resolveFoveaGit(explicit?: string): string | undefined {
  const candidate = explicit ?? "/usr/bin/git";
  let canonical: string;
  try { canonical = fs.realpathSync(candidate); } catch (error) { if (!explicit && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  if (!path.isAbsolute(candidate) || canonical !== candidate) throw new Error("Fovea Git path must be canonical");
  const file = fs.lstatSync(candidate);
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || !(file.mode & 0o111) || (file.mode & 0o022) || (process.getuid && file.uid !== 0 && file.uid !== process.getuid())) throw new Error("Fovea Git executable is not trusted");
  for (let directory = path.dirname(candidate);;) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022) || (process.getuid && stat.uid !== 0 && stat.uid !== process.getuid())) throw new Error("Fovea Git executable ancestry is not trusted");
    const next = path.dirname(directory); if (next === directory) break; directory = next;
  }
  return candidate;
}
