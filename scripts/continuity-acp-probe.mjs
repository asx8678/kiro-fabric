#!/usr/bin/env node
// Read-only Kiro preflight for the continuity handoff / managed-rotation plan.
// Runs `kiro-cli --version`, `kiro-cli acp --help` and a settings QUERY only.
// It never starts a session, never authenticates, never sends a prompt and
// never writes settings. Output is a JSON report on stdout.
import { spawn } from "node:child_process";
import process from "node:process";

const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const USAGE = `usage: node scripts/continuity-acp-probe.mjs [--help] [--kiro-cli <path>] [--timeout-ms <ms>]

Read-only preflight for explicit continuity handoff:
  kiro-cli --version
  kiro-cli acp --help
  kiro-cli settings chat.disableAutoCompaction   (query only)

No session, no inference, no settings mutation. The report always records
qualified:false and managedRotationAvailable:false; live gates stay pending
until separately authorized qualification runs.`;

function parseArguments(argv) {
  const options = { kiroCli: "kiro-cli", timeoutMs: DEFAULT_TIMEOUT_MS, help: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--kiro-cli") {
      const value = argv[++index];
      if (value === undefined || value === "") throw new Error("--kiro-cli requires a path");
      options.kiroCli = value;
    } else if (argument === "--timeout-ms") {
      const value = Number(argv[++index]);
      if (!Number.isSafeInteger(value) || value < 1000 || value > 120000) throw new Error("--timeout-ms requires 1000..120000");
      options.timeoutMs = value;
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function runBounded(command, args, timeoutMs) {
  return new Promise(resolve => {
    let child;
    try { child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) { resolve({ ok: false, reason: `spawn failed: ${error.message}` }); return; }
    let stdout = "", stderr = "", bytes = 0, settled = false, timer;
    const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    timer = setTimeout(() => { child.kill("SIGKILL"); finish({ ok: false, reason: "timeout" }); }, timeoutMs);
    child.stdout.on("data", chunk => { bytes += chunk.length; if (bytes > MAX_OUTPUT_BYTES) { child.kill("SIGKILL"); finish({ ok: false, reason: "output limit" }); return; } stdout += chunk; });
    child.stderr.on("data", chunk => { bytes += chunk.length; if (bytes > MAX_OUTPUT_BYTES) { child.kill("SIGKILL"); finish({ ok: false, reason: "output limit" }); return; } stderr += chunk; });
    child.on("error", error => finish({ ok: false, reason: `spawn failed: ${error.message}` }));
    child.on("close", code => finish({ ok: true, code, stdout, stderr }));
  });
}

let options;
try { options = parseArguments(process.argv.slice(2)); }
catch (error) { process.stderr.write(`${USAGE}\n${error.message}\n`); process.exit(2); }
if (options.help) { console.log(USAGE); process.exit(0); }

const version = await runBounded(options.kiroCli, ["--version"], options.timeoutMs);
const help = await runBounded(options.kiroCli, ["acp", "--help"], options.timeoutMs);
const setting = await runBounded(options.kiroCli, ["settings", "chat.disableAutoCompaction"], options.timeoutMs);

const helpText = help.ok ? `${help.stdout}\n${help.stderr}` : "";
const engineDiscovered = /--agent-engine/.test(helpText);
const v3Listed = engineDiscovered && /\bv3\b/.test(helpText);
const report = {
  schemaVersion: 1,
  qualified: false,
  managedRotationAvailable: false,
  liveGates: "pending: this preflight starts no session and proves nothing about installed v3 engine behavior",
  preflight: {
    kiroVersion: version.ok && version.code === 0 ? version.stdout.trim() : null,
    kiroVersionProbe: version.ok ? { exitCode: version.code } : { error: version.reason },
    acpHelpProbe: help.ok ? { exitCode: help.code } : { error: help.reason },
    acpEngineSelector: { discovered: engineDiscovered, v3Listed, note: "the engine must be selected explicitly; ACP may default to another engine" },
    autoCompactionSetting: setting.ok && setting.code === 0
      ? { configured: true, value: setting.stdout.trim() }
      : { configured: false, note: "no stored value; an unset setting is not evidence that automatic compaction is suppressed" },
  },
  nextGates: [
    "explicit v3 engine and agent selection observed in a real session",
    "permission requests denied by default and cancellation witnessed terminally",
    "exact continuation submission with crash-safe journal intent",
    "repeated rotations, restart recovery and two simultaneous conversations",
    "native auto-compaction suppression witnessed before strict managed rotation",
  ],
};
console.log(JSON.stringify(report, null, 2));
