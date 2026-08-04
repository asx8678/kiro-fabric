import path from "node:path";
import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdtemp, open, realpath, readFile, rename, rm, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { tmpdir } from "node:os";
import fg from "fast-glob";
import { spawn } from "node:child_process";
import type { FabricConfig } from "./config.js";
import type { AiRunner, NormalizedAiRequest } from "./runners/types.js";
import type { AiRunResult, FabricLiteApi, FileReadResult, GrepMatch, GrepResult, Metrics } from "../types/fabric-lite.js";
export type { AiRunResult, FabricLiteApi, Metrics } from "../types/fabric-lite.js";
import { FabricError } from "./errors.js";
import { parseFramed } from "./runners/parser.js";
import { RequestRedactor } from "./redaction.js";
import { loadPrompt } from "./prompts.js";
import { AiCache, type CacheEntry } from "./cache.js";
import {
  PermissionGate,
  commitRequest,
  headlessPrompter,
  shellRequest,
  networkRequest,
  type ApprovalPrompter,
} from "./permissions.js";

const denied =
  /(^|\/)(\.env(?:\..*)?|\.git|node_modules|dist|build|coverage|secrets?|\.fabric-lite)(\/|$)/i;
const deniedGlobs = [
  "**/.git/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.env*",
  "**/secret/**",
  "**/secrets/**",
  "**/.fabric-lite/**",
];

function relativeSafe(root: string, candidate: string): string {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    denied.test(relative.replaceAll(path.sep, "/"))
  ) {
    throw new FabricError("POLICY_DENIED", `Path is denied: ${candidate}`);
  }
  return absolute;
}

async function safePath(root: string, candidate: string, existing = true): Promise<string> {
  const absolute = relativeSafe(root, candidate);
  try {
    const [actualRoot, actual] = await Promise.all([
      realpath(root),
      realpath(existing ? absolute : path.dirname(absolute)),
    ]);
    const relative = path.relative(actualRoot, actual);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new FabricError("POLICY_DENIED", `Symlink escapes project root: ${candidate}`);
    }
  } catch (error) {
    if (existing || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolute;
}

function normalizedRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).replaceAll(path.sep, "/");
}

function writeAllowPattern(pattern: string): string {
  return pattern.replaceAll("\\", "/").replace(/^\.\//, "");
}

function writeAllowed(relative: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = writeAllowPattern(pattern);
    // Root-wide pattern: allow any project-relative path. Traversal,
    // sensitive denied paths, and symlink escapes are still enforced by
    // safeWritePath before this matcher runs.
    if (normalized === "**") return true;
    return relative === normalized ||
      (normalized.endsWith("/**") && relative.startsWith(`${normalized.slice(0, -3)}/`));
  });
}

async function safeWritePath(
  root: string,
  candidate: string,
  allowWrite: readonly string[],
): Promise<{ absolute: string; relative: string }> {
  const lexical = await safePath(root, candidate, false);
  const actualRoot = await realpath(root);
  let parent: string;
  try {
    parent = await realpath(path.dirname(lexical));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FabricError("POLICY_DENIED", `Write parent does not exist: ${candidate}`);
    }
    throw error;
  }
  const canonical = path.join(parent, path.basename(lexical));
  const relative = normalizedRelative(actualRoot, canonical);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    denied.test(relative) ||
    !writeAllowed(relative, allowWrite)
  ) {
    throw new FabricError("POLICY_DENIED", `Filesystem writes are disabled or canonical path is not allowlisted: ${candidate}`);
  }
  try {
    const info = await lstat(lexical);
    if (info.isSymbolicLink()) {
      throw new FabricError("POLICY_DENIED", `Refusing to follow symlink write target: ${candidate}`);
    }
  } catch (error) {
    if (error instanceof FabricError || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { absolute: canonical, relative };
}

function descriptorPath(fd: number): string | undefined {
  if (process.platform === "linux") return `/proc/self/fd/${fd}`;
  if (["darwin", "freebsd", "openbsd", "netbsd"].includes(process.platform)) return `/dev/fd/${fd}`;
  return undefined;
}

function descriptorChildPath(fd: number, child: string): string | undefined {
  // Linux procfs supports openat-like path traversal through a directory fd.
  // macOS exposes /dev/fd for verification, but does not reliably support
  // appending a child path to that pseudo-symlink; its safe fallback opens
  // without truncation and verifies the resulting target descriptor first.
  return process.platform === "linux" ? `/proc/self/fd/${fd}/${child}` : undefined;
}

async function verifyOpenedWriteTarget(
  handle: Awaited<ReturnType<typeof open>>,
  root: string,
  allowWrite: readonly string[],
  candidate: string,
  openedPath: string,
): Promise<{ relative: string }> {
  const fdPath = descriptorPath(handle.fd);
  let canonical: string;
  try {
    // /dev/fd on macOS is useful for identifying the descriptor but does not
    // resolve to the underlying path, so verify its stable inode against the
    // canonical path opened without truncation.
    canonical = process.platform === "darwin"
      ? await realpath(openedPath)
      : fdPath
        ? await realpath(fdPath)
        : await realpath(openedPath);
    const opened = await handle.stat();
    const canonicalInfo = await lstat(canonical);
    if (opened.dev !== canonicalInfo.dev || opened.ino !== canonicalInfo.ino) {
      throw new FabricError("POLICY_DENIED", `Opened write target changed during verification: ${candidate}`);
    }
  } catch (error) {
    if (error instanceof FabricError) throw error;
    throw new FabricError("POLICY_DENIED", `Unable to verify opened write target: ${candidate}`);
  }
  const actualRoot = await realpath(root);
  const relative = normalizedRelative(actualRoot, canonical);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    denied.test(relative) ||
    !writeAllowed(relative, allowWrite)
  ) {
    throw new FabricError("POLICY_DENIED", `Opened write target is outside the canonical allowlist: ${candidate}`);
  }
  const info = await handle.stat();
  if (!info.isFile()) {
    throw new FabricError("POLICY_DENIED", `Write target is not a regular file: ${candidate}`);
  }
  return { relative };
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  return text.length <= max
    ? { text, truncated: false }
    : { text: text.slice(0, max), truncated: true };
}

function textContent(buffer: Buffer, label: string): string {
  if (buffer.includes(0)) {
    throw new FabricError("POLICY_DENIED", `Binary file denied: ${label}`);
  }
  return buffer.toString("utf8");
}



async function scanGrepFile(
  filePath: string,
  relativePath: string,
  regex: RegExp,
  contextLines: number,
  matches: GrepMatch[],
  maxMatches: number,
): Promise<boolean> {
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let lineNumber = 1;
  let sawLine = false;
  let endedWithNewline = false;
  const previous: string[] = [];
  const waiting: Array<{ match: GrepMatch; remaining: number }> = [];
  let foundMatches = 0;
  let limitHit = false;
  const consume = (line: string): void => {
    if (line.includes("\0")) throw new FabricError("POLICY_DENIED", `Binary file denied: ${relativePath}`);
    for (let index = waiting.length - 1; index >= 0; index--) {
      const item = waiting[index]!;
      item.match.after.push(line);
      item.remaining--;
      if (item.remaining === 0) {
        waiting.splice(index, 1);
        matches.push(item.match);
      }
    }
    if (regex.test(line)) {
      foundMatches++;
      if (foundMatches > maxMatches) {
        limitHit = true;
      } else {
        const match: GrepMatch = {
          path: relativePath,
          line: lineNumber,
          text: line,
          before: previous.slice(-contextLines),
          after: [],
        };
        if (contextLines === 0) matches.push(match);
        else waiting.push({ match, remaining: contextLines });
      }
    }
    if (contextLines > 0) previous.push(line);
    if (previous.length > contextLines) previous.shift();
    lineNumber++;
    sawLine = true;
  };
  try {
    for await (const chunk of stream) {
      const text = decoder.write(chunk as Buffer);
      if (text.includes("\0")) throw new FabricError("POLICY_DENIED", `Binary file denied: ${relativePath}`);
      pending += text;
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        consume(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        endedWithNewline = true;
      }
      if (pending.length > 0) endedWithNewline = false;
    }
    pending += decoder.end();
    if (pending.length > 0 || !sawLine || endedWithNewline) consume(pending);
    for (const item of waiting) matches.push(item.match);
  } finally {
    stream.destroy();
  }
  return limitHit;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

async function command(
  argv: string[],
  cwd: string,
  timeoutMs = 30000,
  env?: NodeJS.ProcessEnv,
  maxChars = 100_000,
  stdin?: string | Buffer,
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const add = (which: "stdout" | "stderr", chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      const current = which === "stdout" ? stdout : stderr;
      const left = Math.max(0, maxChars - current.length);
      if (which === "stdout") {
        stdout += text.slice(0, left);
        stdoutTruncated ||= text.length > left;
      } else {
        stderr += text.slice(0, left);
        stderrTruncated ||= text.length > left;
      }
    };
    if (stdin !== undefined) child.stdin!.end(stdin);
    child.stdout!.on("data", (chunk: Buffer) => add("stdout", chunk));
    child.stderr!.on("data", (chunk: Buffer) => add("stderr", chunk));
    const kill = (): void => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // The process may already have exited.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, stdoutTruncated, stderrTruncated });
    });
  });
}

export type AiResult<T = unknown> = AiRunResult<T>;

type MutationMode = "clean" | "checkpoint";
interface MutationSession {
  checkpointId: string;
  checkpointRef?: string;
  baseHead: string;
  mode: MutationMode;
  label?: string;
  createdFiles: Set<string>;
  modifiedFiles: Set<string>;
}

/**
 * Structural token estimate, matching pi-core's estimateTokens heuristic
 * (conservative ceil(chars / 4)). Used only when a runner does not report
 * real usage, exactly like pi-fabric's fallback.
 */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

class BudgetState {
  readonly metrics: Metrics = {
    aiCalls: 0,
    workerCalls: 0,
    retries: 0,
    inputChars: 0,
    outputChars: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheHits: 0,
  };
  private roles = { planner: 0, worker: 0, verifier: 0, general: 0 };

  constructor(private readonly config: FabricConfig) {}

  reserve(role: keyof BudgetState["roles"], input: number, retry = false): void {
    const budgets = this.config.budgets;
    if (this.metrics.aiCalls + 1 > budgets.maxAiCalls) {
      throw new FabricError("BUDGET_EXCEEDED", `AI call limit ${budgets.maxAiCalls} exceeded`);
    }
    if (input > budgets.maxPromptCharsPerCall) {
      throw new FabricError(
        "BUDGET_EXCEEDED",
        `AI prompt character budget exceeded (${input} > ${budgets.maxPromptCharsPerCall})`,
      );
    }
    // pi-fabric semantics: the token budget is a spent-based guard checked
    // before each call; usage settles after the call completes, so the check
    // is best-effort and the race-free ceiling is the call-count cap above.
    if (budgets.maxTotalTokens > 0 && this.metrics.totalTokens >= budgets.maxTotalTokens) {
      throw new FabricError(
        "BUDGET_EXCEEDED",
        `AI token budget exhausted (spent ${this.metrics.totalTokens} of ${budgets.maxTotalTokens})`,
      );
    }
    const limits = {
      planner: budgets.maxPlannerCalls,
      worker: budgets.maxWorkerCalls,
      verifier: budgets.maxVerifierCalls,
      general: budgets.maxWorkerCalls,
    };
    if (!retry && this.roles[role] + 1 > limits[role]) {
      throw new FabricError("BUDGET_EXCEEDED", `${role} call limit ${limits[role]} exceeded`);
    }
    this.metrics.aiCalls++;
    if (!retry) {
      this.roles[role]++;
      if (role === "worker" || role === "general") this.metrics.workerCalls++;
    } else {
      this.metrics.retries++;
    }
  }

  cacheHit(): void {
    this.metrics.cacheHits++;
  }

  /**
   * Record usage after a call settles, matching pi-fabric's
   * append-after-completion accounting. Real runner usage is preferred;
   * otherwise tokens are estimated as ceil(chars / 4). Never throws: like
   * pi-fabric, a single call may overshoot and the next reserve() guards.
   */
  settle(inputChars: number, outputChars: number, usage?: { input: number; output: number }): void {
    this.metrics.inputChars += inputChars;
    this.metrics.outputChars += outputChars;
    const inputTokens = usage ? usage.input : estimateTokens(inputChars);
    const outputTokens = usage ? usage.output : estimateTokens(outputChars);
    this.metrics.inputTokens += inputTokens;
    this.metrics.outputTokens += outputTokens;
    this.metrics.totalTokens += inputTokens + outputTokens;
  }
}

type ArgumentRecord = Record<string, unknown>;

function invalidArguments(ref: string, expected: string): never {
  throw new FabricError("RUNTIME_FAILED", `Invalid arguments for ${ref}: ${expected}`);
}

function isArgumentRecord(value: unknown): value is ArgumentRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function argumentRecord(ref: string, value: unknown): ArgumentRecord {
  if (!isArgumentRecord(value)) invalidArguments(ref, "expected an options object");
  return value;
}

function aliasedArguments(value: ArgumentRecord, aliases: Record<string, string>): ArgumentRecord {
  const result = { ...value };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (alias in result) {
      if (!(canonical in result)) result[canonical] = result[alias];
      delete result[alias];
    }
  }
  return result;
}

function requiredString(ref: string, value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) invalidArguments(ref, `${name} must be a non-empty string`);
  return value;
}

function optionalNumber(ref: string, value: unknown, name: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) invalidArguments(ref, `${name} must be a finite number`);
}

function positionalArguments(ref: string, args: readonly unknown[], fields: readonly string[]): ArgumentRecord {
  if (args.length === 1 && typeof args[0] === "string") return { [fields[0]!]: args[0] };
  if (args.length === 1) return argumentRecord(ref, args[0]);
  if (args.length === 0 || args.length > fields.length) invalidArguments(ref, `expected an options object or ${fields.length} positional arguments`);
  const result: ArgumentRecord = {};
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value !== undefined) result[fields[index]!] = value;
  }
  return result;
}

export function createApi(
  config: FabricConfig,
  runner: AiRunner,
  gateOptions?: { prompter?: ApprovalPrompter },
): { fabric: FabricLiteApi; metrics: Metrics } {
 const root=path.resolve(config.projectRoot); const budgets=new BudgetState(config); const cache=new AiCache(root,config);
 const gate=new PermissionGate({
   policy:config.permissions,
   prompter:gateOptions?.prompter ?? headlessPrompter,
   allowedCommands:config.shell.allowedCommands,
   projectRoot: root,
 });
 let mutationSession: MutationSession | undefined;
 const mutationWriteRequired = (): MutationSession => {
   if (config.mutation.enabled && !mutationSession) {
     throw new FabricError("POLICY_DENIED", "Mutation writes require fabric.mutate.begin first");
   }
   if (!mutationSession) throw new FabricError("RUNTIME_FAILED", "No active mutation session");
   return mutationSession;
 };
 const recordMutationWrite = (session: MutationSession, target: { absolute: string; relative: string }, existed: boolean): void => {
   // The caller records only after the write succeeds; existed is the state
   // before the first successful write to this path during this session.
   if (!session.createdFiles.has(target.relative) && !session.modifiedFiles.has(target.relative)) {
     (existed ? session.modifiedFiles : session.createdFiles).add(target.relative);
   }
 };
 const fsApi: FabricLiteApi["fs"] = {
  async read(...args: unknown[]) {
   const rawInput = positionalArguments("fabric.fs.read", args, ["path"]);
   const input = aliasedArguments(rawInput, { file: "path", start: "startLine", max: "maxChars" });
   optionalNumber("fabric.fs.read", input.offset, "offset"); optionalNumber("fabric.fs.read", input.limit, "limit"); optionalNumber("fabric.fs.read", input.startLine, "startLine"); optionalNumber("fabric.fs.read", input.endLine, "endLine"); optionalNumber("fabric.fs.read", input.maxChars, "maxChars");
   if (input.offset !== undefined && input.startLine === undefined) input.startLine = input.offset;
   if (input.limit !== undefined && input.endLine === undefined && typeof input.startLine === "number") input.endLine = input.startLine + Number(input.limit) - 1;
   const filePath = requiredString("fabric.fs.read", input.path, "path");
   const p = await safePath(root, filePath);
   const raw = textContent(await readFile(p), filePath);
   const lines = raw.split("\n"), start = Math.max(1, Number(input.startLine ?? 1)), end = Math.min(lines.length, Number(input.endLine ?? lines.length));
   const selected = lines.slice(start - 1, end).join("\n"), t = truncate(selected, Math.min(Number(input.maxChars ?? config.filesystem.maxCharsPerFile), config.filesystem.maxCharsPerFile));
   return { path: path.relative(root, p), content: t.text, chars: t.text.length, truncated: t.truncated, startLine: start, endLine: start + t.text.split("\n").length - 1 };
  },
  async readMany(input: unknown) {
   const value = argumentRecord("fabric.fs.readMany", input);
   if (!Array.isArray(value.paths) || value.paths.some((item) => typeof item !== "string")) invalidArguments("fabric.fs.readMany", "paths must be an array of strings");
   const paths = value.paths as string[], maxFiles = Math.min(Number(value.maxFiles ?? config.filesystem.maxFilesPerReadMany), config.filesystem.maxFilesPerReadMany);
   if (paths.length > maxFiles) throw new FabricError("BUDGET_EXCEEDED", `readMany file limit ${maxFiles} exceeded`);
   const out: FileReadResult[] = [], totalLimit = Math.min(Number(value.maxTotalChars ?? config.filesystem.maxTotalReadChars), config.filesystem.maxTotalReadChars);
   let total = 0;
   for (const filePath of paths) {
    const result = await fsApi.read({ path: filePath, maxChars: Number(value.maxCharsPerFile ?? config.filesystem.maxCharsPerFile) });
    if (total + result.chars > totalLimit) { const left = Math.max(0, totalLimit - total); out.push({ ...result, content: result.content.slice(0, left), chars: left, truncated: true }); break; }
    out.push(result); total += result.chars;
   }
   return out;
  },
  async glob(...args: unknown[]) { const rawInput = positionalArguments("fabric.fs.glob", args, ["pattern", "cwd", "maxResults"]); const input = aliasedArguments(rawInput, { query: "pattern", search: "pattern", regex: "pattern", path: "cwd", limit: "maxResults", max: "maxResults" }) as { pattern?: string; cwd?: string; maxResults?: number; ignore?: string[] }; const pattern = requiredString("fabric.fs.glob", input.pattern, "pattern"); if(input.cwd !== undefined && typeof input.cwd !== "string") invalidArguments("fabric.fs.glob", "cwd must be a string"); optionalNumber("fabric.fs.glob", input.maxResults, "maxResults"); if(path.posix.isAbsolute(pattern)||path.win32.isAbsolute(pattern)||/^(?:[A-Za-z]:|[\\\\])/.test(pattern)||/(^|[\\\\/])\.\.([\\\\/]|$)/.test(pattern)) throw new FabricError("POLICY_DENIED","Glob patterns must be relative and cannot contain parent traversal"); const requestedCwd=await safePath(root,input.cwd??"."); const cwd=await realpath(requestedCwd); const cwdInfo=await lstat(cwd);if(!cwdInfo.isDirectory())throw new FabricError("POLICY_DENIED","Glob cwd must be a directory"); const canonicalRoot=await realpath(root); const max=Math.min(input.maxResults??1000,5000); const values=await fg(pattern,{cwd,onlyFiles:true,dot:false,followSymbolicLinks:false,ignore:[...deniedGlobs,...(input.ignore??[])]}); const results:string[]=[]; for(const value of values.sort().slice(0,max)){const candidate=path.resolve(cwd,value);let canonical:string;try{canonical=await realpath(candidate);}catch{throw new FabricError("POLICY_DENIED","Unable to verify glob result");}const relative=normalizedRelative(canonicalRoot,canonical);if(relative.startsWith("..")||path.isAbsolute(relative)||denied.test(relative)) throw new FabricError("POLICY_DENIED","Glob result escaped project root");results.push(relative);} return results; },
  async grep(...args: unknown[]): Promise<GrepResult> {
    const rawInput = positionalArguments("fabric.fs.grep", args, ["query", "path", "maxMatches"]);
    const input = aliasedArguments(rawInput, {
      pattern: "query", regex: "query", search: "query", globPattern: "glob",
      limit: "maxMatches", max: "maxMatches", context: "contextLines", ctx: "contextLines",
      ic: "ignoreCase", caseInsensitive: "ignoreCase",
    }) as {
      query?: string; paths?: string[] | string; path?: string; glob?: string;
      maxMatches?: number; contextLines?: number; ignoreCase?: boolean; literal?: boolean;
    };
    if (typeof input.paths === "string") input.paths = [input.paths];
    if (input.path && !input.paths) input.paths = [input.path];
    const query = requiredString("fabric.fs.grep", input.query, "query");
    if (input.paths !== undefined && (!Array.isArray(input.paths) || input.paths.some((item) => typeof item !== "string"))) {
      invalidArguments("fabric.fs.grep", "paths must be an array of strings");
    }
    if (input.glob !== undefined && typeof input.glob !== "string") invalidArguments("fabric.fs.grep", "glob must be a string");
    optionalNumber("fabric.fs.grep", input.maxMatches, "maxMatches");
    optionalNumber("fabric.fs.grep", input.contextLines, "contextLines");
    let regex: RegExp;
    try {
      const expression = input.literal ? query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : query;
      regex = new RegExp(expression, input.ignoreCase === false ? "" : "i");
    } catch {
      throw new FabricError("POLICY_DENIED", "Invalid grep regular expression");
    }
    const files = input.paths ?? await fsApi.glob({ pattern: input.glob ?? "**/*", maxResults: 2000 });
    const maxMatches = Math.min(Math.max(Math.floor(input.maxMatches ?? 200), 1), 1000);
    const contextLines = Math.min(Math.max(Math.floor(input.contextLines ?? 0), 0), 10);
    const matches: GrepMatch[] = [];
    const scannedFiles: string[] = [];
    const skippedFiles: string[] = [];
    let limitHit = false;
    for (const file of files) {
      try {
        const resolved = await safePath(root, file);
        const info = await lstat(resolved);
        if (!info.isFile()) throw new FabricError("POLICY_DENIED", `Grep source is not a file: ${file}`);
        limitHit ||= await scanGrepFile(resolved, file, regex, contextLines, matches, maxMatches);
        scannedFiles.push(file);
      } catch {
        skippedFiles.push(file);
      }
    }
    return {
      matches,
      files: [...new Set(matches.map((match) => match.path))],
      truncated: limitHit || skippedFiles.length > 0,
      scannedFiles: [...new Set(scannedFiles)],
      skippedFiles: [...new Set(skippedFiles)],
    };
  },
  async stat(...args: unknown[]) { const input = positionalArguments("fabric.fs.stat", args, ["path"]); const filePath = requiredString("fabric.fs.stat", input.path, "path"); const p = await safePath(root, filePath), s = await lstat(p); return { path: path.relative(root, p), type: (s.isDirectory() ? "directory" : "file") as "directory" | "file", size: s.size, modifiedMs: s.mtimeMs }; },
  async write(...args: unknown[]) { const input = aliasedArguments(positionalArguments("fabric.fs.write", args, ["path", "content"]), { file: "path", contents: "content", body: "content", text: "content" }) as { path: string; content: string }; requiredString("fabric.fs.write", input.path, "path"); requiredString("fabric.fs.write", input.content, "content"); const session=config.mutation.enabled?mutationWriteRequired():mutationSession; const target=await safeWritePath(root,input.path,config.filesystem.allowWrite);let existed=false;if(session){try{await lstat(target.absolute);existed=true;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}let parentHandle:Awaited<ReturnType<typeof open>>|undefined;let handle:Awaited<ReturnType<typeof open>>|undefined;try{const noFollow=fsConstants.O_NOFOLLOW;const directory=fsConstants.O_DIRECTORY;const parentFdPath=descriptorPath(0);if(noFollow===undefined||directory===undefined||!parentFdPath)throw new FabricError("POLICY_DENIED",`Platform cannot establish a safe write primitive: ${input.path}`);parentHandle=await open(path.dirname(target.absolute),fsConstants.O_RDONLY|directory|noFollow);const targetFromParent=descriptorChildPath(parentHandle.fd,path.basename(target.absolute));handle=await open(targetFromParent??target.absolute,fsConstants.O_WRONLY|fsConstants.O_CREAT|noFollow,0o666);const verified=await verifyOpenedWriteTarget(handle,root,config.filesystem.allowWrite,input.path,target.absolute);await handle.truncate(0);await handle.writeFile(input.content,"utf8");if(session)recordMutationWrite(session,{absolute:target.absolute,relative:verified.relative},existed);return{path:verified.relative,bytesWritten:Buffer.byteLength(input.content)};}catch(error){const code=(error as NodeJS.ErrnoException).code;if(code==="ELOOP"||code==="ENXIO") throw new FabricError("POLICY_DENIED",`Refusing unsafe symlink write target: ${input.path}`);throw error;}finally{await handle?.close().catch(()=>undefined);await parentHandle?.close().catch(()=>undefined);}},
  async patch(...args: unknown[]) { const input = positionalArguments("fabric.fs.patch", args, ["path", "patch"]) as { path: string; patch: string }; requiredString("fabric.fs.patch", input.path, "path"); requiredString("fabric.fs.patch", input.patch, "patch"); if(config.mutation.enabled) mutationWriteRequired(); const read=await fsApi.read({path:input.path,maxChars:config.filesystem.maxCharsPerFile});if(read.truncated)throw new FabricError("BUDGET_EXCEEDED","Refusing to patch a truncated file");const current=read.content; let spec:{old:string;new:string};try{spec=JSON.parse(input.patch) as {old:string;new:string};}catch{throw new FabricError("POLICY_DENIED",'patch must be JSON: {"old":"exact text","new":"replacement"}');}if(typeof spec.old!=="string"||typeof spec.new!=="string"||!current.includes(spec.old))throw new FabricError("POLICY_DENIED","Patch old text not found");await fsApi.write({path:input.path,content:current.replace(spec.old,spec.new)});return{path:input.path,applied:true};}
 };
 const git: FabricLiteApi["git"] = {
  async status(){const r=await command(["git","status","--porcelain=v1","--branch"],root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());const lines=r.stdout.trimEnd().split("\n"),head=lines.shift()??"";return{branch:head.match(/^## ([^. ]+)/)?.[1]??null,clean:lines.length===0,entries:lines};},
  async changedFiles(input:{base?:string;includeUntracked?:boolean}={}){const base=input.base??"HEAD";if(base.startsWith("-")||!/^[A-Za-z0-9._\/~^{}-]+$/.test(base))throw new FabricError("POLICY_DENIED","Invalid Git base");const args=["git","diff","--name-only",base,"--"];const r=await command(args,root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());const files=r.stdout.trim().split("\n").filter(Boolean);if(input.includeUntracked){const u=await command(["git","ls-files","--others","--exclude-standard"],root);files.push(...u.stdout.trim().split("\n").filter(Boolean));}return[...new Set(files)].filter(x=>!denied.test(x));},
  async diff(input:{base?:string;paths?:string[];maxChars?:number}={}){for(const p of input.paths??[])relativeSafe(root,p);const base=input.base??"HEAD";if(base.startsWith("-")||!/^[A-Za-z0-9._\/~^{}-]+$/.test(base))throw new FabricError("POLICY_DENIED","Invalid Git base");const r=await command(["git","diff",base,"--",...(input.paths??[])],root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());const t=truncate(r.stdout,input.maxChars??30000);return{diff:t.text,truncated:t.truncated};},
  async log(input:{maxCount?:number;ref?:string}={}){const max=Math.min(Math.max(input.maxCount??20,1),100);const ref=input.ref??"HEAD";if(ref.startsWith("-")||!/^[A-Za-z0-9._\/~^{}-]+$/.test(ref))throw new FabricError("POLICY_DENIED","Invalid Git ref");const r=await command(["git","--no-pager","log",`--max-count=${max}`,"--date=iso-strict","--format=%H%x09%ad%x09%an%x09%s",ref],root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());const t=truncate(r.stdout,30000);return{text:t.text,truncated:t.truncated};},
  async show(input:{ref?:string;path?:string;maxChars?:number}={}){const ref=input.ref??"HEAD";if(ref.startsWith("-")||!/^[A-Za-z0-9._\/~^{}-]+$/.test(ref))throw new FabricError("POLICY_DENIED","Invalid Git ref");let spec=ref;if(input.path){const absolute=relativeSafe(root,input.path);const relative=path.relative(root,absolute).replaceAll(path.sep,"/");if(!relative)throw new FabricError("POLICY_DENIED","Invalid Git path");spec=`${ref}:${relative}`;}const r=await command(["git","--no-pager","show","--no-ext-diff","--no-textconv",spec],root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());const t=truncate(r.stdout,Math.min(input.maxChars??30000,30000));return{text:t.text,truncated:t.truncated};},
  async branches(){const r=await command(["git","for-each-ref","--format=%(refname:short)%09%(objectname)%09%(upstream:short)","refs/heads","refs/remotes"],root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());return r.stdout.trim().split("\n").filter(Boolean);},
  async remotes(){const r=await command(["git","remote","-v"],root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());return r.stdout.trim().split("\n").filter(Boolean);},
  async commit(input:{message:string;paths:string[]}){
   if(!config.git.allowCommit)throw new FabricError("POLICY_DENIED","Local Git commits are disabled by project policy");
   if(typeof input?.message!=="string"||input.message.trim()!==input.message||input.message.length<1||input.message.length>200||/[\u0000-\u001f\u007f]/.test(input.message))throw new FabricError("POLICY_DENIED","Commit message must be one trimmed line of 1-200 safe characters");
   if(!Array.isArray(input.paths)||input.paths.length===0||input.paths.some(candidate=>typeof candidate!=="string"||candidate.length===0))throw new FabricError("POLICY_DENIED","Commit requires non-empty explicit paths");
   const repo=await command(["git","rev-parse","--show-toplevel"],root);if(repo.code!==0)throw new FabricError("RUNTIME_FAILED",repo.stderr.trim()||"Not a Git repository");
   if(await realpath(repo.stdout.trim())!==await realpath(root))throw new FabricError("POLICY_DENIED","Git repository root must equal the Fabric project root");
   const repository=await realpath(root);
   const stagedBefore=await command(["git","diff","--cached","--name-only"],root);if(stagedBefore.code!==0)throw new FabricError("RUNTIME_FAILED",stagedBefore.stderr.trim());if(stagedBefore.stdout.trim())throw new FabricError("POLICY_DENIED","Refusing to commit with pre-existing staged changes");
   const paths:string[]=[];const entries:Array<{relative:string;absolute:string;mode:string}|{relative:string;deleted:true}>=[];
   for(const candidate of input.paths){
    const absolute=relativeSafe(root,candidate);const relative=path.relative(root,absolute).replaceAll(path.sep,"/");if(!relative||relative===".")throw new FabricError("POLICY_DENIED",`Path is denied: ${candidate}`);
    try{const info=await lstat(absolute);if(!info.isFile())throw new FabricError("POLICY_DENIED",`Commit paths must name regular files: ${candidate}`);const checked=await safePath(root,candidate);const canonical=await realpath(checked);const canonicalRelative=path.relative(repository,canonical).replaceAll(path.sep,"/");entries.push({relative:canonicalRelative,absolute:canonical,mode:(info.mode&0o111)!==0?"100755":"100644"});}catch(error){if(error instanceof FabricError)throw error;if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;const tracked=await command(["git","ls-files","--error-unmatch","--",relative],root);if(tracked.code!==0)throw new FabricError("POLICY_DENIED",`Commit path does not exist and is not a tracked deletion: ${candidate}`);entries.push({relative,deleted:true});}
    paths.push(relative);
   }
   const canonicalPaths=[...new Set(entries.map((entry)=>"absolute" in entry?entry.absolute:path.join(repository,entry.relative)))];
   if(!(await gate.authorize(commitRequest(input.message,repository,canonicalPaths))))throw new FabricError("POLICY_DENIED","Local Git commit was not approved");
   const unique=[...new Set(paths)];
   const temporaryDirectory=await mkdtemp(path.join(tmpdir(),"fabric-index-"));
   const temporaryIndex=path.join(temporaryDirectory,"index");
   const indexEnv:NodeJS.ProcessEnv={...process.env,GIT_INDEX_FILE:temporaryIndex};
   try {
    const initialized=await command(["git","read-tree","HEAD"],root,30000,indexEnv);if(initialized.code!==0)throw new FabricError("RUNTIME_FAILED",initialized.stderr.trim()||"Git temporary index initialization failed");
    for(const entry of entries.filter((value,index)=>paths.indexOf(value.relative)===index)){
     if("deleted" in entry){const removed=await command(["git","-c","core.fsmonitor=false","update-index","--force-remove","--",entry.relative],root,30000,indexEnv);if(removed.code!==0)throw new FabricError("RUNTIME_FAILED",removed.stderr.trim()||"Git index deletion failed");continue;}
     const content=await readFile(entry.absolute);if(content.length>config.filesystem.maxCharsPerFile)throw new FabricError("BUDGET_EXCEEDED",`Commit file exceeds ${config.filesystem.maxCharsPerFile} bytes: ${entry.relative}`);const hashed=await command(["git","hash-object","-w","--stdin"],root,30000,undefined,100000,content);if(hashed.code!==0||!/^[0-9a-f]{40}$/.test(hashed.stdout.trim()))throw new FabricError("RUNTIME_FAILED",hashed.stderr.trim()||"Git object hashing failed");
     const stagedEntry=await command(["git","-c","core.fsmonitor=false","update-index","--add","--cacheinfo",`${entry.mode},${hashed.stdout.trim()},${entry.relative}`],root,30000,indexEnv);if(stagedEntry.code!==0)throw new FabricError("RUNTIME_FAILED",stagedEntry.stderr.trim()||"Git index update failed");
    }
    const staged=await command(["git","diff","--cached","--name-only"],root,30000,indexEnv);if(staged.code!==0)throw new FabricError("RUNTIME_FAILED",staged.stderr.trim());const committedPaths=staged.stdout.trim().split("\n").filter(Boolean);if(committedPaths.length===0)throw new FabricError("RUNTIME_FAILED","Explicit paths contain no changes to commit");if(committedPaths.some(file=>!unique.includes(file)))throw new FabricError("POLICY_DENIED","Git staged a path outside the explicit commit set");
    const [oldHead,branch,tree]=await Promise.all([command(["git","rev-parse","HEAD"],root),command(["git","symbolic-ref","--quiet","--short","HEAD"],root),command(["git","-c","core.fsmonitor=false","write-tree"],root,30000,indexEnv)]);if(oldHead.code!==0||tree.code!==0)throw new FabricError("RUNTIME_FAILED",oldHead.stderr.trim()||tree.stderr.trim());if(branch.code!==0||!branch.stdout.trim())throw new FabricError("POLICY_DENIED","Local commits require an attached branch");
    const created=await command(["git","-c","commit.gpgSign=false","commit-tree",tree.stdout.trim(),"-p",oldHead.stdout.trim()],root,30000,undefined,100000,`${input.message}\n`);if(created.code!==0||!/^[0-9a-f]{40}$/.test(created.stdout.trim()))throw new FabricError("RUNTIME_FAILED",created.stderr.trim()||"Git commit object creation failed");
    // Build the post-commit index before moving the branch. The real index is
    // untouched until this succeeds, and replacing it atomically avoids
    // staging unrelated worktree changes or exposing a partial index.
    const indexPathResult=await command(["git","rev-parse","--git-path","index"],root);if(indexPathResult.code!==0||!indexPathResult.stdout.trim())throw new FabricError("RUNTIME_FAILED",indexPathResult.stderr.trim()||"Git index path lookup failed");const realIndex=path.resolve(root,indexPathResult.stdout.trim());const syncDirectory=await mkdtemp(path.join(path.dirname(realIndex),".fabric-index-sync-"));const syncIndex=path.join(syncDirectory,"index");try{const synchronized=await command(["git","read-tree",created.stdout.trim()],root,30000,{...indexEnv,GIT_INDEX_FILE:syncIndex});if(synchronized.code!==0)throw new FabricError("RUNTIME_FAILED",synchronized.stderr.trim()||"Git index synchronization failed");
     const ref=`refs/heads/${branch.stdout.trim()}`;const updated=await command(["git","update-ref",ref,created.stdout.trim(),oldHead.stdout.trim()],root);if(updated.code!==0)throw new FabricError("RUNTIME_FAILED",updated.stderr.trim()||"Git branch update failed");await rename(syncIndex,realIndex);
    } finally { await rm(syncDirectory,{recursive:true,force:true}); }
    return{hash:created.stdout.trim(),branch:branch.stdout.trim(),message:input.message,paths:committedPaths};
   } finally { await rm(temporaryDirectory,{recursive:true,force:true}); }
  }
 };
const inspectionResult=(tool:string,operation:string,result:CommandResult)=>{if(result.code!==0)throw new FabricError("RUNTIME_FAILED",result.stderr.trim()||`${tool} ${operation} failed`);return{tool,operation,stdout:result.stdout,stderr:result.stderr,exitCode:result.code,truncated:result.stdoutTruncated||result.stderrTruncated};};
 const safeToken=(value:string|undefined,label:string,pattern=/^[A-Za-z0-9._\/:@-]+$/):string|undefined=>{if(value===undefined)return undefined;if(value.startsWith("-")||!pattern.test(value))throw new FabricError("POLICY_DENIED",`Invalid ${label}`);return value;};
 const readQuery=(query:string,dialect:"postgres"|"sqlite"):string=>{if(typeof query!=="string"||query.length>12000)throw new FabricError("POLICY_DENIED",`${dialect} query exceeds bounds`);const text=query.trim().replace(/;$/,"").trim();if(!text||text.includes(";")||text.includes("\\")||/--|\/\*/.test(text))throw new FabricError("POLICY_DENIED",`${dialect} inspection requires one comment-free statement`);if(!/^(select|with|table|values|show|explain(?:\s+query\s+plan)?)(\s|$)/i.test(text))throw new FabricError("POLICY_DENIED",`${dialect} inspection permits SELECT and read-only inspection statements only`);if(/\b(insert|update|delete|merge|copy|call|do|create|alter|drop|truncate|grant|revoke|vacuum|analyze|reindex|cluster|refresh|lock|listen|notify|set|reset|attach|detach|replace|upsert)\b/i.test(text)||/\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i.test(text)||/\bselect\s+.*\binto\b/is.test(text)||/\b(pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_log_backend_memory_contexts|pg_advisory|dblink|lo_import|lo_export|pg_read_file|pg_write_file|pg_ls_dir|pg_stat_file|pg_notify)\s*\(/i.test(text)||/^explain\s+(analyze|.*\banalyze\b)/i.test(text))throw new FabricError("POLICY_DENIED",`${dialect} statement may have side effects`);return text;};
 const inspect: FabricLiteApi["inspect"] = {
  async postgres(input:{query:string;host?:string;port?:number;user?:string;database?:string}){const query=readQuery(input.query,"postgres");const args=["psql","-X","--no-psqlrc","--set","ON_ERROR_STOP=1","--tuples-only","--no-align"];for(const [flag,value,label] of [["--host",input.host,"PostgreSQL host"],["--username",input.user,"PostgreSQL user"],["--dbname",input.database,"PostgreSQL database"]] as const){const safe=safeToken(value,label);if(safe)args.push(flag,safe);}if(input.port!==undefined){if(!Number.isInteger(input.port)||input.port<1||input.port>65535)throw new FabricError("POLICY_DENIED","Invalid PostgreSQL port");args.push("--port",String(input.port));}args.push("--command",`BEGIN READ ONLY; SET LOCAL statement_timeout = '30s'; ${query}; ROLLBACK;`);if(!(await gate.authorize(networkRequest("postgres","query",args))))throw new FabricError("POLICY_DENIED","PostgreSQL inspection was not approved");return inspectionResult("postgres","query",await command(args,root,30000,undefined,config.shell.maxOutputChars));},
  async redis(input:{command:string;args?:string[];host?:string;port?:number;database?:number}){if(typeof input?.command!=="string")throw new FabricError("POLICY_DENIED","Redis command must be a string");if(input.args!==undefined&&!Array.isArray(input.args))throw new FabricError("POLICY_DENIED","Redis arguments must be an array");const operation=input.command.toUpperCase();const allowed=new Set(["PING","INFO","DBSIZE","TYPE","EXISTS","TTL","PTTL","GET","MGET","STRLEN","HGET","HGETALL","HKEYS","HLEN","LRANGE","LLEN","SMEMBERS","SCARD","ZRANGE","ZCARD","ZSCORE","SCAN","SSCAN","HSCAN","ZSCAN","MEMORY"]);if(!allowed.has(operation))throw new FabricError("POLICY_DENIED",`Redis command is not read-only allowlisted: ${operation}`);const values=input.args??[];if(values.length>20||values.some(value=>typeof value!=="string"||value.length>1024))throw new FabricError("POLICY_DENIED","Redis inspection arguments exceed bounds");if(operation==="MEMORY"&&values[0]?.toUpperCase()!=="USAGE")throw new FabricError("POLICY_DENIED","Only Redis MEMORY USAGE is allowed");const args=["redis-cli","--raw"];const host=safeToken(input.host,"Redis host");if(host)args.push("-h",host);if(input.port!==undefined){if(!Number.isInteger(input.port)||input.port<1||input.port>65535)throw new FabricError("POLICY_DENIED","Invalid Redis port");args.push("-p",String(input.port));}if(input.database!==undefined){if(!Number.isInteger(input.database)||input.database<0||input.database>255)throw new FabricError("POLICY_DENIED","Invalid Redis database");args.push("-n",String(input.database));}args.push(operation,...values);if(!(await gate.authorize(networkRequest("redis",operation,args))))throw new FabricError("POLICY_DENIED","Redis inspection was not approved");return inspectionResult("redis",operation,await command(args,root,30000,undefined,config.shell.maxOutputChars));},
  async sqlite(input:{path:string;query:string}){const database=await safePath(root,input.path);const query=readQuery(input.query,"sqlite");const args=["sqlite3","-readonly","-safe","-batch","-noheader",database,query];return inspectionResult("sqlite","query",await command(args,root,30000,undefined,config.shell.maxOutputChars));},
  async kubernetes(input:{operation:string;resource?:string;name?:string;namespace?:string;context?:string;container?:string;tail?:number}){const operation=input.operation;const allowed=new Set(["get","describe","logs","explain","api-resources","api-versions"]);if(!allowed.has(operation))throw new FabricError("POLICY_DENIED",`Kubernetes operation is not read-only allowlisted: ${operation}`);const resource=safeToken(input.resource,"Kubernetes resource",/^[A-Za-z0-9._\/-]+$/);if(resource&&/(^|\/)(secrets?|tokenreviews?|subjectaccessreviews?)(\.|\/|$)/i.test(resource))throw new FabricError("POLICY_DENIED","Sensitive Kubernetes resources are denied");const args=["kubectl"];const context=safeToken(input.context,"Kubernetes context");const namespace=safeToken(input.namespace,"Kubernetes namespace");if(context)args.push("--context",context);if(namespace)args.push("--namespace",namespace);args.push(operation);if(["get","describe","explain"].includes(operation)){if(!resource)throw new FabricError("POLICY_DENIED",`${operation} requires a resource`);args.push(resource);const name=safeToken(input.name,"Kubernetes name");if(name)args.push(name);if(operation==="get")args.push("-o","yaml");}else if(operation==="logs"){const name=safeToken(input.name,"pod name");if(!name)throw new FabricError("POLICY_DENIED","logs requires a pod name");args.push(name,"--tail",String(Math.min(Math.max(input.tail??200,1),1000)));const container=safeToken(input.container,"container");if(container)args.push("--container",container);}if(!(await gate.authorize(networkRequest("kubernetes",operation,args))))throw new FabricError("POLICY_DENIED","Kubernetes inspection was not approved");return inspectionResult("kubernetes",operation,await command(args,root,30000,undefined,config.shell.maxOutputChars));},
  async terraform(input:{operation:string;cwd?:string;path?:string}){const operation=input.operation;const directory=await safePath(root,input.cwd??".");const args=["terraform","-chdir="+directory];if(operation==="validate")args.push("validate","-json");else if(operation==="show"){args.push("show","-json");if(input.path)args.push(await safePath(root,input.path));}else if(operation==="state-list")args.push("state","list");else if(operation==="providers-schema")args.push("providers","schema","-json");else throw new FabricError("POLICY_DENIED",`Terraform operation is not read-only allowlisted: ${operation}`);return inspectionResult("terraform",operation,await command(args,root,30000,undefined,config.shell.maxOutputChars));}
 }; const shell: FabricLiteApi["shell"] = {async run(...args: unknown[]){const input = aliasedArguments(positionalArguments("fabric.shell.run", args, ["command"]), { cmd: "command", shell: "command", cmdline: "command" }) as { command: string; timeoutMs?: number; timeout?: number; maxOutputChars?: number; cwd?: string }; if (input.timeout !== undefined && input.timeoutMs === undefined) input.timeoutMs = Number(input.timeout) * 1000; requiredString("fabric.shell.run", input.command, "command"); optionalNumber("fabric.shell.run", input.timeoutMs, "timeoutMs"); optionalNumber("fabric.shell.run", input.maxOutputChars, "maxOutputChars"); if(!config.shell.enabled)throw new FabricError("POLICY_DENIED","Shell is disabled by project policy");if(typeof input?.command!=="string"||input.command.length===0)throw new FabricError("POLICY_DENIED","Shell command must be a non-empty string");const requestedCwd=await safePath(root,input.cwd??".");const canonicalCwd=await realpath(requestedCwd);const cwdInfo=await lstat(canonicalCwd);if(!cwdInfo.isDirectory())throw new FabricError("POLICY_DENIED","Shell cwd must be a directory");const cwd=canonicalCwd;const request=shellRequest(input.command,cwd);if(!(await gate.authorize(request)))throw new FabricError("POLICY_DENIED",request.category==="destructive"?"Destructive commands are denied by policy":"Shell command was not approved");const max=Math.min(input.maxOutputChars??config.shell.maxOutputChars,config.shell.maxOutputChars);const r=await command([process.env.SHELL??"/bin/sh","-c",input.command],cwd,Math.min(input.timeoutMs??config.shell.timeoutMs,config.shell.timeoutMs),{PATH:process.env.PATH,HOME:process.env.HOME,NO_COLOR:"1"},max);return{command:input.command,exitCode:r.code,stdout:r.stdout,stderr:r.stderr,truncated:r.stdoutTruncated||r.stderrTruncated,timedOut:r.timedOut};}};
 async function aiRun<T=unknown>(input:any,signal?:AbortSignal):Promise<AiResult<T>>{
  const request = argumentRecord("fabric.ai.run", input) as any; const instruction = requiredString("fabric.ai.run", request.instruction, "instruction");
  const redactor=new RequestRedactor(),role=request.role??"worker",context=redactor.redact(typeof request.context==="string"?request.context:JSON.stringify(request.context??null)),safeInstruction=redactor.redact(instruction),schema=request.outputSchema?redactor.value(request.outputSchema as Record<string,unknown>):undefined;
  const contextCap=Math.min(request.maxInputChars??config.budgets.maxContextCharsPerCall,config.budgets.maxContextCharsPerCall);
  if(context.length>contextCap)throw new FabricError("BUDGET_EXCEEDED",`AI context character budget exceeded (${context.length} > ${contextCap})`);
  const schemaText=JSON.stringify(schema??{}),inputChars=safeInstruction.length+context.length+schemaText.length;
  const requestedModel=request.model!==undefined?request.model:config.runner.defaultModel??undefined;
  const normalized:NormalizedAiRequest={instruction:safeInstruction,context,role,maxOutputChars:Math.min(request.maxOutputChars??(role==="verifier"?config.budgets.maxOutputCharsVerifier:config.budgets.maxOutputCharsPerWorker),role==="verifier"?config.budgets.maxOutputCharsVerifier:config.budgets.maxOutputCharsPerWorker),timeoutMs:Math.min(request.timeoutMs??config.budgets.aiCallTimeoutMs,config.budgets.aiCallTimeoutMs),...(requestedModel!==undefined?{model:requestedModel}:{}),...(schema?{schema}:{})};
  const cached=await cache.get(normalized);
  if(cached){
   budgets.cacheHit();
   return{value:cached.value as T,role,...(cached.model?{model:cached.model}:{}),...(cached.requestedModel?{requestedModel:cached.requestedModel}:{}),...(cached.resolvedModel?{resolvedModel:cached.resolvedModel}:{}),resolutionSource:cached.resolutionSource,inputChars:cached.inputChars,outputChars:cached.outputChars,repaired:false,cached:true};
  }
  const cacheResult=async(result:AiResult<T>):Promise<AiResult<T>>=>{
   const entry:CacheEntry={value:result.value,...(result.model?{model:result.model}:{}),...(result.requestedModel?{requestedModel:result.requestedModel}:{}),...(result.resolvedModel?{resolvedModel:result.resolvedModel}:{}),resolutionSource:result.resolutionSource,inputChars:result.inputChars,outputChars:result.outputChars,storedAt:Date.now()};
   await cache.set(normalized,entry);return result;
  };
  budgets.reserve(role,inputChars);let raw:Awaited<ReturnType<AiRunner["run"]>>|undefined;
  try{raw=await runner.run(normalized,signal);const safeStdout=redactor.redact(raw.stdout);budgets.settle(inputChars,safeStdout.length,raw.usage);const value=redactor.value(parseFramed(safeStdout,normalized.schema,normalized.maxOutputChars) as T);return await cacheResult({value,role,...(raw.model?{model:raw.model}:{}),...(raw.requestedModel?{requestedModel:raw.requestedModel}:{}),...(raw.resolvedModel?{resolvedModel:raw.resolvedModel}:{}),resolutionSource:raw.resolutionSource??"unknown",inputChars,outputChars:safeStdout.length,repaired:false});}
  catch(e){
   if(!(e instanceof FabricError)||e.code!=="INVALID_AI_OUTPUT"||request.retryInvalidJson===false||config.budgets.maxRetriesPerCall<1)throw e;
   const bad=redactor.redact(raw?.stdout?.slice(-normalized.maxOutputChars)??"(unparseable output)"),details=redactor.redact(JSON.stringify(e.details??[{message:e.message}]));
   const repairInstruction=`${loadPrompt("repair-json").trimEnd()}\n\nINVALID:\n${bad}\nSCHEMA_ERRORS:\n${details}\nSCHEMA:\n${schemaText}`;
   const repair={...normalized,instruction:repairInstruction,context:"",repair:true},repairChars=repairInstruction.length+schemaText.length;
   budgets.reserve(role,repairChars,true);const fixed=await runner.run(repair,signal),safeFixed=redactor.redact(fixed.stdout);budgets.settle(repairChars,safeFixed.length,fixed.usage);const value=redactor.value(parseFramed(safeFixed,normalized.schema,normalized.maxOutputChars) as T);
   return await cacheResult({value,role,...(fixed.model?{model:fixed.model}:{}),...(fixed.requestedModel?{requestedModel:fixed.requestedModel}:{}),...(fixed.resolvedModel?{resolvedModel:fixed.resolvedModel}:{}),resolutionSource:fixed.resolutionSource??"unknown",inputChars:inputChars+repairChars,outputChars:(raw?.stdout.length??0)+safeFixed.length,repaired:true});
  }
 }
 async function parallel<T=unknown>(input:any):Promise<AiResult<T>[]> {const request=argumentRecord("fabric.ai.parallel",input) as any;if(!Array.isArray(request.tasks))invalidArguments("fabric.ai.parallel","tasks must be an array");const tasks=request.tasks as any[];if(tasks.some((task)=>!isArgumentRecord(task)))invalidArguments("fabric.ai.parallel","tasks must contain options objects");const concurrency=Math.min(request.concurrency??config.budgets.maxConcurrency,config.budgets.maxConcurrency);if(concurrency<1)throw new FabricError("BUDGET_EXCEEDED","Concurrency must be at least one");const results=new Array(tasks.length),controller=new AbortController();let next=0,failed:unknown;async function worker(){while(true){if(failed&&request.failFast)return;const i=next++;if(i>=tasks.length)return;try{results[i]=await aiRun(tasks[i],controller.signal);}catch(e){if(request.failFast){if(failed===undefined){failed=e;controller.abort();}return;}results[i]={value:undefined,role:tasks[i].role??"worker",resolutionSource:"unknown",inputChars:0,outputChars:0,repaired:false,error:{code:e instanceof FabricError?e.code:"RUNTIME_FAILED",message:new RequestRedactor().redact(e instanceof Error?e.message:String(e))}};}}}await Promise.all(Array.from({length:Math.min(concurrency,tasks.length)},worker));if(failed)throw failed;return results as AiResult<T>[];}
 const ai={run:aiRun,parallel,async map<TItem,TResult=unknown>(input:any):Promise<AiResult<TResult>[]> {const items=(input.items as TItem[]).slice(0,input.maxItems??input.items.length);return parallel<TResult>({tasks:items.map(input.createTask),concurrency:input.concurrency});}};
 const mutation: FabricLiteApi["mutate"] = {
  async begin(input?: { mode?: MutationMode; label?: string }) {
   if (mutationSession) throw new FabricError("RUNTIME_FAILED", "A mutation session is already active");
   if (!config.mutation.enabled) throw new FabricError("POLICY_DENIED", "The mutation workflow is disabled by project policy");
   if (input !== undefined && !isArgumentRecord(input)) invalidArguments("fabric.mutate.begin", "expected an options object");
   const requested = input as { mode?: unknown; label?: unknown } | undefined;
   const mode = (requested?.mode ?? config.mutation.require) as MutationMode;
   if (mode !== "clean" && mode !== "checkpoint") invalidArguments("fabric.mutate.begin", "mode must be clean or checkpoint");
   const label = requested?.label;
   if (label !== undefined && (typeof label !== "string" || label.length > 200 || /[\u0000-\u001f\u007f]/.test(label))) {
    invalidArguments("fabric.mutate.begin", "label must be at most 200 safe characters");
   }
   const repository = await command(["git", "rev-parse", "--show-toplevel"], root);
   const baseHeadResult = await command(["git", "rev-parse", "HEAD"], root);
   if (repository.code !== 0 || baseHeadResult.code !== 0 || !baseHeadResult.stdout.trim()) {
    throw new FabricError("POLICY_DENIED", "Mutation workflow requires a Git repository with HEAD");
   }
   const repositoryRoot = path.resolve(repository.stdout.trim());
   if (await realpath(repositoryRoot) !== await realpath(root)) throw new FabricError("POLICY_DENIED", "Git repository root must equal the Fabric project root");
   const baseHead = baseHeadResult.stdout.trim();
   if (mode === "clean") {
    const status = await command(["git", "-c", "core.fsmonitor=false", "status", "--porcelain=v1"], root);
    if (status.code !== 0) throw new FabricError("RUNTIME_FAILED", status.stderr.trim() || "Git status failed");
    const dirty = status.stdout.split(/\r?\n/).filter(Boolean);
    if (dirty.length > 0) {
     const paths = dirty.slice(0, 10).map((line) => line.length > 3 ? line.slice(3) : line);
     throw new FabricError("POLICY_DENIED", `Mutation requires a clean worktree; dirty paths: ${paths.join(", ")}`);
    }
    mutationSession = { checkpointId: baseHead, baseHead, mode, ...(label === undefined ? {} : { label }), createdFiles: new Set(), modifiedFiles: new Set() };
    return { checkpoint: { id: baseHead, mode, baseHead }, guidance: `Mutation session started from clean HEAD ${baseHead}. Review the diff before completing or roll back to this commit.` };
   }
   const checkpointId = `cp_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
   const checkpointRef = `refs/fabric-lite/checkpoints/${checkpointId}`;
   const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "fabric-mutation-index-"));
   const temporaryIndex = path.join(temporaryDirectory, "index");
   const indexEnv: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
   try {
    const initialized = await command(["git", "read-tree", "HEAD"], root, 30000, indexEnv);
    if (initialized.code !== 0) throw new FabricError("RUNTIME_FAILED", initialized.stderr.trim() || "Git checkpoint index initialization failed");
    const added = await command(["git", "-c", "core.fsmonitor=false", "add", "-A"], root, 30000, indexEnv);
    if (added.code !== 0) throw new FabricError("RUNTIME_FAILED", added.stderr.trim() || "Git checkpoint staging failed");
    const tree = await command(["git", "-c", "core.fsmonitor=false", "write-tree"], root, 30000, indexEnv);
    if (tree.code !== 0 || !tree.stdout.trim()) throw new FabricError("RUNTIME_FAILED", tree.stderr.trim() || "Git checkpoint tree creation failed");
    const message = `fabric-lite mutation checkpoint${label ? ` ${label}` : ""}`;
    const created = await command(["git", "-c", "commit.gpgSign=false", "commit-tree", tree.stdout.trim(), "-p", baseHead], root, 30000, indexEnv, 100000, `${message}\n`);
    if (created.code !== 0 || !/^[0-9a-f]{40}$/.test(created.stdout.trim())) throw new FabricError("RUNTIME_FAILED", created.stderr.trim() || "Git checkpoint commit creation failed");
    const updated = await command(["git", "update-ref", checkpointRef, created.stdout.trim()], root);
    if (updated.code !== 0) throw new FabricError("RUNTIME_FAILED", updated.stderr.trim() || "Git checkpoint ref creation failed");
    mutationSession = { checkpointId: created.stdout.trim(), checkpointRef, baseHead, mode, ...(label === undefined ? {} : { label }), createdFiles: new Set(), modifiedFiles: new Set() };
    return { checkpoint: { id: created.stdout.trim(), mode, baseHead }, guidance: `Mutation checkpoint ${created.stdout.trim()} created without changing the branch or real index. Gitignored files are not included.` };
   } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
   }
  },
  async diff(input?: { maxChars?: number }) {
   const session = mutationSession;
   if (!session) throw new FabricError("RUNTIME_FAILED", "No active mutation session");
   if (input !== undefined && !isArgumentRecord(input)) invalidArguments("fabric.mutate.diff", "expected an options object");
   const requested = input as { maxChars?: unknown } | undefined;
   const requestedMax = requested?.maxChars;
   if (requestedMax !== undefined && (!Number.isInteger(requestedMax) || (requestedMax as number) < 0)) invalidArguments("fabric.mutate.diff", "maxChars must be a nonnegative integer");
   const maxChars = Math.min((requestedMax as number | undefined) ?? config.mutation.maxDiffChars, config.mutation.maxDiffChars);
   const result = await command(["git", "-c", "core.fsmonitor=false", "diff", session.checkpointId], root, 30000, undefined, maxChars + 1);
   if (result.code !== 0) throw new FabricError("RUNTIME_FAILED", result.stderr.trim() || "Git mutation diff failed");
   const bounded = truncate(result.stdout, maxChars);
   return { diff: bounded.text, truncated: bounded.truncated || result.stdoutTruncated, createdFiles: [...session.createdFiles], changedFiles: [...session.modifiedFiles] };
  },
  async review(input?: { instruction?: string }) {
   const session = mutationSession;
   if (!session) throw new FabricError("RUNTIME_FAILED", "No active mutation session");
   if (input !== undefined && !isArgumentRecord(input)) invalidArguments("fabric.mutate.review", "expected an options object");
   const instruction = (input as { instruction?: unknown } | undefined)?.instruction;
   if (instruction !== undefined && (typeof instruction !== "string" || instruction.length === 0)) invalidArguments("fabric.mutate.review", "instruction must be a non-empty string");
   const diff = await mutation.diff({ maxChars: Math.min(config.mutation.maxDiffChars, Math.max(0, config.budgets.maxContextCharsPerCall - 256)) });
   const outputSchema = { type: "object", required: ["approved", "issues", "summary"], properties: { approved: { type: "boolean" }, issues: { type: "array", items: { type: "string" } }, summary: { type: "string" } } };
   return aiRun({
    instruction: instruction ?? "Review this Fabric Lite mutation diff for correctness and safety. Identify risks, regressions, or missing changes and decide whether it is safe to complete.",
    context: JSON.stringify(diff), role: "verifier", outputSchema,
   });
  },
  async rollback() {
   const session = mutationSession;
   if (!session) throw new FabricError("RUNTIME_FAILED", "No active mutation session");
   const restored = await command(["git", "-c", "core.fsmonitor=false", "restore", `--source=${session.checkpointId}`, "--worktree", "--", "."], root);
   if (restored.code !== 0) throw new FabricError("RUNTIME_FAILED", restored.stderr.trim() || "Git mutation rollback failed");
   const removedFiles: string[] = [];
   for (const relative of session.createdFiles) {
    try {
     const target = await safeWritePath(root, relative, config.filesystem.allowWrite);
     const info = await lstat(target.absolute);
     if (!info.isFile() || info.isSymbolicLink()) continue;
     await unlink(target.absolute);
     removedFiles.push(relative);
    } catch (error) {
     if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof FabricError && error.code === "POLICY_DENIED") continue;
     throw error;
    }
   }
   if (session.checkpointRef) {
    const removed = await command(["git", "update-ref", "-d", session.checkpointRef], root);
    if (removed.code !== 0) throw new FabricError("RUNTIME_FAILED", removed.stderr.trim() || "Git checkpoint ref deletion failed");
   }
   mutationSession = undefined;
   return { restored: true as const, checkpoint: session.checkpointId, removedFiles, guidance: `Tracked files were restored to ${session.checkpointId}; files created during this session were removed where safely allowlisted.` };
  },
  async complete() {
   const session = mutationSession;
   if (!session) throw new FabricError("RUNTIME_FAILED", "No active mutation session");
   mutationSession = undefined;
   const checkpoint = { id: session.checkpointId, mode: session.mode, baseHead: session.baseHead };
   const created = [...session.createdFiles];
   const rollbackGuidance = session.checkpointRef
    ? `To roll back tracked files, run git restore --source=${session.checkpointId} --worktree -- .; delete created files manually (${created.join(", ") || "none"}); then clean up the checkpoint with git update-ref -d ${session.checkpointRef}.`
    : `To roll back tracked files, run git restore --source=${session.checkpointId} --worktree -- .; delete created files manually (${created.join(", ") || "none"}).`;
   return { checkpoint, createdFiles: created, rollbackGuidance };
  },
 };
 return {fabric:{fs:fsApi,git,mutate:mutation,inspect,shell,ai,util:{chunk<T>(items:T[],size:number){if(!Number.isInteger(size)||size<1)throw new Error("chunk size must be positive");return Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size));},unique<T>(items:T[]){return[...new Set(items)];},sortBy<T>(items:T[],selector:(x:T)=>string|number){return[...items].sort((a,b)=>{const x=selector(a),y=selector(b);return x<y?-1:x>y?1:0;});},truncate(text:string,max:number){return text.length<=max?text:text.slice(0,Math.max(0,max-1))+"…";},compactJson(value:unknown,max:number){const s=JSON.stringify(value);return s.length<=max?s:s.slice(0,Math.max(0,max-1))+"…";}}},metrics:budgets.metrics};
}
