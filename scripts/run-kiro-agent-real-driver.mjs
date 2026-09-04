#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REAL_CLIENT_AUTOMATIC_COMPACTION_CYCLES,
  REAL_CLIENT_AUTO_COMPACTION_MAX_PRESSURE_TURNS,
  REAL_CLIENT_AUTO_COMPACTION_PRESSURE_CHARS,
  REAL_CLIENT_INTERACTIVE_COMMAND,
  REAL_CLIENT_MANUAL_COMPACTION_CYCLES,
  REAL_CLIENT_NATIVE_TOOLS,
  REAL_CLIENT_PROFILE_TOOLS,
  REAL_CLIENT_TOOLS,
  transcriptEntry,
} from "./real-client-evidence.mjs";
import {
  snapshotTree,
  validateAgentPackage,
  validateInstalledAgentProfile,
} from "./validate-agent-package.mjs";

const MAX_COMMAND_BYTES = 256_000;
const MAX_TUI_BYTES = 4 * 1024 * 1024;
const TURN_TIMEOUT_MS = 15 * 60_000;
const PROCESS_TIMEOUT_MS = 45 * 60_000;
const PROCESS_POLL_MS = 100;
const OUTPUT_QUIET_MS = 2_500;
const ARTIFACT_ID = /^ka_[a-f0-9]{48}$/u;
const SESSION_ID = /session(?:\s+id)?[^a-f0-9]{0,48}([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})/iu;
const qualificationChildren = new Set();
const qualificationObservers = new Set();

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const valueAfter = (argv, flag) => { const index = argv.indexOf(flag); return index < 0 ? undefined : argv[index + 1]; };
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const errorText = (value) => value instanceof Error ? value.message : String(value);
const commandRecord = (executable, argv) => ({ executable, argv });
const environmentAt = (environment, cwd) => ({ ...environment, PWD: cwd });
const regexEscape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const visibleToolToken = (text, tool) => new RegExp(`(?:^|[^a-z0-9_])${regexEscape(tool)}(?:$|[^a-z0-9_])`, "imu").test(text);

const lstat = (target) => {
  try { return fs.lstatSync(target); }
  catch (error) { if (error?.code === "ENOENT") return undefined; throw error; }
};

const assertPrivateDirectory = (target, empty = false) => {
  if (typeof target !== "string" || !path.isAbsolute(target)) throw new Error("qualification directories must be absolute");
  const stats = fs.lstatSync(target);
  if (!stats.isDirectory() || stats.isSymbolicLink() ||
      (typeof process.getuid === "function" && stats.uid !== process.getuid()) ||
      (process.platform !== "win32" && (stats.mode & 0o077) !== 0) ||
      (empty && fs.readdirSync(target).length !== 0)) {
    throw new Error(`qualification directory is not private${empty ? " and empty" : ""}: ${target}`);
  }
  return fs.realpathSync(target);
};

const walk = (root) => {
  const entries = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      const stats = fs.lstatSync(target);
      const relative = path.relative(root, target).replaceAll(path.sep, "/");
      if (stats.isSymbolicLink()) throw new Error(`qualification tree contains a symlink: ${target}`);
      if (entry.isDirectory()) { entries.push({ relative, directory: true, mode: stats.mode & 0o777 }); visit(target); }
      else if (entry.isFile() && stats.nlink === 1) entries.push({ relative, directory: false, mode: stats.mode & 0o777, bytes: fs.readFileSync(target) });
      else throw new Error(`qualification tree contains an unsupported entry: ${target}`);
    }
  };
  visit(root);
  return entries;
};

const treeDigest = (root) => {
  const digest = createHash("sha256");
  for (const entry of walk(root)) {
    digest.update(entry.relative).update("\0").update(entry.directory ? "d" : "f").update("\0").update(String(entry.mode)).update("\0");
    if (!entry.directory) digest.update(entry.bytes);
  }
  return digest.digest("hex");
};

const containsReleaseProfile = (root) => walk(root).some((entry) =>
  !entry.directory && /(?:^|\/)\.kiro\/agents\/kiro-fabric(?:\.|$)/u.test(entry.relative));

const resolveExecutable = (candidate) => {
  const resolved = fs.realpathSync(candidate);
  const stats = fs.lstatSync(resolved);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 ||
      (process.platform !== "win32" && ((stats.mode & 0o111) === 0 || (stats.mode & 0o022) !== 0))) {
    throw new Error(`unsafe executable: ${candidate}`);
  }
  return resolved;
};

export const resolveKiroCli = (pathValue = process.env.PATH ?? "", explicit = process.env.KIRO_CLI_PATH) => {
  if (explicit) {
    if (!path.isAbsolute(explicit)) throw new Error("KIRO_CLI_PATH must be absolute");
    return resolveExecutable(explicit);
  }
  for (const directory of pathValue.split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, process.platform === "win32" ? "kiro-cli.exe" : "kiro-cli");
    try { return resolveExecutable(candidate); } catch { /* try the next absolute PATH entry */ }
  }
  throw new Error("A private, non-writable kiro-cli executable was not found on absolute PATH entries");
};

const runSync = (executable, argv, options = {}) => {
  const result = spawnSync(executable, argv, {
    cwd: options.cwd,
    env: options.cwd && options.env ? environmentAt(options.env, options.cwd) : options.env,
    encoding: "buffer",
    maxBuffer: MAX_COMMAND_BYTES,
    timeout: options.timeout ?? 60_000,
  });
  if (result.error) throw result.error;
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr ?? Buffer.alloc(0);
  const combined = Buffer.concat([stdout, stderr]);
  if ((options.forbiddenValues ?? []).some((forbidden) => forbidden.length > 0 && combined.includes(forbidden))) {
    throw new Error(`${path.basename(executable)} output contained a protected qualification credential; output was suppressed`);
  }
  if (result.status !== 0) throw new Error(`${path.basename(executable)} ${argv.join(" ")} exited ${result.status ?? result.signal ?? "unknown"}: ${stderr.toString("utf8").slice(0, 2_000)}`);
  return { stdout, stderr, combined };
};

const waitForExit = (child, timeoutMs = PROCESS_TIMEOUT_MS) => new Promise((resolve, reject) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    resolve({ code: child.exitCode, signal: child.signalCode });
    return;
  }
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 2_000).unref();
    reject(new Error(`process ${child.pid ?? "unknown"} exceeded ${timeoutMs}ms`));
  }, timeoutMs);
  child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
});

const trackQualificationChild = (child) => {
  qualificationChildren.add(child);
  child.once("exit", () => qualificationChildren.delete(child));
  return child;
};

const terminateQualificationChildren = async () => {
  const observers = [...qualificationObservers];
  for (const observer of observers) {
    try { observer.stop(); } catch { /* continue exact-PID cleanup with the last good sample */ }
  }
  const targets = new Map();
  for (const observer of observers) {
    for (const entry of observer.seen.values()) {
      if (entry.descendsFromLauncher !== true) continue;
      targets.set(entry.pid, { pid: entry.pid, command: entry.command });
      if (Number.isSafeInteger(entry.ppid) && entry.ppid > 0 && typeof entry.parentCommand === "string") {
        targets.set(entry.ppid, { pid: entry.ppid, command: entry.parentCommand });
      }
    }
    qualificationObservers.delete(observer);
  }
  const pending = [...qualificationChildren];
  let cleanupObservationFailure;
  try {
    const rows = processTable();
    const byPid = new Map(rows.map((row) => [row.pid, row]));
    const launcherPids = new Set(pending.map((child) => child.pid).filter((pid) => Number.isSafeInteger(pid) && pid > 0));
    for (const row of rows) {
      let cursor = row;
      const visited = new Set();
      while (cursor && !visited.has(cursor.pid)) {
        visited.add(cursor.pid);
        if (launcherPids.has(cursor.ppid)) {
          targets.set(row.pid, { pid: row.pid, command: row.command });
          break;
        }
        cursor = byPid.get(cursor.ppid);
      }
    }
  } catch (error) { cleanupObservationFailure = error; }
  const matchingTargets = () => {
    let rows;
    try { rows = new Map(processTable().map((row) => [row.pid, row])); }
    catch (error) { cleanupObservationFailure ??= error; return []; }
    return [...targets.values()].filter((target) => target.pid !== process.pid && rows.get(target.pid)?.command === target.command);
  };
  for (const target of matchingTargets()) {
    try { process.kill(target.pid, "SIGTERM"); } catch { /* already gone */ }
  }
  for (const child of pending) {
    child.stdin?.end();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  await Promise.all(pending.map(async (child) => {
    try { await waitForExit(child, 5_000); }
    catch {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }));
  const deadline = Date.now() + 5_000;
  while (matchingTargets().length > 0 && Date.now() < deadline) await delay(50);
  for (const target of matchingTargets()) {
    try { process.kill(target.pid, "SIGKILL"); } catch { /* already gone */ }
  }
  const killDeadline = Date.now() + 2_000;
  while (matchingTargets().length > 0 && Date.now() < killDeadline) await delay(50);
  if (matchingTargets().length > 0) throw new Error("failed to terminate an exact observed Kiro qualification process");
  if (cleanupObservationFailure) throw new Error(`could not verify exact-PID qualification cleanup: ${errorText(cleanupObservationFailure)}`);
};

const processIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
};

const waitUntilDead = async (pid, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return;
    await delay(50);
  }
  throw new Error(`orphaned Fabric MCP process ${pid} remained alive`);
};

const processTable = () => {
  const result = spawnSync("ps", [process.platform === "darwin" ? "-axo" : "-eo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`ps failed: ${result.stderr}`);
  const rows = [];
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
  }
  return rows;
};

const observedDescendants = (rootPid) => {
  const rows = processTable();
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  return rows.filter((row) => {
    let cursor = byPid.get(row.ppid);
    const visited = new Set();
    while (cursor && !visited.has(cursor.pid)) {
      visited.add(cursor.pid);
      if (cursor.pid === rootPid) return true;
      cursor = byPid.get(cursor.ppid);
    }
    return false;
  }).map((row) => ({ pid: row.pid, command: row.command }));
};

const waitUntilObservedDead = async (targets, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = new Map(processTable().map((row) => [row.pid, row]));
    const alive = targets.filter((target) => rows.get(target.pid)?.command === target.command);
    if (alive.length === 0) return;
    if (Date.now() >= deadline) throw new Error(`orphaned Fabric descendant processes remained alive: ${alive.map((target) => target.pid).join(",")}`);
    await delay(50);
  }
};

const observeMcpProcesses = (entry, launcherPid) => {
  const seen = new Map();
  let timer;
  let samplingFailure;
  const sample = () => {
    const rows = processTable();
    const byPid = new Map(rows.map((row) => [row.pid, row]));
    for (const row of rows) {
      if (!row.command.includes(entry)) continue;
      const parent = byPid.get(row.ppid);
      let cursor = parent;
      let descendsFromLauncher = false;
      const visited = new Set();
      while (cursor && !visited.has(cursor.pid)) {
        visited.add(cursor.pid);
        if (cursor.pid === launcherPid) { descendsFromLauncher = true; break; }
        cursor = byPid.get(cursor.ppid);
      }
      seen.set(row.pid, {
        ...row,
        parentCommand: parent?.command,
        descendsFromLauncher,
        observedAt: new Date().toISOString(),
      });
    }
  };
  sample();
  timer = setInterval(() => {
    try { sample(); }
    catch (error) { samplingFailure ??= error; }
  }, PROCESS_POLL_MS);
  let stopped = false;
  const observer = {
    seen,
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      sample();
      if (samplingFailure) throw samplingFailure;
    },
    release: () => { if (stopped) qualificationObservers.delete(observer); },
    failure: () => samplingFailure,
  };
  qualificationObservers.add(observer);
  return observer;
};

const traceSessions = (dataRoot, allowPartialFinalLine = true) => {
  const directory = path.join(dataRoot, "fabric", "traces");
  if (!lstat(directory)) return [];
  const sessions = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const file = path.join(directory, name);
    const stats = fs.lstatSync(file);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > 4 * 1024 * 1024) throw new Error(`unsafe qualification trace: ${file}`);
    const bytes = fs.readFileSync(file);
    const lines = bytes.toString("utf8").split("\n");
    const events = [];
    for (const [index, line] of lines.entries()) {
      if (!line) continue;
      try { events.push(JSON.parse(line)); }
      catch (error) {
        if (!allowPartialFinalLine || index !== lines.length - 1) throw new Error(`malformed qualification trace ${file}: ${errorText(error)}`);
      }
    }
    const starts = events.filter((event) => event?.ev === "agent.mcp.start");
    if (starts.length > 1) throw new Error(`trace contains multiple MCP starts: ${file}`);
    if (starts[0]?.data?.mcpInstanceId) sessions.push({ file, bytes, events, start: starts[0], id: starts[0].data.mcpInstanceId });
  }
  return sessions;
};

const waitForTrace = async (dataRoot, predicate, timeoutMs = TURN_TIMEOUT_MS) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = traceSessions(dataRoot).find(predicate);
    if (match) return match;
    await delay(100);
  }
  throw new Error("timed out waiting for objective Fabric trace evidence");
};

const bridgeRef = (event) => event?.cat === "bridge" ? (event.data?.actionRef ?? event.ev) : undefined;
const turnMetrics = (session, afterSeq) => {
  const events = session.events.filter((event) => Number(event.seq) > afterSeq);
  const ends = events.filter((event) => event.ev === "exec.end");
  return {
    fabricInfoCalls: events.filter((event) => event.ev === "tool.fabric_info").length,
    fabricExecCalls: events.filter((event) => event.ev === "tool.fabric_exec").length,
    execSucceeded: ends.length === 1 && ends[0]?.data?.status === "succeeded",
    refs: events.map(bridgeRef).filter(Boolean),
  };
};

const formMetrics = (session) => {
  const requests = session.events.filter((event) => event.ev === "approval.form.request");
  const responses = session.events.filter((event) => event.ev === "approval.form.response");
  const failed = session.events.filter((event) => event.ev === "exec.end" && event.data?.status === "failed");
  const denied = session.events.filter((event) => event.ev === "approval.wait" && event.data?.approved === false);
  const writeErrors = session.events.filter((event) => bridgeRef(event) === "memory.set" && typeof event.data?.error === "string" && /approval/iu.test(event.data.error));
  return { requests, responses, failed, denied, writeErrors };
};

const lifecycleIdentity = (session) => {
  const info = [...session.events].reverse().find((event) => event.ev === "tool.fabric_info");
  const start = session.start?.data;
  if (!start || !info?.data) throw new Error("Fabric lifecycle trace is missing start or fabric_info identity");
  if (start.pid !== info.data.pid || start.parentPid !== info.data.parentPid || start.mcpInstanceId !== info.data.mcpInstanceId || start.startedAt !== info.data.startedAt) throw new Error("Fabric lifecycle trace identity changed within one process");
  return {
    pid: start.pid,
    parentPid: start.parentPid,
    mcpInstanceId: start.mcpInstanceId,
    startedAt: start.startedAt,
    runtimeGeneration: info.data.runtimeGeneration,
  };
};

const clientCapabilities = (session) => {
  const info = [...session.events].reverse().find((event) => event.ev === "tool.fabric_info");
  const capabilities = info?.data?.clientCapabilities;
  if (capabilities?.roots !== true || capabilities?.formElicitation !== true) {
    throw new Error("Kiro did not advertise required MCP roots and form-elicitation capabilities");
  }
  return { roots: true, formElicitation: true };
};

const assertSingleRuntime = (session) => {
  const starts = session.events.filter((event) => event.ev === "runtime.start");
  if (starts.length !== 1 || starts[0]?.data?.runtimeGeneration !== 1) throw new Error("Fabric runtime was initialized more than once for an unchanged workspace");
};

const traceDigest = (session) => hash(session.bytes);

const recordingEvidence = (file, forbiddenValues = []) => {
  const stats = lstat(file);
  if (!stats?.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size < 1 || stats.size > MAX_TUI_BYTES) {
    throw new Error(`Kiro ACP recording is missing or unsafe: ${file}`);
  }
  const bytes = fs.readFileSync(file);
  if (forbiddenValues.some((forbidden) => forbidden.length > 0 && bytes.includes(forbidden))) {
    throw new Error("Kiro ACP recording contained a protected qualification credential; recording was suppressed");
  }
  return { digest: hash(bytes), bytes: stats.size };
};

/** @param {unknown} value @returns {unknown} */
const canonicalValue = (value) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("qualification value is not plain JSON");
    const record = /** @type {Record<string, unknown>} */ (value);
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalValue(record[key])]));
  }
  throw new Error("qualification value is not JSON-serializable");
};

export const qualificationValueDigest = (value) => hash(Buffer.from(JSON.stringify(canonicalValue(value))));

/** @param {unknown} value @returns {Record<string, unknown> | undefined} */
const recordValue = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
  ? /** @type {Record<string, unknown>} */ (value)
  : undefined;

const jsonRpcIdKey = (value) => `${typeof value}:${JSON.stringify(value)}`;

export const parseAcpJsonlFrames = (bytes, startOffset = 0, endOffset = bytes.length) => {
  if (!Buffer.isBuffer(bytes) || !Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset) ||
      startOffset < 0 || endOffset < startOffset || endOffset > bytes.length) {
    throw new Error("Kiro ACP recording byte interval is invalid");
  }
  let selected = bytes.subarray(startOffset, endOffset);
  if (startOffset > 0 && bytes[startOffset - 1] !== 0x0a) {
    const firstNewline = selected.indexOf(0x0a);
    selected = firstNewline < 0 ? Buffer.alloc(0) : selected.subarray(firstNewline + 1);
  }
  // An end offset captured while a later JSONL frame is being appended must
  // never pull that later frame into the qualified interval.
  if (endOffset > startOffset && bytes[endOffset - 1] !== 0x0a) {
    const lastNewline = selected.lastIndexOf(0x0a);
    selected = lastNewline < 0 ? Buffer.alloc(0) : selected.subarray(0, lastNewline + 1);
  }
  const lines = selected.toString("utf8").split("\n").filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    try {
      const value = JSON.parse(line);
      if (typeof value !== "object" || value === null) throw new Error("frame is not an object");
      return value;
    } catch (error) {
      throw new Error(`Kiro ACP recording frame ${index + 1} is invalid: ${errorText(error)}`);
    }
  });
};

const acpFrames = (file, startOffset = 0, endOffset = undefined) => {
  const bytes = fs.readFileSync(file);
  const frames = parseAcpJsonlFrames(bytes, startOffset, endOffset ?? bytes.length);
  if (!frames.length) throw new Error(`Kiro ACP recording contains no JSONL frames: ${file}`);
  return frames;
};

export const acpFormInteractionObserved = (frames) => {
  const pending = new Set();
  for (const frame of frames) {
    const envelope = recordValue(frame);
    const message = recordValue(envelope?.message);
    if (!message || message.jsonrpc !== "2.0") continue;
    const params = recordValue(message.params);
    if (envelope?.direction === "server-to-client" && message.method === "session/request_permission" &&
        typeof params?.sessionId === "string" && params.sessionId &&
        (typeof message.id === "string" || typeof message.id === "number")) {
      pending.add(jsonRpcIdKey(message.id));
    } else if (envelope?.direction === "client-to-server" && !Object.hasOwn(message, "method") &&
        (typeof message.id === "string" || typeof message.id === "number") &&
        recordValue(message.result) !== undefined && !Object.hasOwn(message, "error") && pending.has(jsonRpcIdKey(message.id))) {
      return true;
    }
  }
  return false;
};

export const acpSessionLoadObserved = (frames, sessionId) => {
  const pending = new Set();
  for (const frame of frames) {
    const envelope = recordValue(frame);
    const message = recordValue(envelope?.message);
    if (!message || message.jsonrpc !== "2.0") continue;
    const params = recordValue(message.params);
    if (envelope?.direction === "client-to-server" && message.method === "session/load" &&
        params?.sessionId === sessionId && (typeof message.id === "string" || typeof message.id === "number")) {
      pending.add(jsonRpcIdKey(message.id));
    } else if (envelope?.direction === "server-to-client" && !Object.hasOwn(message, "method") &&
        (typeof message.id === "string" || typeof message.id === "number") && recordValue(message.result) !== undefined &&
        !Object.hasOwn(message, "error") && pending.has(jsonRpcIdKey(message.id))) return true;
  }
  return false;
};

const directTextContains = (value, expected) => {
  if (typeof value === "string") return value.includes(expected);
  if (Array.isArray(value)) return value.some((entry) => recordValue(entry)?.type === "text" &&
    typeof recordValue(entry)?.text === "string" && String(recordValue(entry)?.text).includes(expected));
  const record = recordValue(value);
  return record?.type === "text" && typeof record.text === "string" && record.text.includes(expected);
};

export const acpPriorUserMessageObserved = (frames, historyNonce) => frames.some((frame) => {
  const envelope = recordValue(frame);
  const message = envelope?.direction === "server-to-client" ? recordValue(envelope.message) : undefined;
  const params = recordValue(message?.params);
  const update = recordValue(params?.update);
  return message?.jsonrpc === "2.0" && ["session/update", "session/notification"].includes(String(message.method)) &&
    !Object.hasOwn(message, "id") && ["user_message", "user_message_chunk"].includes(String(update?.sessionUpdate)) &&
    directTextContains(update?.content, historyNonce);
});

const structuralCompletedAcpCompactions = (frames) => {
  if (!Array.isArray(frames)) return [];
  const notifications = [];
  for (const frame of frames) {
    // The recorder owns this envelope. Match only the actual server-to-client
    // JSON-RPC message, never an object embedded in user/model content.
    const message = frame?.direction === "server-to-client" ? frame.message : undefined;
    if (message?.jsonrpc === "2.0" && message.method === "_kiro.dev/compaction/status" &&
        !Object.hasOwn(message, "id") && message.params?.status?.type === "completed" &&
        typeof message.params.sessionId === "string" && message.params.sessionId) {
      notifications.push({
        method: message.method,
        status: message.params.status.type,
        sessionId: message.params.sessionId,
        frameDigest: hash(Buffer.from(JSON.stringify(frame))),
      });
    }
  }
  return notifications;
};

export const completedAcpCompactionNotifications = (frames, expectedSessionIds) => {
  if (!Array.isArray(expectedSessionIds) || expectedSessionIds.length < 1 ||
      expectedSessionIds.some((sessionId) => typeof sessionId !== "string" || !sessionId)) return [];
  const allowedSessions = new Set(expectedSessionIds);
  return structuralCompletedAcpCompactions(frames).filter((event) => allowedSessions.has(event.sessionId));
};

export const completedAcpManualCompactions = (frames, sessionId) => {
  if (!Array.isArray(frames) || typeof sessionId !== "string" || !sessionId) return [];
  const requests = [];
  const responses = [];
  const statuses = [];
  for (const [index, frame] of frames.entries()) {
    const envelope = recordValue(frame);
    const message = recordValue(envelope?.message);
    const params = recordValue(message?.params);
    if (!message || message.jsonrpc !== "2.0") continue;
    if (envelope?.direction === "client-to-server" && message.method === "_kiro.dev/commands/execute" &&
        params?.sessionId === sessionId && params.command === "/compact" &&
        (typeof message.id === "string" || typeof message.id === "number")) {
      requests.push({ id: message.id, idKey: jsonRpcIdKey(message.id), index, frameDigest: hash(Buffer.from(JSON.stringify(frame))) });
    } else if (envelope?.direction === "server-to-client" && !Object.hasOwn(message, "method") &&
        (typeof message.id === "string" || typeof message.id === "number") && Object.hasOwn(message, "result") && !Object.hasOwn(message, "error")) {
      const result = message.result;
      const resultRecord = recordValue(result);
      if (resultRecord?.success === true) responses.push({ idKey: jsonRpcIdKey(message.id), index, frameDigest: hash(Buffer.from(JSON.stringify(frame))), resultDigest: qualificationValueDigest(result) });
    } else if (envelope?.direction === "server-to-client" && message.method === "_kiro.dev/compaction/status" &&
        !Object.hasOwn(message, "id") && params?.sessionId === sessionId) {
      const status = recordValue(params.status)?.type;
      if (typeof status === "string") statuses.push({ status, index, frameDigest: hash(Buffer.from(JSON.stringify(frame))) });
    }
  }
  if (requests.length !== 1) return [];
  const request = requests[0];
  const response = responses.filter((candidate) => candidate.idKey === request.idKey);
  const relevantStatuses = statuses.filter((candidate) => candidate.index > request.index &&
    (response.length !== 1 || candidate.index < response[0].index));
  if (response.length !== 1 || response[0].index <= request.index || relevantStatuses.length < 2 ||
      relevantStatuses[0].status !== "started" || relevantStatuses.at(-1)?.status !== "completed" ||
      relevantStatuses.filter((candidate) => candidate.status === "completed").length !== 1 ||
      relevantStatuses.some((candidate) => /^(?:failed|error|cancelled|canceled|rejected)$/iu.test(candidate.status)) ||
      statuses.some((candidate) => candidate.index < request.index)) return [];
  const completed = relevantStatuses.at(-1);
  return [{
    sessionId,
    command: "/compact",
    requestIdDigest: qualificationValueDigest(request.id),
    requestFrameDigest: request.frameDigest,
    startedFrameDigest: relevantStatuses[0].frameDigest,
    completedFrameDigest: completed.frameDigest,
    responseFrameDigest: response[0].frameDigest,
    responseResultDigest: response[0].resultDigest,
    responseSuccess: true,
  }];
};

export const completedAcpAutomaticCompactions = (frames, sessionId, pressureMarker) => {
  if (!Array.isArray(frames) || typeof sessionId !== "string" || !sessionId ||
      typeof pressureMarker !== "string" || pressureMarker.length < 16) return [];
  const prompts = [];
  const statuses = [];
  let manualCommandObserved = false;
  let toolCallObserved = false;
  for (const [index, frame] of frames.entries()) {
    const envelope = recordValue(frame);
    const message = recordValue(envelope?.message);
    const params = recordValue(message?.params);
    if (!message || message.jsonrpc !== "2.0") continue;
    if (envelope?.direction === "client-to-server" && message.method === "session/prompt" &&
        params?.sessionId === sessionId && (typeof message.id === "string" || typeof message.id === "number") &&
        directTextContains(params.prompt ?? params.content, pressureMarker)) {
      prompts.push({
        index,
        frameDigest: hash(Buffer.from(JSON.stringify(frame))),
        requestIdDigest: qualificationValueDigest(message.id),
      });
    } else if (envelope?.direction === "client-to-server" && message.method === "_kiro.dev/commands/execute" &&
        params?.command === "/compact") {
      manualCommandObserved = true;
    } else if (envelope?.direction === "server-to-client" && message.method === "_kiro.dev/compaction/status" &&
        !Object.hasOwn(message, "id") && params?.sessionId === sessionId) {
      const status = recordValue(params.status)?.type;
      if (typeof status === "string") statuses.push({ status, index, frameDigest: hash(Buffer.from(JSON.stringify(frame))) });
    } else if (envelope?.direction === "server-to-client" &&
        ["session/update", "session/notification"].includes(String(message.method)) && !Object.hasOwn(message, "id")) {
      const update = recordValue(params?.update);
      if (["tool_call", "tool_call_update"].includes(String(update?.sessionUpdate))) toolCallObserved = true;
    }
  }
  if (manualCommandObserved || toolCallObserved || prompts.length !== 1) return [];
  const prompt = prompts[0];
  const relevantStatuses = statuses.filter((candidate) => candidate.index > prompt.index);
  if (relevantStatuses.length < 2 || relevantStatuses[0].status !== "started" ||
      relevantStatuses.at(-1)?.status !== "completed" ||
      relevantStatuses.filter((candidate) => candidate.status === "completed").length !== 1 ||
      relevantStatuses.some((candidate) => /^(?:failed|error|cancelled|canceled|rejected)$/iu.test(candidate.status))) return [];
  const completed = relevantStatuses.at(-1);
  return [{
    sessionId,
    trigger: "natural-context-pressure",
    pressureMarkerDigest: qualificationValueDigest(pressureMarker),
    promptRequestIdDigest: prompt.requestIdDigest,
    promptFrameDigest: prompt.frameDigest,
    startedFrameDigest: relevantStatuses[0].frameDigest,
    completedFrameDigest: completed.frameDigest,
    manualCommandAbsent: true,
    toolCallsAbsent: true,
  }];
};

const fabricExecIdentifier = (value) => typeof value === "string" &&
  /^(?:fabric_exec|@?fabric(?:\/|\.|:|___)fabric_exec)$/iu.test(value);

const structuralFabricExecIdentity = (update) => {
  if (typeof update !== "object" || update === null || Array.isArray(update)) return { matched: false, conflicted: false };
  const metadata = typeof update._meta === "object" && update._meta !== null && !Array.isArray(update._meta)
    ? update._meta
    : {};
  const identifiers = [update.name, update.toolName, metadata.name, metadata.toolName].filter((value) => typeof value === "string");
  if (identifiers.length) return { matched: identifiers.every(fabricExecIdentifier), conflicted: identifiers.some((value) => !fabricExecIdentifier(value)) };
  const matched = fabricExecIdentifier(update.title);
  return { matched, conflicted: typeof update.title === "string" && !matched };
};

const normalizedFabricExecOutput = (rawOutput) => {
  if (typeof rawOutput === "string") {
    try { return canonicalValue(JSON.parse(rawOutput)); }
    catch { return undefined; }
  }
  if (typeof rawOutput !== "object" || rawOutput === null || Array.isArray(rawOutput)) return undefined;
  if (rawOutput.isError === true) return undefined;
  if (Array.isArray(rawOutput.content)) {
    if (rawOutput.content.length !== 1 || rawOutput.content[0]?.type !== "text" || typeof rawOutput.content[0]?.text !== "string") return undefined;
    try { return canonicalValue(JSON.parse(rawOutput.content[0].text)); }
    catch { return undefined; }
  }
  try { return canonicalValue(rawOutput); }
  catch { return undefined; }
};

/**
 * Return completed structural ACP calls whose exact input and normalized output
 * match the qualification expectation. No model/user content is searched.
 * @param {unknown[]} frames
 * @param {{sessionId: string, expectedArguments: unknown, expectedResult: unknown}} options
 */
export const completedAcpFabricExecCalls = (frames, options) => {
  if (!Array.isArray(frames) || typeof options?.sessionId !== "string" || !options.sessionId) return [];
  const expectedArgumentsDigest = qualificationValueDigest(options.expectedArguments);
  const expectedResultDigest = qualificationValueDigest(options.expectedResult);
  /** @type {Map<string, {sessionId: string, toolCallId: string, named: boolean, conflicted: boolean, status: string | undefined, rawInput: unknown, rawOutput: unknown, frameDigests: string[]}>} */
  const calls = new Map();
  for (const frame of frames) {
    const envelope = recordValue(frame);
    const message = envelope?.direction === "server-to-client" ? recordValue(envelope.message) : undefined;
    const params = recordValue(message?.params);
    // Current Kiro documentation calls this session/notification while ACP v1
    // names the same direct update envelope session/update. Accept only those
    // two structural notification methods, not recursively embedded objects.
    const update = message?.jsonrpc === "2.0" && typeof message.method === "string" &&
      ["session/update", "session/notification"].includes(message.method) && !Object.hasOwn(message, "id") &&
      params?.sessionId === options.sessionId ? recordValue(params.update) : undefined;
    if (!update || typeof update.sessionUpdate !== "string" || !["tool_call", "tool_call_update"].includes(update.sessionUpdate) ||
        typeof update.toolCallId !== "string" || update.toolCallId.length < 1 || update.toolCallId.length > 256) continue;
    /** @type {{sessionId: string, toolCallId: string, named: boolean, conflicted: boolean, status: string | undefined, rawInput: unknown, rawOutput: unknown, frameDigests: string[]}} */
    const existing = calls.get(update.toolCallId) ?? {
      sessionId: options.sessionId,
      toolCallId: update.toolCallId,
      named: false,
      conflicted: false,
      status: undefined,
      rawInput: undefined,
      rawOutput: undefined,
      frameDigests: [],
    };
    existing.frameDigests.push(hash(Buffer.from(JSON.stringify(frame))));
    const toolIdentity = structuralFabricExecIdentity(update);
    existing.named ||= toolIdentity.matched;
    existing.conflicted ||= toolIdentity.conflicted;
    if (Object.hasOwn(update, "rawInput")) {
      if (existing.rawInput !== undefined && qualificationValueDigest(existing.rawInput) !== qualificationValueDigest(update.rawInput)) existing.conflicted = true;
      else existing.rawInput = update.rawInput;
    }
    if (Object.hasOwn(update, "rawOutput")) {
      if (existing.rawOutput !== undefined && qualificationValueDigest(existing.rawOutput) !== qualificationValueDigest(update.rawOutput)) existing.conflicted = true;
      else existing.rawOutput = update.rawOutput;
    }
    if (typeof update.status === "string") {
      const terminalFailure = /^(?:failed|error|cancelled|canceled|rejected)$/iu.test(update.status);
      const allowedTransition = existing.status === undefined || existing.status === update.status ||
        (existing.status === "pending" && ["in_progress", "completed"].includes(update.status)) ||
        (existing.status === "in_progress" && update.status === "completed");
      if (terminalFailure || !allowedTransition) existing.conflicted = true;
      existing.status = update.status;
    }
    calls.set(update.toolCallId, existing);
  }
  return [...calls.values()].flatMap((call) => {
    if (!call.named || call.conflicted || call.status !== "completed" || call.rawInput === undefined || call.rawOutput === undefined) return [];
    const observedResult = normalizedFabricExecOutput(call.rawOutput);
    if (observedResult === undefined) return [];
    const observedArgumentsDigest = qualificationValueDigest(call.rawInput);
    const observedResultDigest = qualificationValueDigest(observedResult);
    if (observedArgumentsDigest !== expectedArgumentsDigest || observedResultDigest !== expectedResultDigest) return [];
    return [{
      sessionId: call.sessionId,
      toolCallId: call.toolCallId,
      expectedArgumentsDigest,
      observedArgumentsDigest,
      expectedResultDigest,
      observedResultDigest,
      ...(typeof recordValue(recordValue(call.rawInput)?.payloads)?.contextFact === "string"
        ? { observedContextFactDigest: qualificationValueDigest(recordValue(recordValue(call.rawInput)?.payloads)?.contextFact) }
        : {}),
      frameDigests: call.frameDigests,
    }];
  });
};

export const acpToolDataContaining = (frames, expected) => {
  if (!Array.isArray(frames) || typeof expected !== "string" || !expected) return [];
  return frames.flatMap((frame) => {
    const envelope = recordValue(frame);
    const message = envelope?.direction === "server-to-client" ? recordValue(envelope.message) : undefined;
    const params = recordValue(message?.params);
    const update = recordValue(params?.update);
    if (message?.jsonrpc !== "2.0" || !["session/update", "session/notification"].includes(String(message.method)) ||
        Object.hasOwn(message, "id") || !["tool_call", "tool_call_update"].includes(String(update?.sessionUpdate))) return [];
    const raw = [update?.rawInput, update?.rawOutput].filter((value) => value !== undefined);
    return raw.some((value) => JSON.stringify(value).includes(expected)) ? [{
      toolCallId: update?.toolCallId,
      frameDigest: hash(Buffer.from(JSON.stringify(frame))),
    }] : [];
  });
};

export const acpUserPromptFacts = (frames, sessionId, fact) => {
  if (!Array.isArray(frames) || typeof sessionId !== "string" || typeof fact !== "string" || !fact) return [];
  return frames.flatMap((frame) => {
    const envelope = recordValue(frame);
    const message = envelope?.direction === "client-to-server" ? recordValue(envelope.message) : undefined;
    const params = recordValue(message?.params);
    if (message?.jsonrpc !== "2.0" || message.method !== "session/prompt" ||
        params?.sessionId !== sessionId || !Object.hasOwn(message, "id")) return [];
    const prompt = params.prompt ?? params.content;
    const content = Array.isArray(prompt) ? prompt : [prompt];
    const containsFact = content.some((entry) => typeof entry === "string" ? entry.includes(fact) :
      entry?.type === "text" && typeof entry.text === "string" && entry.text.includes(fact));
    return containsFact ? [{
      sessionId,
      factDigest: qualificationValueDigest(fact),
      frameDigest: hash(Buffer.from(JSON.stringify(frame))),
    }] : [];
  });
};

const waitForAcpCompactionInterval = async (file, startOffset, sessionId, timeoutMs = TURN_TIMEOUT_MS) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bytes = lstat(file)?.isFile() ? fs.readFileSync(file) : Buffer.alloc(0);
    const frames = bytes.length >= startOffset ? parseAcpJsonlFrames(bytes, startOffset, bytes.length) : [];
    const exchanges = completedAcpManualCompactions(frames, sessionId);
    if (exchanges.length > 1) throw new Error("Kiro ACP recording contains multiple completed manual compactions in one /compact interval");
    if (exchanges.length === 1) return { exchange: exchanges[0], endOffset: bytes.length };
    await delay(100);
  }
  throw new Error("Kiro ACP recording did not contain a causally paired manual /compact request, status sequence, and response");
};

const automaticCompactionInInterval = (file, startOffset, sessionId, pressureMarker) => {
  const bytes = lstat(file)?.isFile() ? fs.readFileSync(file) : Buffer.alloc(0);
  const frames = bytes.length >= startOffset ? parseAcpJsonlFrames(bytes, startOffset, bytes.length) : [];
  const events = completedAcpAutomaticCompactions(frames, sessionId, pressureMarker);
  if (events.length > 1) throw new Error("Kiro ACP recording contains multiple automatic compactions in one pressure interval");
  return events.length === 1 ? { event: events[0], endOffset: bytes.length } : undefined;
};

const waitForAutomaticCompactionInInterval = async (file, startOffset, sessionId, pressureMarker, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const observed = automaticCompactionInInterval(file, startOffset, sessionId, pressureMarker);
    if (observed) return observed;
    await delay(100);
  }
  return automaticCompactionInInterval(file, startOffset, sessionId, pressureMarker);
};

const waitForAcpFabricExec = async (file, startOffset, options, timeoutMs = TURN_TIMEOUT_MS) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bytes = lstat(file)?.isFile() ? fs.readFileSync(file) : Buffer.alloc(0);
    const frames = bytes.length >= startOffset ? parseAcpJsonlFrames(bytes, startOffset, bytes.length) : [];
    const calls = completedAcpFabricExecCalls(frames, options);
    if (calls.length > 1) throw new Error("Kiro ACP recording contains multiple matching fabric_exec calls in one qualification turn");
    if (calls.length === 1) return { call: calls[0], endOffset: bytes.length };
    await delay(100);
  }
  throw new Error("Kiro ACP recording did not contain the exact completed fabric_exec call and result");
};

const attachCapture = (child, maximum = MAX_TUI_BYTES, forbiddenValues = []) => {
  const chunks = [];
  const stdoutChunks = [];
  const stderrChunks = [];
  let bytes = 0;
  let lastOutputAt = Date.now();
  let failure;
  const capture = (stream, chunk) => {
    const value = Buffer.from(chunk);
    bytes += value.length;
    lastOutputAt = Date.now();
    if (bytes > maximum) { failure = new Error("Kiro output exceeded its qualification bound"); child.kill("SIGKILL"); return; }
    chunks.push(value);
    (stream === "stdout" ? stdoutChunks : stderrChunks).push(value);
    const captured = Buffer.concat(chunks);
    if (forbiddenValues.some((forbidden) => forbidden.length > 0 && captured.includes(forbidden))) {
      failure = new Error("Kiro output contained a protected qualification credential; output was suppressed");
      child.kill("SIGKILL");
    }
  };
  child.stdout?.on("data", (chunk) => capture("stdout", chunk));
  child.stderr?.on("data", (chunk) => capture("stderr", chunk));
  return {
    cursor: () => bytes,
    slice: (from = 0) => Buffer.concat(chunks).subarray(from),
    stdout: () => Buffer.concat(stdoutChunks),
    stderr: () => Buffer.concat(stderrChunks),
    lastOutputAt: () => lastOutputAt,
    failure: () => failure,
  };
};

const stripTerminal = (bytes) => bytes.toString("utf8")
  .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, "")
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
  .replaceAll("\r", "\n");

const sessionIdFromOutput = (bytes) => {
  const matches = [...stripTerminal(bytes).matchAll(new RegExp(SESSION_ID.source, `${SESSION_ID.flags}g`))];
  return matches.at(-1)?.[1];
};

const waitForQuiet = async (session, after, timeoutMs = TURN_TIMEOUT_MS) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (session.capture.failure()) throw session.capture.failure();
    if (session.child.exitCode !== null || session.child.signalCode !== null) throw new Error("interactive Kiro exited before reaching an idle boundary");
    if (session.capture.cursor() > after && Date.now() - session.capture.lastOutputAt() >= OUTPUT_QUIET_MS) return;
    await delay(100);
  }
  throw new Error("interactive Kiro did not reach an observable idle boundary");
};

const waitForFreshQuiet = async (session, timeoutMs = 30_000) => {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  while (Date.now() < deadline) {
    if (session.capture.failure()) throw session.capture.failure();
    if (session.child.exitCode !== null || session.child.signalCode !== null) throw new Error("interactive Kiro exited before reaching a fresh idle boundary");
    if (Date.now() - Math.max(startedAt, session.capture.lastOutputAt()) >= OUTPUT_QUIET_MS) return;
    await delay(100);
  }
  throw new Error("interactive Kiro did not reach a fresh idle boundary");
};

const waitForTerminalText = async (session, after, pattern, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (session.capture.failure()) throw session.capture.failure();
    const output = stripTerminal(session.capture.slice(after));
    if (pattern.test(output)) return output;
    if (session.child.exitCode !== null || session.child.signalCode !== null) throw new Error("interactive Kiro exited before rendering expected terminal content");
    await delay(100);
  }
  throw new Error("interactive Kiro did not render expected terminal content");
};

const shellQuote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
const startPty = (executable, argv, options) => {
  const script = resolveExecutable("/usr/bin/script");
  const scriptArgs = process.platform === "darwin"
    ? ["-q", "/dev/null", executable, ...argv]
    : ["--quiet", "--return", "--flush", "--command", [executable, ...argv].map(shellQuote).join(" "), "/dev/null"];
  const child = trackQualificationChild(spawn(script, scriptArgs, { cwd: options.cwd, env: environmentAt(options.env, options.cwd), stdio: ["pipe", "pipe", "pipe"] }));
  return {
    child,
    capture: attachCapture(child, MAX_TUI_BYTES, options.forbiddenValues ?? []),
    send: (text) => child.stdin.write(`${text}\r`),
    sendRaw: (bytes) => child.stdin.write(bytes),
  };
};

const maybeTrustWorkspace = async (session) => {
  const start = session.capture.cursor();
  await waitForQuiet(session, start, 60_000);
  const text = stripTerminal(session.capture.slice(start));
  if (/trust.{0,80}workspace|workspace.{0,80}trust/iu.test(text)) {
    const cursor = session.capture.cursor();
    session.send("y");
    await waitForQuiet(session, cursor, 60_000);
  }
};

const runInteractiveTurn = async ({ session, dataRoot, targetId = undefined, excludedIds, prompt, expectedRefs, name }) => {
  const before = targetId ? traceSessions(dataRoot).find((entry) => entry.id === targetId) : undefined;
  const afterSeq = before ? Math.max(0, ...before.events.map((event) => Number(event.seq) || 0)) : 0;
  const outputStart = session.capture.cursor();
  session.send(prompt);
  let observed = await waitForTrace(dataRoot, (candidate) => {
    if (targetId ? candidate.id !== targetId : excludedIds.has(candidate.id)) return false;
    const metrics = turnMetrics(candidate, afterSeq);
    return metrics.fabricInfoCalls >= 1 && metrics.fabricExecCalls >= 1 && metrics.execSucceeded && expectedRefs.every((ref) => metrics.refs.includes(ref));
  });
  await waitForQuiet(session, outputStart);
  observed = traceSessions(dataRoot).find((candidate) => candidate.id === observed.id) ?? observed;
  const metrics = turnMetrics(observed, afterSeq);
  if (metrics.fabricExecCalls !== 1 || !metrics.execSucceeded || !expectedRefs.every((ref) => metrics.refs.includes(ref))) throw new Error(`${name} did not make the exact successful Fabric call`);
  assertSingleRuntime(observed);
  return {
    trace: observed,
    output: session.capture.slice(outputStart),
    evidence: { name, mcp: lifecycleIdentity(observed), fabricInfoCalls: metrics.fabricInfoCalls, fabricExecCalls: metrics.fabricExecCalls, execSucceeded: metrics.execSucceeded },
  };
};

const manualCompactionCycle = async ({ session, recordFile, dataRoot, traceId, sessionId, index }) => {
  const intervalStartOffset = fs.readFileSync(recordFile).length;
  if (intervalStartOffset < 1) throw new Error("Kiro ACP recording was empty before manual /compact");
  const terminalCursor = session.capture.cursor();
  session.send("/compact");
  await waitForQuiet(session, terminalCursor, TURN_TIMEOUT_MS);
  const terminalOutput = session.capture.slice(terminalCursor);
  const terminalText = stripTerminal(terminalOutput);
  if (/(?:compaction\s+failed|failed\s+to\s+compact|error\s+(?:during|while)\s+compact|unable\s+to\s+compact|compaction\s+cancelled)/iu.test(terminalText) ||
      !/(?:compaction\s+(?:complete|completed|successful)|compacted|context\s+(?:was\s+)?summari[sz]ed)/iu.test(terminalText)) {
    throw new Error(`Kiro did not report successful completion of manual /compact cycle ${index}`);
  }
  const interval = await waitForAcpCompactionInterval(recordFile, intervalStartOffset, sessionId);
  const intervalFrames = acpFrames(recordFile, intervalStartOffset, interval.endOffset);
  const completed = completedAcpCompactionNotifications(intervalFrames, [sessionId]);
  if (completed.length !== 1 || completed[0].frameDigest !== interval.exchange.completedFrameDigest) {
    throw new Error(`manual /compact cycle ${index} ACP event is not bound to its command exchange`);
  }
  const trace = traceSessions(dataRoot).find((entry) => entry.id === traceId);
  if (!trace) throw new Error(`Fabric trace disappeared during manual compaction cycle ${index}`);
  assertSingleRuntime(trace);
  const mcp = lifecycleIdentity(trace);
  const sessionCursor = session.capture.cursor();
  session.send("/session-id");
  await waitForQuiet(session, sessionCursor, 120_000);
  const sessionOutput = session.capture.slice(sessionCursor);
  const sessionIdAfter = sessionIdFromOutput(sessionOutput);
  if (!sessionIdAfter) throw new Error(`Kiro /session-id after manual compaction cycle ${index} did not yield a structural UUID`);
  return {
    terminalOutput,
    sessionOutput,
    trace,
    mcp,
    interval,
    gate: {
      index,
      command: "/compact",
      eventCount: completed.length,
      method: completed[0].method,
      status: completed[0].status,
      sessionId: completed[0].sessionId,
      frameDigest: completed[0].frameDigest,
      intervalStartOffset,
      intervalEndOffset: interval.endOffset,
      manualExchange: interval.exchange,
      sessionIdBefore: sessionId,
      sessionIdAfter,
      sessionIdChanged: sessionId !== sessionIdAfter,
    },
  };
};

const automaticCompactionCycle = async ({ session, recordFile, dataRoot, traceId, sessionId }) => {
  const attempts = [];
  for (let index = 1; index <= REAL_CLIENT_AUTO_COMPACTION_MAX_PRESSURE_TURNS; index += 1) {
    const pressureMarker = `kiro-auto-compact-${randomBytes(18).toString("hex")}-${index}`;
    const opaqueContext = randomBytes(Math.ceil(REAL_CLIENT_AUTO_COMPACTION_PRESSURE_CHARS * 3 / 4))
      .toString("base64")
      .slice(0, REAL_CLIENT_AUTO_COMPACTION_PRESSURE_CHARS);
    const prompt = `Automatic context-compaction qualification ${pressureMarker}. Keep the following opaque text in this conversation context. Do not call any tool. Reply with only ACK-${pressureMarker}.\n${opaqueContext}`;
    const intervalStartOffset = fs.readFileSync(recordFile).length;
    const terminalCursor = session.capture.cursor();
    session.send(prompt);
    await waitForQuiet(session, terminalCursor, TURN_TIMEOUT_MS);
    const terminalOutput = session.capture.slice(terminalCursor);
    attempts.push({
      index,
      promptChars: prompt.length,
      pressureMarkerDigest: qualificationValueDigest(pressureMarker),
      terminalBytes: terminalOutput.length,
      terminalDigest: hash(terminalOutput),
    });
    const observed = await waitForAutomaticCompactionInInterval(recordFile, intervalStartOffset, sessionId, pressureMarker);
    if (!observed) continue;
    const trace = traceSessions(dataRoot).find((entry) => entry.id === traceId);
    if (!trace) throw new Error("Fabric trace disappeared during automatic compaction");
    assertSingleRuntime(trace);
    const mcp = lifecycleIdentity(trace);
    const sessionCursor = session.capture.cursor();
    session.send("/session-id");
    await waitForQuiet(session, sessionCursor, 120_000);
    const sessionOutput = session.capture.slice(sessionCursor);
    const sessionIdAfter = sessionIdFromOutput(sessionOutput);
    if (!sessionIdAfter) throw new Error("Kiro /session-id after automatic compaction did not yield a structural UUID");
    const completed = completedAcpCompactionNotifications(
      acpFrames(recordFile, intervalStartOffset, observed.endOffset),
      [sessionId],
    );
    if (completed.length !== 1 || completed[0].frameDigest !== observed.event.completedFrameDigest) {
      throw new Error("automatic compaction completion is not bound to its pressure interval");
    }
    return {
      pressureMarker,
      sessionOutput,
      trace,
      mcp,
      attempts,
      gate: {
        trigger: observed.event.trigger,
        eventCount: completed.length,
        method: completed[0].method,
        status: completed[0].status,
        sessionId: completed[0].sessionId,
        frameDigest: completed[0].frameDigest,
        intervalStartOffset,
        intervalEndOffset: observed.endOffset,
        sessionIdBefore: sessionId,
        sessionIdAfter,
        sessionIdChanged: sessionId !== sessionIdAfter,
        pressureTurns: attempts.length,
        totalPressureChars: attempts.reduce((total, attempt) => total + attempt.promptChars, 0),
        pressureMarkerDigest: observed.event.pressureMarkerDigest,
        promptRequestIdDigest: observed.event.promptRequestIdDigest,
        promptFrameDigest: observed.event.promptFrameDigest,
        startedFrameDigest: observed.event.startedFrameDigest,
        completedFrameDigest: observed.event.completedFrameDigest,
        manualCommandAbsent: observed.event.manualCommandAbsent,
        toolCallsAbsent: observed.event.toolCallsAbsent,
        settingMutated: false,
      },
    };
  }
  throw new Error(`Kiro automatic compaction was not structurally observed after ${REAL_CLIENT_AUTO_COMPACTION_MAX_PRESSURE_TURNS} bounded natural pressure turns; the installed client exposes no supported threshold override and qualification does not mutate user settings`);
};

const findArtifacts = (dataRoot) => walk(dataRoot).filter((entry) => !entry.directory && ARTIFACT_ID.test(path.basename(entry.relative)));
const durableContains = (dataRoot, segment, nonce) => walk(dataRoot).some((entry) => !entry.directory && entry.relative.split("/").includes(segment) && entry.bytes.includes(Buffer.from(nonce)));

const assertStreamJson = (bytes) => {
  const lines = bytes.toString("utf8").split("\n").filter(Boolean);
  if (!lines.length) throw new Error("headless Kiro emitted no stream-json events");
  for (const line of lines) {
    const value = JSON.parse(line);
    if (!value || typeof value !== "object") throw new Error("headless Kiro emitted a non-object stream-json event");
  }
};

const headlessSelector = (chatHelp) => {
  if (/--agent-engine(?:\s|[=<])/u.test(chatHelp)) return "--agent-engine";
  if (/--engine(?:\s|[=<])/u.test(chatHelp)) return "--engine";
  if (/--v3(?:\s|,|$)/mu.test(chatHelp)) return "--v3";
  throw new Error("installed kiro-cli chat help exposes no supported V3 headless selector");
};

const validateSyntax = (help) => /--path(?:\s|[=<])/u.test(help) ? "--path" : "positional";

const qualificationPrompt = (input) => `This is an objective Kiro Fabric qualification turn. Call @fabric/fabric_info once, then @fabric/fabric_workspace with ${JSON.stringify({ action: "status" })}, then @fabric/fabric_exec exactly once using these exact arguments: ${JSON.stringify(input)}. Do not use native file, shell, web, or subagent tools. Briefly summarize the returned tool result; do not make claims about process identity, agent selection, or qualification success.`;

const contextSeedPrompt = (input, fact, boundary = "manual compaction") => `Remember this exact, unpredictable conversational fact across the next ${boundary}: ${fact}. Do not write, send, or derive that fact through Fabric or any native tool. ${qualificationPrompt(input)}`;

const postCompactionPrompt = ({ code, payloads, boundary = "/compact" }) => `This is the post-compaction Kiro Fabric qualification turn. Call @fabric/fabric_info once, then @fabric/fabric_workspace with ${JSON.stringify({ action: "status" })}, then @fabric/fabric_exec exactly once. Use this exact code: ${JSON.stringify(code)}. Use resultFormat "json". Use these exact payload fields: ${JSON.stringify(payloads)}, and add one further string field named contextFact whose value is the exact unpredictable conversational fact I asked you to remember before ${boundary}. Do not ask me to repeat it, do not use any tool to recover it, and do not repeat it in prose. Do not use native file, shell, web, or subagent tools. Briefly summarize only the returned tool result; do not make claims about process identity, agent selection, or qualification success.`;

export const sentinelVerificationCode = (includeArtifact) => `
const record = (value: JsonValue): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
const field = (value: JsonValue, name: string): JsonValue | undefined => record(value)?.[name];
const nestedString = (value: JsonValue, outer: string, inner: string): string | undefined => {
  const nested = field(value, outer);
  const found = nested === undefined ? undefined : field(nested, inner);
  return typeof found === "string" ? found : undefined;
};
const memoryValue = await memory.get({ key: payloads.memoryKey });
const stateValue = await state.get({ key: payloads.stateKey });
${includeArtifact ? "const artifactValue = await artifacts.read({ id: payloads.artifactId, limit: 16000 });" : ""}
if (nestedString(memoryValue, "value", "nonce") !== payloads.nonce ||
    nestedString(memoryValue, "value", "kind") !== "durable-memory" ||
    nestedString(stateValue, "value", "nonce") !== payloads.nonce ||
    nestedString(stateValue, "value", "kind") !== "durable-state"${includeArtifact ? " ||\n    !(typeof field(artifactValue, \"text\") === \"string\" && (field(artifactValue, \"text\") as string).includes(payloads.nonce))" : ""}) {
  throw new Error("qualification sentinel mismatch");
}
return { verified: true${includeArtifact ? ", artifactVerified: true" : ""} };
`;

export const postCompactionVerificationCode = `
const record = (value: JsonValue): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
const field = (value: JsonValue, name: string): JsonValue | undefined => record(value)?.[name];
const nestedString = (value: JsonValue, outer: string, inner: string): string | undefined => {
  const nested = field(value, outer);
  const found = nested === undefined ? undefined : field(nested, inner);
  return typeof found === "string" ? found : undefined;
};
const memoryValue = await memory.get({ key: payloads.memoryKey });
const stateValue = await state.get({ key: payloads.stateKey });
const artifactValue = await artifacts.read({ id: payloads.artifactId, limit: 16000 });
if (nestedString(memoryValue, "value", "nonce") !== payloads.nonce ||
    nestedString(memoryValue, "value", "kind") !== "durable-memory" ||
    nestedString(stateValue, "value", "nonce") !== payloads.nonce ||
    nestedString(stateValue, "value", "kind") !== "durable-state" ||
    !(typeof field(artifactValue, "text") === "string" && (field(artifactValue, "text") as string).includes(payloads.nonce)) ||
    payloads.contextFact.length < 32) {
  throw new Error("qualification post-compaction sentinel mismatch");
}
await state.set({ key: payloads.contextKey, value: { fact: payloads.contextFact, kind: "compacted-conversation" } });
return { verified: true, artifactVerified: true, contextCaptured: true };
`;

export const resumeVerificationCode = `
const record = (value: JsonValue): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
const field = (value: JsonValue, name: string): JsonValue | undefined => record(value)?.[name];
const nestedString = (value: JsonValue, outer: string, inner: string): string | undefined => {
  const nested = field(value, outer);
  const found = nested === undefined ? undefined : field(nested, inner);
  return typeof found === "string" ? found : undefined;
};
const memoryValue = await memory.get({ key: payloads.memoryKey });
const stateValue = await state.get({ key: payloads.stateKey });
let artifactUnavailable = false;
try { await artifacts.read({ id: payloads.artifactId, limit: 16000 }); }
catch { artifactUnavailable = true; }
if (nestedString(memoryValue, "value", "nonce") !== payloads.nonce ||
    nestedString(memoryValue, "value", "kind") !== "durable-memory" ||
    nestedString(stateValue, "value", "nonce") !== payloads.nonce ||
    nestedString(stateValue, "value", "kind") !== "durable-state" ||
    !artifactUnavailable) {
  throw new Error("qualification resume sentinel mismatch");
}
return { durableVerified: true, artifactUnavailable: true };
`;

const validateObservedProcess = (observer, trace, options) => {
  if (observer.failure()) throw new Error(`OS process observation failed: ${errorText(observer.failure())}`);
  const identity = lifecycleIdentity(trace);
  const processRow = observer.seen.get(identity.pid);
  const kiroPid = processRow?.ppid;
  if (!processRow || !Number.isSafeInteger(kiroPid) || trace.start?.data?.parentPid !== kiroPid ||
      processRow.descendsFromLauncher !== true || typeof processRow.parentCommand !== "string" ||
      !processRow.parentCommand.startsWith(options.executable) ||
      !options.requiredArgs.every((argument) => processRow.parentCommand.includes(argument)) ||
      (options.expectedKiroPid !== undefined && kiroPid !== options.expectedKiroPid)) {
    throw new Error("OS process observation did not bind the Fabric MCP child to the expected Kiro executable and argv");
  }
  return { identity, kiroPid };
};

const assertOneObservedMcpProcess = (observer, kiroPid, label) => {
  if (observer.failure()) throw new Error(`OS process observation failed: ${errorText(observer.failure())}`);
  const observed = [...observer.seen.values()].filter((entry) => entry.descendsFromLauncher === true && entry.ppid === kiroPid);
  if (observed.length !== 1) throw new Error(`${label} observed ${observed.length} Fabric MCP processes instead of one`);
};

const runRealKiroAgentDriverImplementation = async ({ packageRoot, packageDigest, archiveDigest, commit, driverDigest, output, workspace, kiroHome, isolatedHome, installCwd }) => {
  if (typeof process.env.KIRO_API_KEY !== "string" || process.env.KIRO_API_KEY.trim().length < 1) throw new Error("KIRO_API_KEY is required for real-client qualification");
  const protectedCredential = Buffer.from(process.env.KIRO_API_KEY);
  const releaseRoot = assertPrivateDirectory(path.resolve(packageRoot));
  const releasePackage = validateAgentPackage(releaseRoot);
  if (releasePackage.digest !== packageDigest) throw new Error("extracted release package digest does not match the qualification input");
  const workspaceRoot = assertPrivateDirectory(path.resolve(workspace), true);
  const globalRoot = assertPrivateDirectory(path.resolve(kiroHome), true);
  const homeRoot = assertPrivateDirectory(path.resolve(isolatedHome));
  const installerCwd = assertPrivateDirectory(path.resolve(installCwd), true);
  if (containsReleaseProfile(releaseRoot)) throw new Error("release artifact contains a discoverable same-name workspace profile");
  const workspaceBeforeDigest = treeDigest(workspaceRoot);
  const executable = resolveKiroCli();
  const canonicalNodePath = fs.realpathSync(process.execPath);
  const kiroBytes = fs.readFileSync(executable);
  const kiroDigest = hash(kiroBytes);
  const kiroStats = fs.statSync(executable);
  const { KIRO_API_KEY: _protectedCredential, ...ambientEnvironment } = process.env;
  const environment = {
    ...ambientEnvironment,
    HOME: homeRoot,
    KIRO_HOME: globalRoot,
    XDG_CONFIG_HOME: path.join(homeRoot, ".config"),
    XDG_CACHE_HOME: path.join(homeRoot, ".cache"),
    XDG_DATA_HOME: path.join(homeRoot, ".local", "share"),
    KIRO_FABRIC_DEBUG: "1",
    KIRO_LOG_NO_COLOR: "1",
    NO_COLOR: "1",
  };
  const authenticatedEnvironment = { ...environment, KIRO_API_KEY: process.env.KIRO_API_KEY };

  const installer = path.join(releaseRoot, "scripts", "install-agent-user.mjs");
  const installResult = runSync(process.execPath, [installer, releaseRoot], { cwd: installerCwd, env: environment, timeout: 120_000 });
  const installLine = installResult.stdout.toString("utf8").split("\n").find((line) => line.trim().startsWith("{"));
  if (!installLine) throw new Error("archive installer emitted no structural result");
  const installed = JSON.parse(installLine);
  if (installed.packageDigest !== packageDigest) throw new Error("archive installer package digest mismatch");
  for (const key of ["root", "profile", "runtime", "data"]) if (typeof installed[key] !== "string" || !path.isAbsolute(installed[key]) || !lstat(installed[key])) throw new Error(`archive installer returned an invalid ${key}`);
  const expectedInstallRoot = path.join(globalRoot, "kiro-fabric");
  if (installed.root !== expectedInstallRoot ||
      installed.profile !== path.join(globalRoot, "agents", "kiro-fabric.json") ||
      installed.runtime !== path.join(expectedInstallRoot, "runtime", packageDigest) ||
      installed.data !== path.join(expectedInstallRoot, "data")) {
    throw new Error("archive installer returned paths outside the exact global package-digest installation");
  }
  const workspaceAfterInstallDigest = treeDigest(workspaceRoot);
  if (workspaceAfterInstallDigest !== workspaceBeforeDigest) throw new Error("archive installation mutated the qualification workspace");

  const configDirectory = path.join(installed.data, "fabric", "config");
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(configDirectory, 0o700);
  const configFile = path.join(configDirectory, "config.json");
  const qualificationConfig = (write) => `${JSON.stringify({ approvals: { read: "allow", write, execute: "deny", network: "deny" }, tracing: { enabled: true } }, null, 2)}\n`;
  fs.writeFileSync(configFile, qualificationConfig("ask"), { mode: 0o600, flag: "wx" });

  const version = runSync(executable, ["--version"], { cwd: workspaceRoot, env: environment });
  const help = runSync(executable, ["--help-all"], { cwd: workspaceRoot, env: environment });
  const chatHelp = runSync(executable, ["chat", "--help"], { cwd: workspaceRoot, env: environment });
  const agentValidateHelp = runSync(executable, ["agent", "validate", "--help"], { cwd: workspaceRoot, env: environment });
  const validateMode = validateSyntax(agentValidateHelp.combined.toString("utf8"));
  const validateArgv = validateMode === "--path" ? ["agent", "validate", "--path", installed.profile] : ["agent", "validate", installed.profile];
  const listArgv = ["agent", "list"];
  const unrelatedDirectory = path.join(installerCwd, "unrelated-project");
  const nestedDirectory = path.join(unrelatedDirectory, "nested-project");
  fs.mkdirSync(nestedDirectory, { recursive: true, mode: 0o700 });
  const resolutionWorkspaceBeforeDigest = treeDigest(unrelatedDirectory);
  const resolutionRuns = [workspaceRoot, unrelatedDirectory, nestedDirectory].map((cwd) => {
    if (containsReleaseProfile(cwd)) throw new Error(`qualification context contains a shadowing profile: ${cwd}`);
    const validation = runSync(executable, validateArgv, { cwd, env: authenticatedEnvironment, forbiddenValues: [protectedCredential] });
    const listing = runSync(executable, listArgv, { cwd, env: authenticatedEnvironment, forbiddenValues: [protectedCredential] });
    if (/(?:not logged in|login required|authentication (?:failed|required)|unauthenticated|validation failed)/iu.test(Buffer.concat([validation.combined, listing.combined]).toString("utf8"))) {
      throw new Error(`Kiro did not authenticate and validate/list the global agent from ${cwd}`);
    }
    if (!/(?:^|\W)kiro-fabric(?:\W|$)/u.test(listing.combined.toString("utf8"))) {
      throw new Error(`global agent list does not include kiro-fabric from ${cwd}`);
    }
    return { cwd, validation, listing };
  });
  const resolutionWorkspaceAfterDigest = treeDigest(unrelatedDirectory);
  if (resolutionWorkspaceAfterDigest !== resolutionWorkspaceBeforeDigest) throw new Error("Kiro validation/listing mutated an unrelated project directory");
  const inheritanceArgv = ["settings", "chat.disableInheritingDefaultResources", "--format", "json"];
  const inheritance = runSync(executable, inheritanceArgv, { cwd: workspaceRoot, env: authenticatedEnvironment, forbiddenValues: [protectedCredential] });
  let inheritanceValue;
  try { inheritanceValue = JSON.parse(inheritance.stdout.toString("utf8")); }
  catch { throw new Error("Kiro did not emit structural inheritance-setting output"); }
  if (inheritanceValue !== null && inheritanceValue !== false) {
    throw new Error("isolated qualification must exercise Kiro's default resource inheritance without mutating settings");
  }
  const autoCompactionArgv = ["settings", "chat.disableAutoCompaction", "--format", "json"];
  const autoCompaction = runSync(executable, autoCompactionArgv, { cwd: workspaceRoot, env: authenticatedEnvironment, forbiddenValues: [protectedCredential] });
  let disableAutoCompactionValue;
  try { disableAutoCompactionValue = JSON.parse(autoCompaction.stdout.toString("utf8")); }
  catch { throw new Error("Kiro did not emit structural automatic-compaction-setting output"); }
  if (disableAutoCompactionValue !== null && disableAutoCompactionValue !== false) {
    throw new Error("isolated qualification must leave Kiro automatic compaction enabled without mutating settings");
  }
  const skillPath = path.join(installed.root, "skills", "fabric-exec", "SKILL.md");
  const installedProfileOptions = {
    nodePath: canonicalNodePath,
    runtimeRoot: installed.runtime,
    dataRoot: installed.data,
    skillPath,
    installRoot: installed.root,
  };
  const installedProfile = validateInstalledAgentProfile(installed.profile, installedProfileOptions);
  const profile = installedProfile.profile;
  const installedRuntime = snapshotTree(installed.runtime);
  const installedSkill = snapshotTree(path.dirname(skillPath));
  if (installedRuntime.digest !== releasePackage.runtime.digest || installedSkill.digest !== releasePackage.skill.digest) {
    throw new Error("installed runtime or skill tree differs from the extracted release package");
  }
  const mcpEntry = profile.mcpServers.fabric.args?.[0];
  if (typeof mcpEntry !== "string" || !path.isAbsolute(mcpEntry) || !lstat(mcpEntry)) throw new Error("installed profile MCP entry is invalid");

  const nonce = randomBytes(24).toString("hex");
  const historyNonce = randomBytes(24).toString("hex");
  const conversationFact = `context-${randomBytes(24).toString("hex")}`;
  const memoryKey = `qualification-memory-${nonce}`;
  const stateKey = `qualification-state-${nonce}`;
  const contextStateKey = `qualification-compacted-context-${nonce}`;

  const knownBeforeFormProbe = new Set(traceSessions(installed.data).map((entry) => entry.id));
  const interactiveArgv = REAL_CLIENT_INTERACTIVE_COMMAND.slice(1);
  const formRecord = path.join(homeRoot, "form-probe-acp.jsonl");
  const formProbe = startPty(executable, interactiveArgv, {
    cwd: workspaceRoot,
    env: { ...authenticatedEnvironment, KIRO_ACP_RECORD_PATH: formRecord },
    forbiddenValues: [protectedCredential],
  });
  const formObserver = observeMcpProcesses(mcpEntry, formProbe.child.pid);
  const formStartCursor = formProbe.capture.cursor();
  await maybeTrustWorkspace(formProbe);
  const formStartOutput = formProbe.capture.slice(formStartCursor);
  const formPromptCursor = formProbe.capture.cursor();
  formProbe.send(qualificationPrompt({
    code: "return await memory.set({ key: payloads.key, value: { probe: payloads.nonce } })",
    payloads: { key: `qualification-form-${nonce}`, nonce },
    resultFormat: "json",
  }));
  const formRequestTrace = await waitForTrace(installed.data, (candidate) => {
    if (knownBeforeFormProbe.has(candidate.id)) return false;
    const metrics = formMetrics(candidate);
    return metrics.requests.length === 1 && candidate.events.some((event) => event.ev === "tool.fabric_info") &&
      candidate.events.some((event) => event.ev === "tool.fabric_exec");
  }, 120_000);
  assertSingleRuntime(formRequestTrace);
  const formClientCapabilities = clientCapabilities(formRequestTrace);
  await waitForTerminalText(formProbe, formPromptCursor, /(?=[\s\S]*Approve once)(?=[\s\S]*Risk:\s*write)[\s\S]/iu, 30_000);
  const formRequestOutput = formProbe.capture.slice(formPromptCursor);
  const formResponseCursor = formProbe.capture.cursor();
  formProbe.send("n");
  let formFinalTrace;
  try {
    formFinalTrace = await waitForTrace(installed.data, (candidate) => {
      if (candidate.id !== formRequestTrace.id) return false;
      const metrics = formMetrics(candidate);
      return metrics.responses.length === 1 && metrics.failed.length === 1 && metrics.denied.length === 1 && metrics.writeErrors.length === 1;
    }, 15_000);
  } catch {
    // Escape is a safe dismissal fallback if this Kiro TUI does not accept
    // the boolean form's default-false value through `n` + Enter.
    formProbe.sendRaw("\x1b");
    formFinalTrace = await waitForTrace(installed.data, (candidate) => {
      if (candidate.id !== formRequestTrace.id) return false;
      const metrics = formMetrics(candidate);
      return metrics.responses.length === 1 && metrics.failed.length === 1 && metrics.denied.length === 1 && metrics.writeErrors.length === 1;
    }, 30_000);
  }
  await waitForQuiet(formProbe, formResponseCursor, 120_000);
  const formResponseOutput = formProbe.capture.slice(formResponseCursor);
  const form = formMetrics(formFinalTrace);
  const formRequest = form.requests[0]?.data;
  const formResponse = form.responses[0]?.data;
  if (!formRequest?.elicitationId || formRequest.elicitationId !== formResponse?.elicitationId ||
      !["accept", "decline", "cancel"].includes(formResponse?.action) || formResponse.approved !== false) {
    throw new Error("form-elicitation request/response identity is incomplete");
  }
  const formProcess = validateObservedProcess(formObserver, formFinalTrace, {
    executable,
    requiredArgs: ["--v3", "--agent", "kiro-fabric"],
  });
  assertOneObservedMcpProcess(formObserver, formProcess.kiroPid, "form probe");
  const formDescendants = observedDescendants(formProcess.identity.pid);
  const formShutdownCursor = formProbe.capture.cursor();
  formProbe.send("/quit");
  const formExit = await waitForExit(formProbe.child, 120_000);
  formObserver.stop();
  if (formProbe.capture.failure()) throw formProbe.capture.failure();
  if (formExit.code !== 0) throw new Error(`form-probe Kiro exited ${formExit.code ?? formExit.signal}`);
  await waitUntilDead(formProcess.kiroPid);
  await waitUntilDead(formProcess.identity.pid);
  await waitUntilObservedDead(formDescendants);
  formObserver.release();
  const formShutdownOutput = formProbe.capture.slice(formShutdownCursor);
  const formTrace = traceSessions(installed.data, false).find((entry) => entry.id === formRequestTrace.id);
  if (!formTrace?.events.some((event) => event.ev === "runtime.stop" && event.data?.runtimeGeneration === 1)) {
    throw new Error("form-probe Fabric MCP did not record a graceful runtime drain");
  }
  const formRecording = recordingEvidence(formRecord, [protectedCredential]);
  const formRecordingFrames = acpFrames(formRecord);
  if (!acpFormInteractionObserved(formRecordingFrames)) throw new Error("Kiro ACP recording did not contain a structural form-elicitation event");
  if (durableContains(installed.data, "memory", nonce)) throw new Error("declined form probe mutated durable memory");

  fs.writeFileSync(configFile, qualificationConfig("allow"), { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(configFile, 0o600);
  const knownBeforeInteractive = new Set(traceSessions(installed.data).map((entry) => entry.id));
  const interactiveRecord = path.join(homeRoot, "interactive-acp.jsonl");
  const interactiveEnvironment = { ...authenticatedEnvironment, KIRO_ACP_RECORD_PATH: interactiveRecord };
  const interactive = startPty(executable, interactiveArgv, { cwd: workspaceRoot, env: interactiveEnvironment, forbiddenValues: [protectedCredential] });
  const interactiveObserver = observeMcpProcesses(mcpEntry, interactive.child.pid);
  const interactiveStart = interactive.capture.cursor();
  await maybeTrustWorkspace(interactive);
  const interactiveStartOutput = interactive.capture.slice(interactiveStart);

  const toolsCursor = interactive.capture.cursor();
  interactive.send("/tools");
  await waitForQuiet(interactive, toolsCursor, 120_000);
  const toolsOutput = interactive.capture.slice(toolsCursor);
  const toolsText = stripTerminal(toolsOutput);
  const visibleNativeTools = REAL_CLIENT_NATIVE_TOOLS.filter((tool) => visibleToolToken(toolsText, tool));
  const visibleFabricTools = REAL_CLIENT_TOOLS.filter((tool) => visibleToolToken(toolsText, tool));
  if (JSON.stringify(visibleNativeTools) !== JSON.stringify(REAL_CLIENT_NATIVE_TOOLS) ||
      JSON.stringify(visibleFabricTools) !== JSON.stringify(REAL_CLIENT_TOOLS) ||
      !visibleToolToken(toolsText, "@fabric")) {
    throw new Error("Kiro /tools did not expose the exact profile-native categories and Fabric tool set");
  }
  interactive.sendRaw("\x1b");
  await waitForFreshQuiet(interactive);

  const turn1 = await runInteractiveTurn({
    session: interactive,
    dataRoot: installed.data,
    excludedIds: knownBeforeInteractive,
    prompt: qualificationPrompt({
      code: `const memoryResult = await memory.set({ key: ${JSON.stringify(memoryKey)}, value: { nonce: payloads.nonce, kind: "durable-memory" } }); const stateResult = await state.set({ key: ${JSON.stringify(stateKey)}, value: { nonce: payloads.nonce, kind: "durable-state" } }); return { memoryResult, stateResult, ephemeral: payloads.ephemeral.repeat(2000) }`,
      payloads: { nonce, historyNonce, ephemeral: `ephemeral-${nonce}` },
      resultFormat: "json",
    }),
    expectedRefs: ["memory.set", "state.set"],
    name: "turn-1",
  });
  const interactiveId = turn1.trace.id;
  const interactiveClientCapabilities = clientCapabilities(turn1.trace);
  const artifactDeadline = Date.now() + 30_000;
  let artifacts = findArtifacts(installed.data);
  while (artifacts.length !== 1 && Date.now() < artifactDeadline) { await delay(100); artifacts = findArtifacts(installed.data); }
  if (artifacts.length !== 1 || !artifacts[0].bytes.includes(Buffer.from(nonce))) throw new Error("turn 1 did not create one nonce-bound process-local artifact");
  const artifactId = path.basename(artifacts[0].relative);
  const artifactPath = path.join(installed.data, artifacts[0].relative);
  const durableMemory = durableContains(installed.data, "memory", nonce);
  const durableState = durableContains(installed.data, "state", nonce);
  if (!durableMemory || !durableState) throw new Error("turn 1 did not create both durable sentinels");

  const turn2 = await runInteractiveTurn({
    session: interactive,
    dataRoot: installed.data,
    targetId: interactiveId,
    excludedIds: knownBeforeInteractive,
    prompt: qualificationPrompt({ code: sentinelVerificationCode(true), payloads: { nonce, memoryKey, stateKey, artifactId }, resultFormat: "json" }),
    expectedRefs: ["memory.get", "state.get", "artifacts.read"],
    name: "turn-2",
  });
  const turn3Arguments = { code: sentinelVerificationCode(false), payloads: { nonce, memoryKey, stateKey }, resultFormat: "json" };
  const turn3Prompt = contextSeedPrompt(turn3Arguments, conversationFact);
  const turn3RecordingOffset = fs.readFileSync(interactiveRecord).length;
  const turn3 = await runInteractiveTurn({
    session: interactive,
    dataRoot: installed.data,
    targetId: interactiveId,
    excludedIds: knownBeforeInteractive,
    prompt: turn3Prompt,
    expectedRefs: ["memory.get", "state.get"],
    name: "turn-3",
  });
  const sessionCursor = interactive.capture.cursor();
  interactive.send("/session-id");
  await waitForQuiet(interactive, sessionCursor, 120_000);
  const sessionOutput = interactive.capture.slice(sessionCursor);
  const sessionIdBeforeCompaction = sessionIdFromOutput(sessionOutput);
  if (!sessionIdBeforeCompaction) throw new Error("Kiro /session-id did not yield a structural session UUID");
  const turn3Acp = await waitForAcpFabricExec(interactiveRecord, turn3RecordingOffset, {
    sessionId: sessionIdBeforeCompaction,
    expectedArguments: turn3Arguments,
    expectedResult: { verified: true },
  });
  const compactionRecordingOffset = fs.readFileSync(interactiveRecord).length;
  if (compactionRecordingOffset < 1) throw new Error("Kiro ACP recording was empty before manual /compact");
  const turn3ThroughCompactionBoundary = acpFrames(interactiveRecord, turn3RecordingOffset, compactionRecordingOffset);
  const finalizedTurn3Calls = completedAcpFabricExecCalls(turn3ThroughCompactionBoundary, {
    sessionId: sessionIdBeforeCompaction,
    expectedArguments: turn3Arguments,
    expectedResult: { verified: true },
  });
  if (finalizedTurn3Calls.length !== 1 || qualificationValueDigest(finalizedTurn3Calls[0]) !== qualificationValueDigest(turn3Acp.call)) {
    throw new Error("context-seed fabric_exec evidence changed before /compact");
  }
  if (acpToolDataContaining(turn3ThroughCompactionBoundary, conversationFact).length !== 0) {
    throw new Error("pre-compaction conversational fact appeared in structural ACP tool data before /compact");
  }

  // End-bind each structural event before sending any later command. A later
  // automatic compaction cannot satisfy any manual /compact cycle.
  const firstManualCompaction = await manualCompactionCycle({
    session: interactive,
    recordFile: interactiveRecord,
    dataRoot: installed.data,
    traceId: interactiveId,
    sessionId: sessionIdBeforeCompaction,
    index: 1,
  });
  const compactionOutput = firstManualCompaction.terminalOutput;
  const compactionInterval = firstManualCompaction.interval;
  const compactionRecordingEndOffset = firstManualCompaction.gate.intervalEndOffset;
  const compactIdentity = firstManualCompaction.mcp;
  const postCompactSessionOutput = firstManualCompaction.sessionOutput;
  let sessionId = firstManualCompaction.gate.sessionIdAfter;
  const firstPostCompactionSessionId = sessionId;

  const postCompactPublicPayloads = { nonce, memoryKey, stateKey, artifactId, contextKey: contextStateKey };
  const postCompactArguments = {
    code: postCompactionVerificationCode,
    payloads: { ...postCompactPublicPayloads, contextFact: conversationFact },
    resultFormat: "json",
  };
  const postCompactExpectedResult = { verified: true, artifactVerified: true, contextCaptured: true };
  const postCompactPromptText = postCompactionPrompt({ code: postCompactionVerificationCode, payloads: postCompactPublicPayloads });
  if (postCompactPromptText.includes(conversationFact)) throw new Error("post-compaction prompt restated the conversational fact");
  const postCompactRecordingOffset = fs.readFileSync(interactiveRecord).length;
  const postCompact = await runInteractiveTurn({
    session: interactive,
    dataRoot: installed.data,
    targetId: interactiveId,
    excludedIds: knownBeforeInteractive,
    prompt: postCompactPromptText,
    expectedRefs: ["memory.get", "state.get", "artifacts.read", "state.set"],
    name: "post-compaction",
  });
  const postCompactAcp = await waitForAcpFabricExec(interactiveRecord, postCompactRecordingOffset, {
    sessionId,
    expectedArguments: postCompactArguments,
    expectedResult: postCompactExpectedResult,
  });
  if (postCompactAcp.call.observedContextFactDigest !== qualificationValueDigest(conversationFact)) {
    throw new Error("post-compaction fabric_exec payload was not semantically bound to the conversational fact");
  }
  if (!durableContains(installed.data, "state", conversationFact)) {
    throw new Error("post-compaction fabric_exec did not persist the remembered conversational fact");
  }
  const interactiveProcess = validateObservedProcess(interactiveObserver, postCompact.trace, {
    executable,
    requiredArgs: ["--v3", "--agent", "kiro-fabric"],
  });
  const interactiveIdentity = interactiveProcess.identity;
  if (JSON.stringify(interactiveIdentity) !== JSON.stringify(turn1.evidence.mcp) || JSON.stringify(interactiveIdentity) !== JSON.stringify(compactIdentity)) throw new Error("Fabric MCP identity changed across interactive turns or compaction");
  assertOneObservedMcpProcess(interactiveObserver, interactiveProcess.kiroPid, "interactive Kiro");
  const interactiveKiroPid = interactiveProcess.kiroPid;
  const postCompactRecordingEndOffset = fs.readFileSync(interactiveRecord).length;
  const finalizedPostCompactCalls = completedAcpFabricExecCalls(
    acpFrames(interactiveRecord, postCompactRecordingOffset, postCompactRecordingEndOffset),
    { sessionId, expectedArguments: postCompactArguments, expectedResult: postCompactExpectedResult },
  );
  if (finalizedPostCompactCalls.length !== 1 || qualificationValueDigest(finalizedPostCompactCalls[0]) !== qualificationValueDigest(postCompactAcp.call)) {
    throw new Error("post-compaction fabric_exec evidence changed before Kiro shutdown");
  }

  const manualCompactions = [firstManualCompaction];
  const manualVerificationTurns = [];
  const compactionCycleContextSeeds = [];
  const compactionCycleCalls = [];
  for (let index = 2; index <= REAL_CLIENT_MANUAL_COMPACTION_CYCLES; index += 1) {
    const fact = `context-manual-${index}-${randomBytes(24).toString("hex")}`;
    const contextKey = `qualification-compacted-context-manual-${index}-${nonce}`;
    const seedArguments = {
      code: sentinelVerificationCode(false),
      payloads: { nonce, memoryKey, stateKey },
      resultFormat: "json",
    };
    const seedPrompt = contextSeedPrompt(seedArguments, fact, `manual compaction cycle ${index}`);
    const seedRecordingOffset = fs.readFileSync(interactiveRecord).length;
    const seedTurn = await runInteractiveTurn({
      session: interactive,
      dataRoot: installed.data,
      targetId: interactiveId,
      excludedIds: knownBeforeInteractive,
      prompt: seedPrompt,
      expectedRefs: ["memory.get", "state.get"],
      name: `manual-compaction-${index}-context-seed`,
    });
    const seedAcp = await waitForAcpFabricExec(interactiveRecord, seedRecordingOffset, {
      sessionId,
      expectedArguments: seedArguments,
      expectedResult: { verified: true },
    });
    const compactionBoundaryOffset = fs.readFileSync(interactiveRecord).length;
    const seedFrames = acpFrames(interactiveRecord, seedRecordingOffset, compactionBoundaryOffset);
    const finalizedSeedCalls = completedAcpFabricExecCalls(seedFrames, {
      sessionId,
      expectedArguments: seedArguments,
      expectedResult: { verified: true },
    });
    if (finalizedSeedCalls.length !== 1 ||
        qualificationValueDigest(finalizedSeedCalls[0]) !== qualificationValueDigest(seedAcp.call) ||
        acpToolDataContaining(seedFrames, fact).length !== 0) {
      throw new Error(`manual compaction cycle ${index} conversation fact leaked into pre-compaction tool data`);
    }
    const cycle = await manualCompactionCycle({
      session: interactive,
      recordFile: interactiveRecord,
      dataRoot: installed.data,
      traceId: interactiveId,
      sessionId,
      index,
    });
    if (JSON.stringify(cycle.mcp) !== JSON.stringify(interactiveIdentity)) {
      throw new Error(`Fabric MCP identity changed during manual compaction cycle ${index}`);
    }
    if (cycle.gate.intervalStartOffset !== compactionBoundaryOffset) {
      throw new Error(`manual compaction cycle ${index} is not adjacent to its conversation-only context seed`);
    }
    if (acpToolDataContaining(
      acpFrames(interactiveRecord, seedRecordingOffset, cycle.gate.intervalEndOffset),
      fact,
    ).length !== 0) {
      throw new Error(`manual compaction cycle ${index} conversation fact appeared in structural tool data before compaction completed`);
    }
    manualCompactions.push(cycle);
    sessionId = cycle.gate.sessionIdAfter;
    const publicPayloads = { nonce, memoryKey, stateKey, artifactId, contextKey };
    const argumentsValue = {
      code: postCompactionVerificationCode,
      payloads: { ...publicPayloads, contextFact: fact },
      resultFormat: "json",
    };
    const expectedResult = { verified: true, artifactVerified: true, contextCaptured: true };
    const prompt = postCompactionPrompt({
      code: postCompactionVerificationCode,
      payloads: publicPayloads,
      boundary: `manual compaction cycle ${index}`,
    });
    if (prompt.includes(fact)) throw new Error(`manual compaction cycle ${index} post-compaction prompt restated its fact`);
    const recordingOffset = fs.readFileSync(interactiveRecord).length;
    const turn = await runInteractiveTurn({
      session: interactive,
      dataRoot: installed.data,
      targetId: interactiveId,
      excludedIds: knownBeforeInteractive,
      prompt,
      expectedRefs: ["memory.get", "state.get", "artifacts.read", "state.set"],
      name: `post-manual-compaction-${index}`,
    });
    if (JSON.stringify(turn.evidence.mcp) !== JSON.stringify(interactiveIdentity)) {
      throw new Error(`Fabric MCP identity changed after manual compaction cycle ${index}`);
    }
    const acp = await waitForAcpFabricExec(interactiveRecord, recordingOffset, {
      sessionId,
      expectedArguments: argumentsValue,
      expectedResult,
    });
    const recordingEndOffset = fs.readFileSync(interactiveRecord).length;
    const finalized = completedAcpFabricExecCalls(
      acpFrames(interactiveRecord, recordingOffset, recordingEndOffset),
      { sessionId, expectedArguments: argumentsValue, expectedResult },
    );
    if (finalized.length !== 1 || qualificationValueDigest(finalized[0]) !== qualificationValueDigest(acp.call)) {
      throw new Error(`manual compaction cycle ${index} verification changed before the next cycle`);
    }
    if (acp.call.observedContextFactDigest !== qualificationValueDigest(fact) ||
        !durableContains(installed.data, "state", fact)) {
      throw new Error(`manual compaction cycle ${index} did not structurally recall and persist its conversation-only fact`);
    }
    manualVerificationTurns.push({
      index,
      fact,
      contextKey,
      seedRecordingOffset,
      seedTurn,
      seedAcp,
      turn,
      acp,
      argumentsValue,
      expectedResult,
    });
    compactionCycleContextSeeds.push({ kind: "manual", cycle: index, ...seedAcp.call });
    compactionCycleCalls.push({ kind: "manual", cycle: index, ...acp.call });
  }

  if (manualCompactions.length !== REAL_CLIENT_MANUAL_COMPACTION_CYCLES) {
    throw new Error("required repeated manual compaction cycles were not completed");
  }
  const manualCompaction2 = manualCompactions[1];
  const manualCompaction3 = manualCompactions[2];
  const manualVerification2 = manualVerificationTurns[0];
  const manualVerification3 = manualVerificationTurns[1];
  if (!manualCompaction2 || !manualCompaction3 || !manualVerification2 || !manualVerification3) {
    throw new Error("manual compaction cycle evidence is incomplete");
  }
  const automaticFact = `context-automatic-1-${randomBytes(24).toString("hex")}`;
  const automaticContextKey = `qualification-compacted-context-automatic-1-${nonce}`;
  const automaticSeedArguments = {
    code: sentinelVerificationCode(false),
    payloads: { nonce, memoryKey, stateKey },
    resultFormat: "json",
  };
  const automaticSeedPrompt = contextSeedPrompt(automaticSeedArguments, automaticFact, "natural automatic compaction");
  const automaticSeedRecordingOffset = fs.readFileSync(interactiveRecord).length;
  const automaticSeedTurn = await runInteractiveTurn({
    session: interactive,
    dataRoot: installed.data,
    targetId: interactiveId,
    excludedIds: knownBeforeInteractive,
    prompt: automaticSeedPrompt,
    expectedRefs: ["memory.get", "state.get"],
    name: "automatic-compaction-context-seed",
  });
  const automaticSeedAcp = await waitForAcpFabricExec(interactiveRecord, automaticSeedRecordingOffset, {
    sessionId,
    expectedArguments: automaticSeedArguments,
    expectedResult: { verified: true },
  });
  const automaticSeedEndOffset = fs.readFileSync(interactiveRecord).length;
  const automaticSeedFrames = acpFrames(interactiveRecord, automaticSeedRecordingOffset, automaticSeedEndOffset);
  const finalizedAutomaticSeedCalls = completedAcpFabricExecCalls(automaticSeedFrames, {
    sessionId,
    expectedArguments: automaticSeedArguments,
    expectedResult: { verified: true },
  });
  if (finalizedAutomaticSeedCalls.length !== 1 ||
      qualificationValueDigest(finalizedAutomaticSeedCalls[0]) !== qualificationValueDigest(automaticSeedAcp.call) ||
      acpToolDataContaining(automaticSeedFrames, automaticFact).length !== 0) {
    throw new Error("automatic compaction conversation fact leaked into its context-seed tool data");
  }
  const automaticCompaction = await automaticCompactionCycle({
    session: interactive,
    recordFile: interactiveRecord,
    dataRoot: installed.data,
    traceId: interactiveId,
    sessionId,
  });
  if (REAL_CLIENT_AUTOMATIC_COMPACTION_CYCLES !== 1 ||
      JSON.stringify(automaticCompaction.mcp) !== JSON.stringify(interactiveIdentity)) {
    throw new Error("Fabric MCP identity changed during automatic compaction");
  }
  if (automaticCompaction.gate.intervalStartOffset !== automaticSeedEndOffset ||
      acpToolDataContaining(
        acpFrames(interactiveRecord, automaticSeedRecordingOffset, automaticCompaction.gate.intervalEndOffset),
        automaticFact,
      ).length !== 0) {
    throw new Error("automatic compaction is not adjacent to its conversation-only seed or leaked the fact into tool data");
  }
  sessionId = automaticCompaction.gate.sessionIdAfter;
  const automaticPublicPayloads = {
    nonce,
    memoryKey,
    stateKey,
    artifactId,
    contextKey: automaticContextKey,
  };
  const automaticArguments = {
    code: postCompactionVerificationCode,
    payloads: { ...automaticPublicPayloads, contextFact: automaticFact },
    resultFormat: "json",
  };
  const automaticExpectedResult = { verified: true, artifactVerified: true, contextCaptured: true };
  const automaticPrompt = postCompactionPrompt({
    code: postCompactionVerificationCode,
    payloads: automaticPublicPayloads,
    boundary: "the natural automatic compaction",
  });
  if (automaticPrompt.includes(automaticFact)) throw new Error("automatic post-compaction prompt restated its fact");
  const automaticVerificationOffset = fs.readFileSync(interactiveRecord).length;
  const automaticVerification = await runInteractiveTurn({
    session: interactive,
    dataRoot: installed.data,
    targetId: interactiveId,
    excludedIds: knownBeforeInteractive,
    prompt: automaticPrompt,
    expectedRefs: ["memory.get", "state.get", "artifacts.read", "state.set"],
    name: "post-automatic-compaction",
  });
  if (JSON.stringify(automaticVerification.evidence.mcp) !== JSON.stringify(interactiveIdentity)) {
    throw new Error("Fabric MCP identity changed after automatic compaction");
  }
  const automaticAcp = await waitForAcpFabricExec(interactiveRecord, automaticVerificationOffset, {
    sessionId,
    expectedArguments: automaticArguments,
    expectedResult: automaticExpectedResult,
  });
  const automaticVerificationEndOffset = fs.readFileSync(interactiveRecord).length;
  const finalizedAutomaticCalls = completedAcpFabricExecCalls(
    acpFrames(interactiveRecord, automaticVerificationOffset, automaticVerificationEndOffset),
    { sessionId, expectedArguments: automaticArguments, expectedResult: automaticExpectedResult },
  );
  if (finalizedAutomaticCalls.length !== 1 ||
      qualificationValueDigest(finalizedAutomaticCalls[0]) !== qualificationValueDigest(automaticAcp.call)) {
    throw new Error("automatic compaction verification changed before Kiro shutdown");
  }
  if (automaticAcp.call.observedContextFactDigest !== qualificationValueDigest(automaticFact) ||
      !durableContains(installed.data, "state", automaticFact)) {
    throw new Error("automatic compaction did not structurally recall and persist its conversation-only fact");
  }
  compactionCycleContextSeeds.push({ kind: "automatic", cycle: 1, ...automaticSeedAcp.call });
  compactionCycleCalls.push({ kind: "automatic", cycle: 1, ...automaticAcp.call });
  assertOneObservedMcpProcess(interactiveObserver, interactiveKiroPid, "interactive Kiro after every compaction cycle");
  const interactiveDescendants = observedDescendants(interactiveIdentity.pid);

  const shutdownCursor = interactive.capture.cursor();
  interactive.send("/quit");
  const interactiveExit = await waitForExit(interactive.child, 120_000);
  interactiveObserver.stop();
  if (interactive.capture.failure()) throw interactive.capture.failure();
  if (interactiveExit.code !== 0) throw new Error(`interactive Kiro exited ${interactiveExit.code ?? interactiveExit.signal}`);
  await waitUntilDead(interactiveKiroPid);
  await waitUntilDead(interactiveIdentity.pid);
  await waitUntilObservedDead(interactiveDescendants);
  interactiveObserver.release();
  const interactiveFinalTrace = traceSessions(installed.data, false).find((entry) => entry.id === interactiveId);
  if (!interactiveFinalTrace?.events.some((event) => event.ev === "runtime.stop" && event.data?.runtimeGeneration === 1)) throw new Error("interactive Fabric MCP did not record a graceful runtime drain");
  if (lstat(artifactPath)) throw new Error("process-local artifact survived Fabric runtime shutdown");
  const shutdownOutput = interactive.capture.slice(shutdownCursor);

  const knownBeforeResume = new Set(traceSessions(installed.data).map((entry) => entry.id));
  const resumeArgv = ["--v3", "--agent", "kiro-fabric", "--resume-id", sessionId];
  const resumeRecord = path.join(homeRoot, "resume-acp.jsonl");
  const resumed = startPty(executable, resumeArgv, {
    cwd: workspaceRoot,
    env: { ...authenticatedEnvironment, KIRO_ACP_RECORD_PATH: resumeRecord },
    forbiddenValues: [protectedCredential],
  });
  const resumeObserver = observeMcpProcesses(mcpEntry, resumed.child.pid);
  const resumeStart = resumed.capture.cursor();
  await maybeTrustWorkspace(resumed);
  const resumeStartOutput = resumed.capture.slice(resumeStart);
  const resumedSessionCursor = resumed.capture.cursor();
  resumed.send("/session-id");
  await waitForQuiet(resumed, resumedSessionCursor, 120_000);
  const resumedSessionOutput = resumed.capture.slice(resumedSessionCursor);
  const resumedSessionId = sessionIdFromOutput(resumedSessionOutput);
  if (resumedSessionId !== sessionId) {
    throw new Error("resumed Kiro process did not restore the active post-compaction session id");
  }
  const resumeArguments = { code: resumeVerificationCode, payloads: { nonce, memoryKey, stateKey, artifactId }, resultFormat: "json" };
  const resumeExpectedResult = { durableVerified: true, artifactUnavailable: true };
  const resumeRecordingOffset = fs.readFileSync(resumeRecord).length;
  const resumeTurn = await runInteractiveTurn({
    session: resumed,
    dataRoot: installed.data,
    excludedIds: knownBeforeResume,
    prompt: qualificationPrompt(resumeArguments),
    expectedRefs: ["memory.get", "state.get", "artifacts.read"],
    name: "resume-turn",
  });
  const resumeAcp = await waitForAcpFabricExec(resumeRecord, resumeRecordingOffset, {
    sessionId,
    expectedArguments: resumeArguments,
    expectedResult: resumeExpectedResult,
  });
  const resumeProcess = validateObservedProcess(resumeObserver, resumeTurn.trace, {
    executable,
    requiredArgs: ["--v3", "--agent", "kiro-fabric", "--resume-id", sessionId],
  });
  const resumeIdentity = resumeProcess.identity;
  assertOneObservedMcpProcess(resumeObserver, resumeProcess.kiroPid, "resumed Kiro");
  if (resumeIdentity.pid === interactiveIdentity.pid || resumeIdentity.mcpInstanceId === interactiveIdentity.mcpInstanceId || resumeIdentity.runtimeGeneration !== 1) throw new Error("resumed Kiro process did not create exactly one fresh Fabric MCP instance");
  const resumeMetrics = turnMetrics(resumeTurn.trace, 0);
  const artifactFailure = resumeTurn.trace.events.some((event) => bridgeRef(event) === "artifacts.read" && typeof event.data?.error === "string" && /unavailable|expired/iu.test(event.data.error));
  if (!artifactFailure || !durableContains(installed.data, "memory", nonce) || !durableContains(installed.data, "state", nonce)) throw new Error("resume did not distinguish durable state from process-local artifacts");
  const resumeKiroPid = resumeProcess.kiroPid;
  const resumeDescendants = observedDescendants(resumeIdentity.pid);
  const resumeRecordingEndOffset = fs.readFileSync(resumeRecord).length;
  const finalizedResumeCalls = completedAcpFabricExecCalls(
    acpFrames(resumeRecord, resumeRecordingOffset, resumeRecordingEndOffset),
    { sessionId, expectedArguments: resumeArguments, expectedResult: resumeExpectedResult },
  );
  if (finalizedResumeCalls.length !== 1 || qualificationValueDigest(finalizedResumeCalls[0]) !== qualificationValueDigest(resumeAcp.call)) {
    throw new Error("resume fabric_exec evidence changed before Kiro shutdown");
  }
  const resumeShutdownCursor = resumed.capture.cursor();
  resumed.send("/quit");
  const resumeExit = await waitForExit(resumed.child, 120_000);
  resumeObserver.stop();
  if (resumed.capture.failure()) throw resumed.capture.failure();
  if (resumeExit.code !== 0) throw new Error(`resumed Kiro exited ${resumeExit.code ?? resumeExit.signal}`);
  await waitUntilDead(resumeKiroPid);
  await waitUntilDead(resumeIdentity.pid);
  await waitUntilObservedDead(resumeDescendants);
  resumeObserver.release();
  const resumeFinalTrace = traceSessions(installed.data, false).find((entry) => entry.id === resumeTurn.trace.id);
  if (!resumeFinalTrace?.events.some((event) => event.ev === "runtime.stop" && event.data?.runtimeGeneration === 1)) throw new Error("resumed Fabric MCP did not record a graceful runtime drain");
  const resumeShutdownOutput = resumed.capture.slice(resumeShutdownCursor);

  const selector = headlessSelector(chatHelp.combined.toString("utf8"));
  const headlessPrompt = qualificationPrompt({ code: "return { nonce: payloads.nonce, providers: await tools.providers() }", payloads: { nonce }, resultFormat: "json" });
  const headlessArgv = ["chat", ...(selector === "--v3" ? ["--v3"] : [selector, "v3"]), "--agent", "kiro-fabric", "--no-interactive", "--require-mcp-startup", "--output-format", "stream-json", headlessPrompt];
  const knownBeforeHeadless = new Set(traceSessions(installed.data).map((entry) => entry.id));
  const headlessChild = trackQualificationChild(spawn(executable, headlessArgv, { cwd: workspaceRoot, env: environmentAt(authenticatedEnvironment, workspaceRoot), stdio: ["ignore", "pipe", "pipe"] }));
  const headlessCapture = attachCapture(headlessChild, MAX_COMMAND_BYTES, [protectedCredential]);
  const headlessObserver = observeMcpProcesses(mcpEntry, headlessChild.pid);
  const headlessExit = await waitForExit(headlessChild);
  headlessObserver.stop();
  if (headlessCapture.failure()) throw headlessCapture.failure();
  if (headlessExit.code !== 0) throw new Error(`headless Kiro exited ${headlessExit.code ?? headlessExit.signal}: ${headlessCapture.slice().toString("utf8").slice(0, 2_000)}`);
  assertStreamJson(headlessCapture.stdout());
  const headlessTrace = await waitForTrace(installed.data, (candidate) => {
    if (knownBeforeHeadless.has(candidate.id)) return false;
    const metrics = turnMetrics(candidate, 0);
    return metrics.fabricInfoCalls >= 1 && metrics.fabricExecCalls === 1 && metrics.execSucceeded && candidate.events.some((event) => event.ev === "tool.fabric_workspace");
  }, 30_000);
  assertSingleRuntime(headlessTrace);
  const headlessProcess = validateObservedProcess(headlessObserver, headlessTrace, {
    executable,
    requiredArgs: ["chat", selector, "--agent", "kiro-fabric", "--no-interactive", "--require-mcp-startup", "--output-format", "stream-json"],
    expectedKiroPid: headlessChild.pid,
  });
  const headlessIdentity = headlessProcess.identity;
  assertOneObservedMcpProcess(headlessObserver, headlessProcess.kiroPid, "headless Kiro");
  await waitUntilDead(headlessProcess.kiroPid);
  await waitUntilDead(headlessIdentity.pid);
  headlessObserver.release();

  const autoCompactionFinal = runSync(executable, autoCompactionArgv, {
    cwd: workspaceRoot,
    env: authenticatedEnvironment,
    forbiddenValues: [protectedCredential],
  });
  let disableAutoCompactionValueAfter;
  try { disableAutoCompactionValueAfter = JSON.parse(autoCompactionFinal.stdout.toString("utf8")); }
  catch { throw new Error("Kiro did not emit structural final automatic-compaction-setting output"); }
  if (disableAutoCompactionValueAfter !== disableAutoCompactionValue) {
    throw new Error("automatic-compaction setting changed during isolated qualification");
  }

  const afterStats = fs.statSync(executable);
  if (kiroStats.dev !== afterStats.dev || kiroStats.ino !== afterStats.ino || hash(fs.readFileSync(executable)) !== kiroDigest) throw new Error("kiro-cli changed during qualification");
  const finalInstalledProfile = validateInstalledAgentProfile(installed.profile, installedProfileOptions);
  const finalInstalledRuntime = snapshotTree(installed.runtime);
  const finalInstalledSkill = snapshotTree(path.dirname(skillPath));
  if (finalInstalledProfile.sha256 !== installedProfile.sha256 ||
      finalInstalledRuntime.digest !== installedRuntime.digest || finalInstalledRuntime.digest !== releasePackage.runtime.digest ||
      finalInstalledSkill.digest !== installedSkill.digest || finalInstalledSkill.digest !== releasePackage.skill.digest) {
    throw new Error("installed profile, runtime, or skill tree changed during qualification");
  }
  const finalWorkspaceDigest = treeDigest(workspaceRoot);
  if (finalWorkspaceDigest !== workspaceBeforeDigest || fs.readdirSync(workspaceRoot).length !== 0) throw new Error("Kiro Fabric created project-local qualification files");
  const allSessions = traceSessions(installed.data, false);
  const relevantIds = new Set([formTrace.id, interactiveId, resumeTurn.trace.id, headlessTrace.id]);
  if (allSessions.length !== 4 || allSessions.some((entry) => !relevantIds.has(entry.id))) throw new Error("qualification observed an unexpected Fabric MCP startup");
  const interactiveRecording = recordingEvidence(interactiveRecord, [protectedCredential]);
  const resumeRecording = recordingEvidence(resumeRecord, [protectedCredential]);
  const interactiveRecordingFrames = acpFrames(interactiveRecord);
  const preCompactionRecordingFrames = acpFrames(interactiveRecord, 0, compactionRecordingOffset);
  const compactionRecordingFrames = acpFrames(interactiveRecord, compactionRecordingOffset, compactionRecordingEndOffset);
  const resumeRecordingFrames = acpFrames(resumeRecord);
  const finalPostCompactCalls = completedAcpFabricExecCalls(acpFrames(interactiveRecord, postCompactRecordingOffset, postCompactRecordingEndOffset), {
    sessionId: firstPostCompactionSessionId,
    expectedArguments: postCompactArguments,
    expectedResult: postCompactExpectedResult,
  });
  const finalResumeCalls = completedAcpFabricExecCalls(acpFrames(resumeRecord, resumeRecordingOffset), {
    sessionId,
    expectedArguments: resumeArguments,
    expectedResult: resumeExpectedResult,
  });
  if (finalPostCompactCalls.length !== 1 || qualificationValueDigest(finalPostCompactCalls[0]) !== qualificationValueDigest(postCompactAcp.call) ||
      finalResumeCalls.length !== 1 || qualificationValueDigest(finalResumeCalls[0]) !== qualificationValueDigest(resumeAcp.call)) {
    throw new Error("final ACP recordings changed the exact post-compaction or resume fabric_exec evidence");
  }
  const completedCompactions = completedAcpCompactionNotifications(
    compactionRecordingFrames,
    [sessionIdBeforeCompaction, sessionId],
  );
  if (completedCompactions.length !== 1) {
    throw new Error("Kiro ACP recording did not contain exactly one completed _kiro.dev/compaction/status notification inside the manual /compact interval");
  }
  const compactionAcpEvent = completedCompactions[0];
  if (compactionAcpEvent.frameDigest !== compactionInterval.exchange.completedFrameDigest ||
      compactionAcpEvent.sessionId !== compactionInterval.exchange.sessionId) {
    throw new Error("manual /compact ACP event changed outside its captured byte interval");
  }
  const compactionAcpOutput = Buffer.from(`${JSON.stringify({
    ...compactionAcpEvent,
    intervalStartOffset: compactionRecordingOffset,
    intervalEndOffset: compactionRecordingEndOffset,
    manualExchange: compactionInterval.exchange,
  })}\n`);
  const finalizedManualCompactions = manualCompactions.map((cycle) => {
    const frames = acpFrames(interactiveRecord, cycle.gate.intervalStartOffset, cycle.gate.intervalEndOffset);
    const exchanges = completedAcpManualCompactions(frames, cycle.gate.sessionIdBefore);
    const notifications = completedAcpCompactionNotifications(frames, [cycle.gate.sessionIdBefore]);
    if (exchanges.length !== 1 || notifications.length !== 1 ||
        qualificationValueDigest(exchanges[0]) !== qualificationValueDigest(cycle.gate.manualExchange) ||
        notifications[0].frameDigest !== cycle.gate.frameDigest) {
      throw new Error(`manual compaction cycle ${cycle.gate.index} changed in the final ACP recording`);
    }
    return cycle.gate;
  });
  const automaticFrames = acpFrames(
    interactiveRecord,
    automaticCompaction.gate.intervalStartOffset,
    automaticCompaction.gate.intervalEndOffset,
  );
  const finalizedAutomatic = completedAcpAutomaticCompactions(
    automaticFrames,
    automaticCompaction.gate.sessionIdBefore,
    automaticCompaction.pressureMarker,
  );
  const automaticNotifications = completedAcpCompactionNotifications(
    automaticFrames,
    [automaticCompaction.gate.sessionIdBefore],
  );
  if (finalizedAutomatic.length !== 1 || automaticNotifications.length !== 1 ||
      qualificationValueDigest(finalizedAutomatic[0]) !== qualificationValueDigest({
        sessionId: automaticCompaction.gate.sessionId,
        trigger: automaticCompaction.gate.trigger,
        pressureMarkerDigest: automaticCompaction.gate.pressureMarkerDigest,
        promptRequestIdDigest: automaticCompaction.gate.promptRequestIdDigest,
        promptFrameDigest: automaticCompaction.gate.promptFrameDigest,
        startedFrameDigest: automaticCompaction.gate.startedFrameDigest,
        completedFrameDigest: automaticCompaction.gate.completedFrameDigest,
        manualCommandAbsent: automaticCompaction.gate.manualCommandAbsent,
        toolCallsAbsent: automaticCompaction.gate.toolCallsAbsent,
      }) || automaticNotifications[0].frameDigest !== automaticCompaction.gate.frameDigest) {
    throw new Error("automatic compaction changed in the final ACP recording");
  }
  const compactionSeriesSummary = {
    manualCycleCount: finalizedManualCompactions.length,
    automaticCycleCount: 1,
    manual: finalizedManualCompactions,
    automatic: automaticCompaction.gate,
  };
  const compactionSeriesOutput = Buffer.from(`${JSON.stringify(compactionSeriesSummary)}\n`);
  const automaticPressureOutput = Buffer.from(`${JSON.stringify({
    attempts: automaticCompaction.attempts,
    event: automaticCompaction.gate,
  })}\n`);
  const contextSources = acpUserPromptFacts(preCompactionRecordingFrames, sessionIdBeforeCompaction, conversationFact);
  if (contextSources.length !== 1) throw new Error("Kiro ACP recording did not contain exactly one pre-compaction user prompt with the conversational fact");
  const contextSource = contextSources[0];
  const contextSourceOutput = Buffer.from(`${JSON.stringify(contextSource)}\n`);
  const compactedFacts = [{
    kind: "manual",
    cycle: 1,
    source: "kiro-acp-precompact-prompt-to-fabric-exec",
    observed: true,
    factDigest: qualificationValueDigest(conversationFact),
    preCompactionSessionId: sessionIdBeforeCompaction,
    preCompactionPromptFrameDigest: contextSource.frameDigest,
    postCompactionToolCallId: postCompactAcp.call.toolCallId,
    postCompactionArgumentsDigest: postCompactAcp.call.observedArgumentsDigest,
    contextSeedToolCallId: turn3Acp.call.toolCallId,
    factAbsentFromPreCompactionToolData: true,
    durableEffectObserved: durableContains(installed.data, "state", conversationFact),
  }];
  for (const entry of manualVerificationTurns) {
    const cycle = manualCompactions[entry.index - 1];
    if (!cycle) throw new Error(`manual compaction cycle ${entry.index} source boundary is unavailable`);
    const sources = acpUserPromptFacts(
      acpFrames(interactiveRecord, entry.seedRecordingOffset, cycle.gate.intervalStartOffset),
      cycle.gate.sessionIdBefore,
      entry.fact,
    );
    if (sources.length !== 1) {
      throw new Error(`Kiro ACP recording did not contain exactly one conversation-only source for manual compaction cycle ${entry.index}`);
    }
    compactedFacts.push({
      kind: "manual",
      cycle: entry.index,
      source: "kiro-acp-precompact-prompt-to-fabric-exec",
      observed: true,
      factDigest: qualificationValueDigest(entry.fact),
      preCompactionSessionId: cycle.gate.sessionIdBefore,
      preCompactionPromptFrameDigest: sources[0].frameDigest,
      postCompactionToolCallId: entry.acp.call.toolCallId,
      postCompactionArgumentsDigest: entry.acp.call.observedArgumentsDigest,
      contextSeedToolCallId: entry.seedAcp.call.toolCallId,
      factAbsentFromPreCompactionToolData: true,
      durableEffectObserved: durableContains(installed.data, "state", entry.fact),
    });
  }
  const automaticSources = acpUserPromptFacts(
    acpFrames(interactiveRecord, automaticSeedRecordingOffset, automaticCompaction.gate.intervalStartOffset),
    automaticCompaction.gate.sessionIdBefore,
    automaticFact,
  );
  if (automaticSources.length !== 1) {
    throw new Error("Kiro ACP recording did not contain exactly one conversation-only source for natural automatic compaction");
  }
  compactedFacts.push({
    kind: "automatic",
    cycle: 1,
    source: "kiro-acp-precompact-prompt-to-fabric-exec",
    observed: true,
    factDigest: qualificationValueDigest(automaticFact),
    preCompactionSessionId: automaticCompaction.gate.sessionIdBefore,
    preCompactionPromptFrameDigest: automaticSources[0].frameDigest,
    postCompactionToolCallId: automaticAcp.call.toolCallId,
    postCompactionArgumentsDigest: automaticAcp.call.observedArgumentsDigest,
    contextSeedToolCallId: automaticSeedAcp.call.toolCallId,
    factAbsentFromPreCompactionToolData: true,
    durableEffectObserved: durableContains(installed.data, "state", automaticFact),
  });
  const compactedFactsOutput = Buffer.from(`${JSON.stringify(compactedFacts)}\n`);
  const compactionCycleCallSummary = {
    contextSeeds: compactionCycleContextSeeds,
    postCompactions: compactionCycleCalls,
  };
  const compactionCycleCallOutput = Buffer.from(`${JSON.stringify(compactionCycleCallSummary)}\n`);
  const turn3CallOutput = Buffer.from(`${JSON.stringify(turn3Acp.call)}\n`);
  const postCompactCallOutput = Buffer.from(`${JSON.stringify(postCompactAcp.call)}\n`);
  const resumeCallOutput = Buffer.from(`${JSON.stringify(resumeAcp.call)}\n`);
  const acpOriginalUserMessage = acpPriorUserMessageObserved(interactiveRecordingFrames, historyNonce);
  const acpLoadedSession = acpSessionLoadObserved(resumeRecordingFrames, sessionId);
  const acpPriorUserMessage = acpPriorUserMessageObserved(resumeRecordingFrames, historyNonce);
  if (!acpLoadedSession) throw new Error("Kiro ACP resume recording did not contain a direct, successful session/load exchange");

  const evidence = {
    packageDigest,
    archiveDigest,
    commit,
    tools: REAL_CLIENT_TOOLS,
    driver: { digest: driverDigest, version: "repository-driver-v8" },
    kiro: {
      path: executable,
      digest: kiroDigest,
      version: version.combined.toString("utf8").trim().slice(0, 256),
      headlessEngineSelector: selector,
      agentValidateSyntax: validateMode,
    },
    installation: {
      releaseRoot,
      kiroHome: globalRoot,
      profile: installed.profile,
      runtime: installed.runtime,
      data: installed.data,
      nodePath: canonicalNodePath,
      packageDigest: installed.packageDigest,
      profileDigest: installedProfile.sha256,
      runtimeDigest: installedRuntime.digest,
      skillDigest: installedSkill.digest,
      finalProfileDigest: finalInstalledProfile.sha256,
      finalRuntimeDigest: finalInstalledRuntime.digest,
      finalSkillDigest: finalInstalledSkill.digest,
      workspaceBeforeDigest,
      workspaceAfterInstallDigest,
      workspaceProfileAbsent: !containsReleaseProfile(workspaceRoot),
      releaseProfileAbsent: !containsReleaseProfile(releaseRoot),
    },
    qualificationGates: {
      nativeToolVisibility: {
        source: "kiro-tui-/tools",
        command: "/tools",
        observed: true,
        profileTools: REAL_CLIENT_PROFILE_TOOLS,
        nativeTools: visibleNativeTools,
        fabricTools: visibleFabricTools,
        outputDigest: hash(toolsOutput),
      },
      formElicitation: {
        source: "kiro-tui-form",
        observed: true,
        requestCount: form.requests.length,
        responseCount: form.responses.length,
        terminalPromptObserved: true,
        terminalResponseObserved: formResponseOutput.length > 0,
        approved: false,
        failedClosed: form.failed.length === 1 && form.denied.length === 1 && form.writeErrors.length === 1,
        acpStructuralEventObserved: true,
        acpRecordingDigest: formRecording.digest,
        requestOutputDigest: hash(formRequestOutput),
        responseOutputDigest: hash(formResponseOutput),
      },
      compaction: {
        source: "kiro-acp-command-exchange",
        observed: true,
        eventCount: completedCompactions.length,
        method: compactionAcpEvent.method,
        status: compactionAcpEvent.status,
        sessionId: compactionAcpEvent.sessionId,
        frameDigest: compactionAcpEvent.frameDigest,
        acpRecordingDigest: interactiveRecording.digest,
        eventOutputDigest: hash(compactionAcpOutput),
        intervalStartOffset: compactionRecordingOffset,
        intervalEndOffset: compactionRecordingEndOffset,
        manualExchange: compactionInterval.exchange,
      },
      compactionSeries: {
        source: "kiro-acp-repeated-manual-and-natural-automatic",
        observed: true,
        acpRecordingDigest: interactiveRecording.digest,
        eventOutputDigest: hash(compactionSeriesOutput),
        automaticPressureOutputDigest: hash(automaticPressureOutput),
        ...compactionSeriesSummary,
      },
      conversationContinuity: {
        source: "kiro-acp-resume",
        observed: true,
        sessionIdBeforeResume: sessionId,
        sessionIdAfterResume: resumedSessionId,
        acpSessionLoadObserved: acpLoadedSession,
        acpOriginalUserMessageObserved: acpOriginalUserMessage,
        acpPriorUserMessageObserved: acpPriorUserMessage,
        interactiveRecordingDigest: interactiveRecording.digest,
        resumeRecordingDigest: resumeRecording.digest,
        compactedFact: {
          ...compactedFacts[0],
          sourceOutputDigest: hash(contextSourceOutput),
        },
        compactedFacts,
        compactedFactsOutputDigest: hash(compactedFactsOutput),
      },
      fabricExecIntegrity: {
        source: "kiro-acp-session-tool-call",
        observed: true,
        contextSeed: {
          ...turn3Acp.call,
          acpRecordingDigest: interactiveRecording.digest,
          outputDigest: hash(turn3CallOutput),
        },
        postCompaction: {
          ...postCompactAcp.call,
          acpRecordingDigest: interactiveRecording.digest,
          outputDigest: hash(postCompactCallOutput),
        },
        resume: {
          ...resumeAcp.call,
          acpRecordingDigest: resumeRecording.digest,
          outputDigest: hash(resumeCallOutput),
        },
        continuityContextSeeds: compactionCycleContextSeeds.map((call) => ({
          ...call,
          acpRecordingDigest: interactiveRecording.digest,
          outputDigest: hash(compactionCycleCallOutput),
        })),
        continuityChecks: compactionCycleCalls.map((call) => ({
          ...call,
          acpRecordingDigest: interactiveRecording.digest,
          outputDigest: hash(compactionCycleCallOutput),
        })),
        continuityChecksOutputDigest: hash(compactionCycleCallOutput),
      },
    },
    commands: {
      install: { ...commandRecord(process.execPath, [installer, releaseRoot]), resolvedExecutable: canonicalNodePath },
      version: commandRecord(executable, ["--version"]),
      helpAll: commandRecord(executable, ["--help-all"]),
      chatHelp: commandRecord(executable, ["chat", "--help"]),
      agentValidateHelp: commandRecord(executable, ["agent", "validate", "--help"]),
      validationContexts: resolutionRuns.map((run) => ({
        cwd: run.cwd,
        validate: commandRecord(executable, validateArgv),
        list: commandRecord(executable, listArgv),
      })),
      inheritance: commandRecord(executable, inheritanceArgv),
      autoCompaction: commandRecord(executable, autoCompactionArgv),
      autoCompactionFinal: commandRecord(executable, autoCompactionArgv),
      formProbe: commandRecord(executable, interactiveArgv),
      headless: commandRecord(executable, headlessArgv),
      interactive: commandRecord(executable, interactiveArgv),
      resume: commandRecord(executable, resumeArgv),
    },
    lifecycle: {
      sessionId,
      totalMcpStartupCount: allSessions.length,
      formProbe: {
        kiroPid: formProcess.kiroPid,
        mcp: formProcess.identity,
        startupCount: 1,
        requestCount: form.requests.length,
        responseCount: form.responses.length,
        elicitationId: formRequest.elicitationId,
        responseAction: formResponse.action,
        approved: false,
        execFailedClosed: form.failed.length === 1 && form.denied.length === 1 && form.writeErrors.length === 1,
        clientCapabilities: formClientCapabilities,
        observedDescendantPids: formDescendants.map((entry) => entry.pid),
        exited: true,
        noOrphan: true,
        traceDigest: traceDigest(formTrace),
      },
      headless: { kiroPid: headlessChild.pid, mcp: headlessIdentity, startupCount: 1, exited: true, noOrphan: true, traceDigest: traceDigest(headlessTrace) },
      interactive: {
        kiroPid: interactiveKiroPid,
        mcp: interactiveIdentity,
        startupCount: 1,
        clientCapabilities: interactiveClientCapabilities,
        observedDescendantPids: interactiveDescendants.map((entry) => entry.pid),
        turns: [
          turn1.evidence,
          turn2.evidence,
          turn3.evidence,
          postCompact.evidence,
          manualVerification2.seedTurn.evidence,
          manualVerification2.turn.evidence,
          manualVerification3.seedTurn.evidence,
          manualVerification3.turn.evidence,
          automaticSeedTurn.evidence,
          automaticVerification.evidence,
        ],
        compaction: {
          command: "/compact",
          completed: true,
          sessionIdBefore: sessionIdBeforeCompaction,
          sessionIdAfter: firstPostCompactionSessionId,
          sessionIdChanged: sessionIdBeforeCompaction !== firstPostCompactionSessionId,
          mcp: compactIdentity,
        },
        manualCompactions: manualCompactions.map((cycle) => ({
          index: cycle.gate.index,
          command: "/compact",
          completed: true,
          sessionIdBefore: cycle.gate.sessionIdBefore,
          sessionIdAfter: cycle.gate.sessionIdAfter,
          sessionIdChanged: cycle.gate.sessionIdChanged,
          mcp: cycle.mcp,
        })),
        automaticCompaction: {
          trigger: automaticCompaction.gate.trigger,
          completed: true,
          pressureTurns: automaticCompaction.gate.pressureTurns,
          settingMutated: false,
          sessionIdBefore: automaticCompaction.gate.sessionIdBefore,
          sessionIdAfter: automaticCompaction.gate.sessionIdAfter,
          sessionIdChanged: automaticCompaction.gate.sessionIdChanged,
          mcp: automaticCompaction.mcp,
        },
        durableSentinels: { memory: durableMemory, state: durableState },
        ephemeralArtifact: {
          id: artifactId,
          sameProcessReadable: turn2.evidence.execSucceeded && postCompact.evidence.execSucceeded &&
            manualVerificationTurns.every((entry) => entry.turn.evidence.execSucceeded) &&
            automaticVerification.evidence.execSucceeded,
          removedAtShutdown: !lstat(artifactPath),
        },
        exited: true,
        noOrphan: true,
        traceDigest: traceDigest(interactiveFinalTrace),
      },
      resumed: {
        kiroPid: resumeKiroPid,
        mcp: resumeIdentity,
        startupCount: 1,
        sessionId,
        observedDescendantPids: resumeDescendants.map((entry) => entry.pid),
        durableMemoryRestored: durableContains(installed.data, "memory", nonce),
        durableStateRestored: durableContains(installed.data, "state", nonce),
        ephemeralArtifactUnavailable: artifactFailure,
        execSucceeded: resumeMetrics.execSucceeded,
        exited: true,
        noOrphan: true,
        traceDigest: traceDigest(resumeFinalTrace),
      },
    },
    recordings: { formProbe: formRecording, interactive: interactiveRecording, resume: resumeRecording },
    resources: {
      disableInheritingDefaultResources: inheritanceValue,
      defaultResourcesInherited: inheritanceValue !== true,
      disableAutoCompaction: disableAutoCompactionValue,
      disableAutoCompactionAfter: disableAutoCompactionValueAfter,
      autoCompactionEnabled: disableAutoCompactionValue !== true,
      autoCompactionSettingMutated: false,
    },
    workspace: {
      path: workspaceRoot,
      finalDigest: finalWorkspaceDigest,
      forbiddenPathsAbsent: fs.readdirSync(workspaceRoot).length === 0,
      resolutionContextsBeforeDigest: resolutionWorkspaceBeforeDigest,
      resolutionContextsAfterDigest: resolutionWorkspaceAfterDigest,
    },
    transcript: [
      transcriptEntry("archive-installation", installResult.combined),
      transcriptEntry("kiro-version", version.combined),
      transcriptEntry("kiro-help-all", help.combined),
      transcriptEntry("kiro-chat-help", chatHelp.combined),
      transcriptEntry("kiro-agent-validate-help", agentValidateHelp.combined),
      transcriptEntry("agent-validation-workspace", resolutionRuns[0].validation.combined),
      transcriptEntry("agent-list-workspace", resolutionRuns[0].listing.combined),
      transcriptEntry("agent-validation-unrelated", resolutionRuns[1].validation.combined),
      transcriptEntry("agent-list-unrelated", resolutionRuns[1].listing.combined),
      transcriptEntry("agent-validation-nested", resolutionRuns[2].validation.combined),
      transcriptEntry("agent-list-nested", resolutionRuns[2].listing.combined),
      transcriptEntry("resource-inheritance-setting", inheritance.combined),
      transcriptEntry("automatic-compaction-setting", autoCompaction.combined),
      transcriptEntry("form-probe-start", formStartOutput),
      transcriptEntry("form-probe-mcp-startup", JSON.stringify(formRequestTrace.start)),
      transcriptEntry("form-probe-trace-request", JSON.stringify(form.requests[0])),
      transcriptEntry("form-probe-trace-response", JSON.stringify(form.responses[0])),
      transcriptEntry("form-probe-request", formRequestOutput),
      transcriptEntry("form-probe-response", formResponseOutput),
      transcriptEntry("form-probe-shutdown", formShutdownOutput),
      transcriptEntry("interactive-start", interactiveStartOutput),
      transcriptEntry("interactive-tools", toolsOutput),
      transcriptEntry("interactive-mcp-startup", JSON.stringify(turn1.trace.start)),
      transcriptEntry("interactive-turn-1", turn1.output),
      transcriptEntry("interactive-turn-2", turn2.output),
      transcriptEntry("interactive-turn-3", turn3.output),
      transcriptEntry("interactive-context-seed-acp-call", turn3CallOutput),
      transcriptEntry("interactive-session-id", sessionOutput),
      transcriptEntry("interactive-compaction", compactionOutput),
      transcriptEntry("interactive-compaction-acp-event", compactionAcpOutput),
      transcriptEntry("interactive-compaction-series-acp-events", compactionSeriesOutput),
      transcriptEntry("interactive-context-source-acp-event", contextSourceOutput),
      transcriptEntry("interactive-post-compaction-session-id", postCompactSessionOutput),
      transcriptEntry("interactive-post-compaction", postCompact.output),
      transcriptEntry("interactive-post-compaction-acp-call", postCompactCallOutput),
      transcriptEntry("interactive-manual-compaction-2-context-seed", manualVerification2.seedTurn.output),
      transcriptEntry("interactive-manual-compaction-2", manualCompaction2.terminalOutput),
      transcriptEntry("interactive-manual-compaction-2-session-id", manualCompaction2.sessionOutput),
      transcriptEntry("interactive-post-manual-compaction-2", manualVerification2.turn.output),
      transcriptEntry("interactive-manual-compaction-3-context-seed", manualVerification3.seedTurn.output),
      transcriptEntry("interactive-manual-compaction-3", manualCompaction3.terminalOutput),
      transcriptEntry("interactive-manual-compaction-3-session-id", manualCompaction3.sessionOutput),
      transcriptEntry("interactive-post-manual-compaction-3", manualVerification3.turn.output),
      transcriptEntry("interactive-automatic-compaction-context-seed", automaticSeedTurn.output),
      transcriptEntry("interactive-automatic-compaction-pressure", automaticPressureOutput),
      transcriptEntry("interactive-automatic-compaction-session-id", automaticCompaction.sessionOutput),
      transcriptEntry("interactive-post-automatic-compaction", automaticVerification.output),
      transcriptEntry("interactive-compaction-cycle-context-sources", compactedFactsOutput),
      transcriptEntry("interactive-compaction-cycle-acp-calls", compactionCycleCallOutput),
      transcriptEntry("interactive-shutdown", shutdownOutput),
      transcriptEntry("resume-start", resumeStartOutput),
      transcriptEntry("resume-mcp-startup", JSON.stringify(resumeTurn.trace.start)),
      transcriptEntry("resume-session-id", resumedSessionOutput),
      transcriptEntry("resume-turn", resumeTurn.output),
      transcriptEntry("resume-acp-call", resumeCallOutput),
      transcriptEntry("resume-shutdown", resumeShutdownOutput),
      transcriptEntry("headless-selection", headlessCapture.slice()),
      transcriptEntry("automatic-compaction-setting-final", autoCompactionFinal.combined),
    ],
  };
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  if (evidenceBytes.includes(protectedCredential)) throw new Error("qualification evidence contained a protected credential; evidence was suppressed");
  fs.writeFileSync(output, evidenceBytes, { mode: 0o600, flag: "wx" });
};

export const runRealKiroAgentDriver = async (options) => {
  try {
    const result = await runRealKiroAgentDriverImplementation(options);
    await terminateQualificationChildren();
    return result;
  } catch (error) {
    try { await terminateQualificationChildren(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Kiro qualification failed and exact-PID cleanup was incomplete"); }
    throw error;
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = valueAfter(process.argv, "--output");
  const workspace = valueAfter(process.argv, "--workspace");
  const kiroHome = valueAfter(process.argv, "--kiro-home");
  const isolatedHome = valueAfter(process.argv, "--home");
  const installCwd = valueAfter(process.argv, "--install-cwd");
  if (!output || !workspace || !kiroHome || !isolatedHome || !installCwd) throw new Error("--output, --workspace, --kiro-home, --home, and --install-cwd are required");
  const script = fs.readFileSync(fileURLToPath(import.meta.url));
  await runRealKiroAgentDriver({
    packageRoot: path.resolve(valueAfter(process.argv, "--package") ?? ""),
    packageDigest: valueAfter(process.argv, "--package-digest"),
    archiveDigest: valueAfter(process.argv, "--archive-digest"),
    commit: valueAfter(process.argv, "--commit"),
    driverDigest: hash(script),
    output: path.resolve(output),
    workspace: path.resolve(workspace),
    kiroHome: path.resolve(kiroHome),
    isolatedHome: path.resolve(isolatedHome),
    installCwd: path.resolve(installCwd),
  });
}
