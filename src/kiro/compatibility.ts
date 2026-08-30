// Central compatibility and executable-identity policy for every Kiro surface.
// A supported tuple is Node >=24 (stable) plus the one certified Kiro CLI
// release. Kiro version output is deliberately treated as a product-identity
// assertion, not as a loose semver search.

import { execFile } from "node:child_process";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import {
  KIRO_ACP_AUTH_METHOD,
  KIRO_AGENT_ENGINE,
  KIRO_CLI_VERSION,
} from "./profile.js";

export { KIRO_ACP_AUTH_METHOD, KIRO_AGENT_ENGINE, KIRO_CLI_VERSION } from "./profile.js";

const execFileAsync = promisify(execFile);

export const MIN_NODE_MAJOR = 24 as const;
export const KIRO_BINARY_ENV = "KIRO_FABRIC_KIRO_BINARY" as const;
export const KIRO_VERSION_ENV = "KIRO_FABRIC_KIRO_VERSION" as const;

const PROBE_TIMEOUT_MS = 10_000;
const VERSION_TOKEN = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/g;
const KIRO_IDENTITY = /^kiro-cli[ \t]+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;
const NODE_IDENTITY = /^v?(\d+)\.(\d+)\.(\d+)$/;

export type KiroCompatibilityState =
  | "ok"
  | "not-found"
  | "not-executable"
  | "exec-failure"
  | "timeout"
  | "unparsable"
  | "ambiguous"
  | "wrong-product"
  | "prerelease"
  | "older"
  | "newer";

export interface KiroCompatibilityReport {
  state: KiroCompatibilityState;
  requestedPath: string;
  executablePath: string | null;
  version: string | null;
  output: string;
  ok: boolean;
}

export interface SupportedKiroIdentity extends KiroCompatibilityReport {
  state: "ok";
  executablePath: string;
  version: typeof KIRO_CLI_VERSION;
  ok: true;
}

export type NodeCompatibilityState =
  | "ok"
  | "not-found"
  | "not-executable"
  | "exec-failure"
  | "timeout"
  | "unparsable"
  | "prerelease"
  | "unsupported";

export interface NodeCompatibilityReport {
  state: NodeCompatibilityState;
  requestedPath: string;
  executablePath: string | null;
  version: string | null;
  ok: boolean;
}

export interface SupportedNodeIdentity extends NodeCompatibilityReport {
  state: "ok";
  executablePath: string;
  version: string;
  ok: true;
}

const executableCandidates = (requested: string, pathValue: string | undefined): string[] => {
  if (isAbsolute(requested) || requested.includes("/") || requested.includes("\\")) {
    return [resolve(requested)];
  }
  const directories = (pathValue ?? "").split(delimiter).filter(Boolean);
  if (process.platform !== "win32") return directories.map((directory) => resolve(directory, requested));
  const extensions = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .filter(Boolean);
  return directories.flatMap((directory) =>
    extensions.map((extension) => resolve(directory, requested + extension.toLowerCase())),
  );
};

/** Resolve PATH once, dereference symlinks, and require an executable regular file. */
export const resolveCanonicalExecutable = (
  requested: string,
  pathValue = process.env.PATH,
): { path: string } | { error: "not-found" | "not-executable" } => {
  let sawNonExecutable = false;
  for (const candidate of executableCandidates(requested, pathValue)) {
    try {
      const canonical = realpathSync(candidate);
      const stat = statSync(canonical);
      if (!stat.isFile()) {
        sawNonExecutable = true;
        continue;
      }
      if (process.platform !== "win32") accessSync(canonical, constants.X_OK);
      return { path: canonical };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") sawNonExecutable = true;
    }
  }
  return { error: sawNonExecutable ? "not-executable" : "not-found" };
};

const compareStableVersions = (left: string, right: string): number => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
};

export const classifyKiroVersionOutput = (
  output: string,
  requestedPath = "kiro-cli",
  executablePath: string | null = null,
): KiroCompatibilityReport => {
  const text = output.trim();
  const tokens = text.match(VERSION_TOKEN) ?? [];
  const base = { requestedPath, executablePath, output: text, ok: false as const };
  if (tokens.length === 0) {
    return { ...base, state: "unparsable", version: null };
  }
  if (tokens.length !== 1) {
    return { ...base, state: "ambiguous", version: null };
  }
  const identity = KIRO_IDENTITY.exec(text);
  if (!identity) {
    return { ...base, state: "wrong-product", version: tokens[0]! };
  }
  const version = identity[1]!;
  if (version.includes("-")) return { ...base, state: "prerelease", version };
  if (version.includes("+")) return { ...base, state: "wrong-product", version };
  const comparison = compareStableVersions(version, KIRO_CLI_VERSION);
  if (comparison < 0) return { ...base, state: "older", version };
  if (comparison > 0) return { ...base, state: "newer", version };
  return {
    requestedPath,
    executablePath,
    output: text,
    state: "ok",
    version: KIRO_CLI_VERSION,
    ok: true,
  };
};

const failedProbeState = (error: unknown): "timeout" | "exec-failure" => {
  const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
  return failure.killed === true || failure.code === "ETIMEDOUT" || failure.signal === "SIGTERM"
    ? "timeout"
    : "exec-failure";
};

export const inspectKiroCompatibility = async (
  requestedPath = "kiro-cli",
): Promise<KiroCompatibilityReport> => {
  const resolved = resolveCanonicalExecutable(requestedPath);
  if ("error" in resolved) {
    return {
      state: resolved.error,
      requestedPath,
      executablePath: null,
      version: null,
      output: "",
      ok: false,
    };
  }
  try {
    const { stdout, stderr } = await execFileAsync(resolved.path, ["--version"], {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      encoding: "utf8",
    });
    return classifyKiroVersionOutput(
      `${String(stdout)}\n${String(stderr)}`,
      requestedPath,
      resolved.path,
    );
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string };
    return {
      state: failedProbeState(error),
      requestedPath,
      executablePath: resolved.path,
      version: null,
      output: `${detail.stdout ?? ""}\n${detail.stderr ?? ""}`.trim(),
      ok: false,
    };
  }
};

const describeKiroCompatibilityFailure = (report: KiroCompatibilityReport): string => {
  const observed = report.output || report.version || report.requestedPath;
  switch (report.state) {
    case "ok": return "supported";
    case "not-found": return `Kiro CLI executable not found: ${report.requestedPath}`;
    case "not-executable": return `Kiro CLI path is not an executable regular file: ${report.requestedPath}`;
    case "timeout": return `Kiro CLI version probe timed out: ${report.requestedPath}`;
    case "exec-failure": return `Kiro CLI version probe failed: ${report.requestedPath}`;
    case "unparsable": return `unparsable kiro-cli version output ${JSON.stringify(observed)}`;
    case "ambiguous": return `ambiguous kiro-cli version output ${JSON.stringify(observed)}`;
    case "wrong-product": return `wrong product identity in kiro-cli version output ${JSON.stringify(observed)}`;
    case "prerelease": return `unsupported kiro-cli prerelease ${JSON.stringify(report.version)}; expected ${KIRO_CLI_VERSION}`;
    case "older": return `unsupported kiro-cli version ${JSON.stringify(report.version)}; expected ${KIRO_CLI_VERSION}`;
    case "newer": return `uncertified newer kiro-cli version ${JSON.stringify(report.version)}; expected ${KIRO_CLI_VERSION}`;
  }
};

export const assertSupportedKiro = async (
  requestedPath = "kiro-cli",
): Promise<SupportedKiroIdentity> => {
  const report = await inspectKiroCompatibility(requestedPath);
  if (!report.ok) throw new Error(describeKiroCompatibilityFailure(report));
  return report as SupportedKiroIdentity;
};

export const classifyNodeVersion = (
  version: string,
  requestedPath: string,
  executablePath: string | null,
): NodeCompatibilityReport => {
  const normalized = version.trim();
  if (normalized.includes("-")) {
    return { state: "prerelease", requestedPath, executablePath, version: normalized, ok: false };
  }
  const match = NODE_IDENTITY.exec(normalized);
  if (!match) {
    return { state: "unparsable", requestedPath, executablePath, version: null, ok: false };
  }
  const stable = `${match[1]}.${match[2]}.${match[3]}`;
  if (Number(match[1]) < MIN_NODE_MAJOR) {
    return { state: "unsupported", requestedPath, executablePath, version: stable, ok: false };
  }
  return { state: "ok", requestedPath, executablePath, version: stable, ok: true };
};

export const inspectNodeCompatibility = async (
  requestedPath = process.execPath,
): Promise<NodeCompatibilityReport> => {
  const resolved = resolveCanonicalExecutable(requestedPath);
  if ("error" in resolved) {
    return { state: resolved.error, requestedPath, executablePath: null, version: null, ok: false };
  }
  // The current process is already authoritative and avoids another child on status.
  if (resolved.path === realpathSync(process.execPath)) {
    return classifyNodeVersion(process.versions.node, requestedPath, resolved.path);
  }
  try {
    const { stdout, stderr } = await execFileAsync(resolved.path, ["--version"], {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      encoding: "utf8",
    });
    if (String(stderr).trim() !== "") {
      return { state: "unparsable", requestedPath, executablePath: resolved.path, version: null, ok: false };
    }
    return classifyNodeVersion(String(stdout), requestedPath, resolved.path);
  } catch (error) {
    return {
      state: failedProbeState(error),
      requestedPath,
      executablePath: resolved.path,
      version: null,
      ok: false,
    };
  }
};

export const assertSupportedNode = async (
  requestedPath = process.execPath,
): Promise<SupportedNodeIdentity> => {
  const report = await inspectNodeCompatibility(requestedPath);
  if (!report.ok) {
    throw new Error(
      `unsupported Node executable ${JSON.stringify(requestedPath)} (${report.state}); require stable Node >=${MIN_NODE_MAJOR}`,
    );
  }
  return report as SupportedNodeIdentity;
};

/** Compare a requested executable with a persisted canonical identity. */
export const sameExecutableIdentity = (requested: string, canonical: string): boolean => {
  const resolved = resolveCanonicalExecutable(requested);
  return !("error" in resolved) && resolved.path === canonical;
};
