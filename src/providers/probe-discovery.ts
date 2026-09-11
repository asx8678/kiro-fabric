import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ProbeDiscoveryResult, ProbeProviderOptions } from "./probe-contract.js";

/** Bounded stat/access only: executableFile means a regular X_OK candidate, not a
 * successful launch or a usable SDK. No scanning cache contents or reading auth. */
export function discoverProbeExecutables(names: string[], options: Pick<ProbeProviderOptions, "discoveryEnvironment" | "sdkDirectories">, budget: number, check: () => void): ProbeDiscoveryResult {
  const env = options.discoveryEnvironment ?? process.env;
  const home = env.HOME ?? (options.discoveryEnvironment ? undefined : os.homedir());
  const result: ProbeDiscoveryResult = { executables: [], caches: [], truncated: false, executed: false, versionsObserved: false, credentialsAssumed: false };
  const bounded = (value: string): boolean => path.isAbsolute(value) && value.length <= 4000 && !value.includes("\0");
  const pathText = env.PATH ?? "";
  // Bound the text before split, not merely the number of resulting entries.
  const pathParts = pathText.slice(0, 32768).split(path.delimiter);
  if (pathText.length > 32768) { pathParts.pop(); result.truncated = true; }
  if (pathParts.length > 32) result.truncated = true;
  const pathDirs = [...new Set(pathParts.slice(0, 32).filter(item => {
    if (!item || !bounded(item)) { result.truncated = true; return false; }
    return true;
  }))];
  const sdkCandidates = [
    ...(env.DOTNET_ROOT ? [env.DOTNET_ROOT] : []),
    ...(home && bounded(home) ? [path.join(home, ".dotnet"), path.join(home, ".cargo", "bin"), path.join(home, ".local", "bin")] : []),
    "/usr/share/dotnet", "/usr/local/share/dotnet", "/opt/dotnet", ...(options.sdkDirectories ?? []),
  ];
  const sdkDirs = [...new Set(sdkCandidates.filter(bounded))].slice(0, 8);
  if (sdkCandidates.length > 8) result.truncated = true;
  const append = <T>(list: T[], item: T): void => {
    list.push(item);
    // true is shorter than false, so setting truncation cannot exceed this bound.
    if (JSON.stringify(result).length > budget) { list.pop(); result.truncated = true; }
  };
  const candidates: ProbeDiscoveryResult["executables"] = [];
  for (const name of [...new Set(names)]) {
    const seen = new Set<string>();
    for (const [source, dirs] of [["PATH", pathDirs], ["conventional-sdk", sdkDirs]] as const) {
      for (const dir of dirs) {
        check();
        const candidate = path.join(dir, name);
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        let exists = false; let executableFile = false;
        try {
          const stat = fs.statSync(candidate);
          exists = true;
          if (stat.isFile()) {
            try { fs.accessSync(candidate, fs.constants.X_OK); executableFile = true; } catch { /* presence is not executability */ }
          }
        } catch (error) {
          if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) result.truncated = true;
        }
        candidates.push({ name, path: candidate, source, exists, executableFile });
      }
    }
  }
  // Prefer found candidates over bounded negative evidence; an off-PATH SDK
  // must not disappear behind dozens of absent PATH candidates.
  candidates.sort((a, b) => Number(b.exists) - Number(a.exists));
  for (const candidate of candidates.filter(item => item.exists)) append(result.executables, candidate);
  if (home && bounded(home)) {
    for (const relative of [".nuget/packages", ".local/share/NuGet", ".npm", ".cache/pip", ".cargo/registry"]) {
      check(); const candidate = path.join(home, relative);
      let exists = false;
      try { fs.statSync(candidate); exists = true; }
      catch (error) { if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) result.truncated = true; }
      append(result.caches, { path: candidate, exists });
    }
  }
  for (const candidate of candidates.filter(item => !item.exists)) append(result.executables, candidate);
  return result;
}
