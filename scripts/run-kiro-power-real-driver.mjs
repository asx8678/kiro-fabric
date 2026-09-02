#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REAL_CLIENT_NATIVE_CAPABILITIES, REAL_CLIENT_SESSION_COMMAND, REAL_CLIENT_TOOLS, transcriptEntry } from "./real-client-evidence.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const valueAfter = (argv, flag) => { const index = argv.indexOf(flag); return index < 0 ? undefined : argv[index + 1]; };
export const resolveKiroCli = (pathValue = process.env.PATH ?? "") => {
  for (const directory of pathValue.split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, process.platform === "win32" ? "kiro-cli.exe" : "kiro-cli");
    try {
      const resolved = fs.realpathSync(candidate); const stats = fs.lstatSync(resolved);
      if (stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1 && (process.platform === "win32" || ((stats.mode & 0o111) !== 0 && (stats.mode & 0o022) === 0))) return resolved;
    } catch { /* try next PATH directory */ }
  }
  throw new Error("A private, non-writable kiro-cli executable was not found on absolute PATH entries");
};
const run = (executable, args, options = {}) => {
  const result = spawnSync(executable, args, { encoding: "buffer", maxBuffer: 128_000, timeout: options.timeout ?? 60_000, input: options.input, env: options.env ?? process.env, cwd: options.cwd });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`kiro-cli ${args.join(" ")} exited with status ${result.status ?? "unknown"}`);
  return Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]);
};
export const runRealKiroPowerDriver = ({ packageRoot, packageDigest, archiveDigest, commit, driverDigest, output, workspace }) => {
  if (typeof workspace !== "string" || !path.isAbsolute(workspace)) throw new Error("Real-client qualification workspace must be absolute");
  const requestedWorkspace = path.resolve(workspace);
  const workspaceStats = fs.lstatSync(requestedWorkspace);
  if (!workspaceStats.isDirectory() || workspaceStats.isSymbolicLink() ||
      (process.platform !== "win32" && ((typeof process.getuid === "function" && workspaceStats.uid !== process.getuid()) || (workspaceStats.mode & 0o077) !== 0)) ||
      fs.readdirSync(requestedWorkspace).length !== 0) {
    throw new Error("Real-client qualification workspace must be a private empty regular directory");
  }
  const workspaceRoot = fs.realpathSync(requestedWorkspace);
  const executable = resolveKiroCli();
  const before = fs.readFileSync(executable); const kiroDigest = hash(before);
  const stats = fs.statSync(executable);
  const environment = { ...process.env, PWD: workspaceRoot };
  const versionRaw = run(executable, ["--version"], { cwd: workspaceRoot, env: environment });
  const nonce = randomBytes(24).toString("hex");
  const prompt = `Import and enable the Kiro Power at ${packageRoot}. Using kiro-cli v3 only, list its MCP tools and invoke fabric_info, fabric_workspace, and fabric_exec. Then independently exercise native file-read, file-edit, shell, web, and subagent capabilities with every native file or shell effect confined to the empty qualification workspace at ${workspaceRoot}. Return one JSON object with qualificationNonce=${nonce}, powerActivated=true, tools=${JSON.stringify(REAL_CLIENT_TOOLS)}, customAgentSelected=false, and nativeCapabilities=${JSON.stringify(REAL_CLIENT_NATIVE_CAPABILITIES.map((name) => ({ name, observed: true })))}.\n`;
  const sessionRaw = run(executable, ["--v3"], { input: Buffer.from(prompt), timeout: 45 * 60_000, cwd: workspaceRoot, env: environment });
  const afterStats = fs.statSync(executable); const after = fs.readFileSync(executable);
  if (stats.dev !== afterStats.dev || stats.ino !== afterStats.ino || hash(after) !== kiroDigest) throw new Error("kiro-cli changed during qualification");
  const text = sessionRaw.toString("utf8");
  const objects = [...text.matchAll(/\{[^\n]*\}/gu)].map((match) => { try { return JSON.parse(match[0]); } catch { return null; } }).filter(Boolean);
  const observation = objects.find((entry) => entry.qualificationNonce === nonce);
  if (!observation || observation.powerActivated !== true || JSON.stringify(observation.tools) !== JSON.stringify(REAL_CLIENT_TOOLS) || observation.customAgentSelected !== false || JSON.stringify(observation.nativeCapabilities) !== JSON.stringify(REAL_CLIENT_NATIVE_CAPABILITIES.map((name) => ({ name, observed: true })))) throw new Error("Real Kiro output did not contain the exact nonce-bound qualification observations");
  const evidence = {
    packageDigest, archiveDigest, commit, sessionCommand: REAL_CLIENT_SESSION_COMMAND,
    powerActivated: true, tools: REAL_CLIENT_TOOLS, customAgentSelected: false,
    driver: { digest: driverDigest, version: "repository-driver-v1" },
    kiro: { path: executable, digest: kiroDigest, version: versionRaw.toString("utf8").trim().slice(0, 256) },
    nativeCapabilities: observation.nativeCapabilities,
    transcript: [
      transcriptEntry("kiro-version", versionRaw),
      transcriptEntry("power-activation", sessionRaw),
      transcriptEntry("mcp-tools-list", sessionRaw),
      transcriptEntry("native-capability-probes", sessionRaw),
    ],
  };
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: "wx" });
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = valueAfter(process.argv, "--output");
  const workspace = valueAfter(process.argv, "--workspace");
  if (!output) throw new Error("--output is required");
  if (!workspace) throw new Error("--workspace is required");
  const script = fs.readFileSync(fileURLToPath(import.meta.url));
  runRealKiroPowerDriver({
    packageRoot: path.resolve(valueAfter(process.argv, "--package") ?? ""),
    packageDigest: valueAfter(process.argv, "--package-digest"), archiveDigest: valueAfter(process.argv, "--archive-digest"),
    commit: valueAfter(process.argv, "--commit"), driverDigest: hash(script), output: path.resolve(output), workspace: path.resolve(workspace),
  });
}
