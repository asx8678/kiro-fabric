// W6 admission source fixture. Real boundaries; only external effects are inert.
// Generated bundles live under <root>/.tmp so worker entries resolve dist/runtime.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const ENTRIES = [
  ["ActionRegistry", "src/core/action-registry.ts"],
  ["FabricExecutionService", "src/execution-service.ts"],
  ["normalizeFabricConfig", "src/config.ts"],
  ["KiroHostSessionAdapter", "src/kiro/host-session-adapter.ts"],
  ["FoveaOutbox", "src/fovea/delivery.ts"],
  ["FoveaResponseDelivery", "src/kiro/fovea-context.ts"],
  ["FoveaHost", "src/fovea/host.ts"],
];

export const deepClone = value => structuredClone(value);

/** @param {unknown} error @returns {any[]} */
export function errorLeaves(error) { return error instanceof AggregateError ? error.errors.flatMap(errorLeaves) : [error]; }

/** @param {{root:string, fixturesRoot:string}} context */
export async function loadAdmissionApi(context, label = "api") {
  const root = context.root;
  const sanitized = String(label).replace(/[^a-zA-Z0-9_-]/g, "_");
  // Worker fallback "../runtime/..." is selected only when the module URL ends
  // in .ts. A bundle written directly under <root>/.tmp/<dir>/api.ts resolves
  // that to <root>/dist/runtime without modifying source or the build.
  const directory = fs.mkdtempSync(path.join(root, ".tmp", "w6-admission-" + sanitized + "-"));
  const file = path.join(directory, "api.ts");
  const contents = ENTRIES.map(([symbol, source]) => `export { ${symbol} } from ${JSON.stringify(path.join(root, source))};`).join("\n");
  const built = await build({ stdin: { contents, resolveDir: root, loader: "ts" }, bundle: true, packages: "external", platform: "node", format: "esm", target: "node24", write: false, logLevel: "silent" });
  fs.writeFileSync(file, built.outputFiles[0].contents, { flag: "wx", mode: 0o600 });
  const api = await import(pathToFileURL(file).href);
  return { api, directory, moduleFile: file };
}

/** Inert Navigator engine: real IPC framing, no parser, no repository reads. */
function writeInertEngine(directory, { failCommit = false } = {}) {
  const file = path.join(directory, "engine-entry.cjs");
  const source = `"use strict";
const fs = require("node:fs");
const path = require("node:path");
const FAIL_COMMIT = ${failCommit ? "true" : "false"};
let commitAttempts = 0;
const ledger = path.join(__dirname, "engine-ledger.jsonl");
const record = event => { try { fs.appendFileSync(ledger, JSON.stringify(event) + "\\n"); } catch {} };
record({ event: "started", pid: process.pid });
process.on("exit", code => { record({ event: "exited", pid: process.pid, code }); });
const send = (value, after) => process.send(JSON.stringify(value), () => { if (after) after(); });
process.on("message", raw => {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "initialize") { send({ version: 1, id: msg.id, ok: true, value: { initialized: true } }); return; }
  if (msg.type === "shutdown") { record({ event: "shutdown", pid: process.pid }); send({ version: 1, id: msg.id, ok: true, value: { shutdown: true, closed: true, cleanup: { scratch: "removed" } } }, () => process.exit(0)); return; }
  if (msg.type === "retireConversation") { send({ version: 1, id: msg.id, ok: true, value: { retired: true } }); return; }
  if (msg.type === "cancel") return;
  if (msg.type === "query") {
    const request = msg.request || {}, args = request.args || {};
    if (typeof args.commitPreparationId === "string") {
      commitAttempts += 1;
      record({ event: "commit-attempt", attempt: commitAttempts, commitPreparationId: args.commitPreparationId });
      if (FAIL_COMMIT && commitAttempts === 1) { record({ event: "commit-fail", attempt: commitAttempts }); send({ version: 1, id: msg.id, ok: false, error: "inert engine commit failure" }); return; }
      record({ event: "commit-ok", attempt: commitAttempts });
      send({ version: 1, id: msg.id, ok: true, value: { committed: true, commitAttempts } });
      return;
    }
    if (request.operation === "sync") {
      send({ version: 1, id: msg.id, ok: true, value: { red: true, text: "W6 inert navigator advisory", sourceSnapshotId: "snap-w6", syncPreparationId: "prep-w6", details: { provenance: { kind: "current-session" } }, status: "ok" } });
      return;
    }
    send({ version: 1, id: msg.id, ok: true, value: { ok: true } });
    return;
  }
  send({ version: 1, id: msg.id, ok: false, error: "unsupported inert engine request" });
});
`;
  fs.writeFileSync(file, source, { flag: "wx", mode: 0o600 });
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || fs.realpathSync(file) !== file) throw new Error("inert engine entry identity invalid");
  return file;
}

/** Real FoveaHost bound to an inert engine and a private fixture root. */
export async function createInertHost(api, context, label, { failCommit = false } = {}) {
  const root = fs.mkdtempSync(path.join(context.fixturesRoot, "w6-host-" + label + "-"));
  const dataRoot = path.join(root, "data"); fs.mkdirSync(dataRoot, { mode: 0o700 });
  const configDir = path.join(root, "config"); fs.mkdirSync(configDir, { mode: 0o700 });
  const workspace = path.join(root, "workspace"); fs.mkdirSync(workspace, { mode: 0o700 });
  const engine = writeInertEngine(root, { failCommit });
  const parser = { path: engine, sha256: createHash("sha256").update(fs.readFileSync(engine)).digest("hex"), version: "w6-inert" };
  const host = new api.FoveaHost({ dataRoot, configFile: path.join(configDir, "fovea.json"), parser, entrypoint: engine });
  const stat = fs.statSync(workspace, { bigint: true });
  const authority = { canonicalPath: workspace, deviceId: String(stat.dev), fileId: String(stat.ino), conversationId: "w6navigator", conversationEpoch: 0, authorizationEpoch: 0 };
  const client = host.bind(authority);
  return { root, host, client, workspace, authority };
}

/** Read the inert engine's append-only ledger. Missing/unwritten ledger is empty. */
export function readEngineLedger(root) {
  let raw = "";
  try { raw = fs.readFileSync(path.join(root, "engine-ledger.jsonl"), "utf8"); } catch { return []; }
  return raw.split("\n").filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}

/** Wait for the real engine child to record process exit and confirm the PID is gone. */
export async function waitForEngineSettlement(root, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const exited = [...readEngineLedger(root)].reverse().find(entry => entry.event === "exited");
    if (exited) {
      let alive = false;
      try { process.kill(exited.pid, 0); alive = true; }
      catch (error) { alive = error.code !== "ESRCH"; }
      return { ...exited, alive };
    }
    if (Date.now() > deadline) return null;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
