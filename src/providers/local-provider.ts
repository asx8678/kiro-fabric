import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { throwIfAbortedOrExpired } from "../async-settlement.js";
import { schemaValidationMessage } from "../schema-validation.js";
import { canonicalPathContains } from "../kiro/canonical-path.js";
import { fabricJsonText, MAX_FABRIC_JSON_CHARS } from "../runtime/json-budget.js";
import { FABRIC_COMMIT_ACKNOWLEDGEMENT } from "../protocol.js";
import type { FabricActionDescriptor, FabricInvocationContext, FabricProvider } from "../protocol.js";
import type { LocalProviderOptions, LocalReadResult, LocalGrepResult, LocalFindResult, LocalListResult, LocalShellResult } from "./local-contract.js";
import { LOCAL_MAX_FILE_BYTES, LocalNonTextError, LocalPaths, localHash, localIdentity, sameLocalIdentity } from "./local-path.js";
import type { LocalPathSnapshot } from "./local-path.js";
import { runLocalShell } from "./local-shell.js";

// Fabric's bounded JSON/schema walkers intentionally reject shared graphs.
const jsonTree = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const object = (properties: Record<string, unknown>, required: string[] = []) => jsonTree({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string" };
const boolean = { type: "boolean" };
const integer = { type: "integer", minimum: 0 };
const identitySchema = object({ dev: integer, ino: integer }, ["dev", "ino"]);
const pathSchema = { type: "string", minLength: 1, maxLength: 4096 };
const count = { type: "integer", minimum: 1, maximum: 1000 };
const metadataSchema = object({ token: { type: "string", minLength: 36, maxLength: 36 }, beforeSha256: { type: ["string", "null"] }, afterSha256: string, identity: { ...identitySchema, type: ["object", "null"] }, parentIdentity: identitySchema }, ["token"]);
const rawSchemas: Record<string, Record<string, unknown>> = {
  read: object({ path: pathSchema, offset: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, limit: { type: "integer", minimum: 1, maximum: 2000 } }, ["path"]),
  grep: object({ pattern: { type: "string", maxLength: 2000 }, path: pathSchema, glob: { type: "string", minLength: 1, maxLength: 2000 }, literal: boolean, ignoreCase: boolean, limit: count }, ["pattern"]),
  find: object({ pattern: { type: "string", minLength: 1, maxLength: 2000 }, path: pathSchema, limit: count }, ["pattern"]),
  list: object({ path: pathSchema, limit: count }),
  write: object({ path: pathSchema, content: { type: "string", maxLength: LOCAL_MAX_FILE_BYTES }, overwrite: boolean }, ["path", "content"]),
  edit: object({ path: pathSchema, oldText: { type: "string", minLength: 1, maxLength: LOCAL_MAX_FILE_BYTES }, newText: { type: "string", maxLength: LOCAL_MAX_FILE_BYTES }, all: boolean }, ["path", "oldText", "newText"]),
  shell: object({ command: { type: "string", minLength: 1, maxLength: 8000 }, cwd: pathSchema, timeoutMs: { type: "integer", minimum: 1, maximum: 900000 }, settle: boolean }, ["command"]),
};
const mutationOutput = object({ path: string, changed: boolean, sha256: string, bytes: integer, identity: identitySchema }, ["path", "changed", "sha256", "bytes", "identity"]);
const outputSchemas: Record<string, Record<string, unknown>> = {
  read: object({ path: string, text: string, truncated: boolean, nextOffset: { type: "integer", minimum: 1 }, sha256: string, identity: identitySchema }, ["path", "text", "truncated", "sha256", "identity"]),
  grep: object({ matches: { type: "array", maxItems: 1000, items: object({ path: string, line: { type: "integer", minimum: 1 }, text: { type: "string", maxLength: 500 } }, ["path", "line", "text"]) }, truncated: boolean }, ["matches", "truncated"]),
  find: object({ paths: { type: "array", maxItems: 1000, items: string }, truncated: boolean }, ["paths", "truncated"]),
  list: object({ entries: { type: "array", maxItems: 1000, items: object({ path: string, type: { enum: ["file", "directory"] } }, ["path", "type"]) }, truncated: boolean }, ["entries", "truncated"]),
  write: mutationOutput, edit: mutationOutput,
  shell: object({ ok: boolean, exitCode: { type: ["integer", "null"] }, signal: { type: ["string", "null"] }, stdout: string, stderr: string, truncated: boolean, stdoutTruncated: boolean, stderrTruncated: boolean }, ["ok", "exitCode", "signal", "stdout", "stderr", "truncated", "stdoutTruncated", "stderrTruncated"]),
};
const descriptions: Record<string, string> = {
  read: "Read valid UTF-8, one-based offset; default 200/max 2000 lines, <=2MiB file, bounded JSON. Oversized single lines fail. No traversal, symlinks, hardlinks or special files.",
  grep: "Search with external rg, --no-config --sort path; respects ignore files, excludes hidden paths and symlinks. Default 100/max 1000 records, text <=500 chars (truncated flags omissions). Binary/invalid UTF-8 files skipped; >2MiB files skipped with truncated=true. Bounded enumeration and process output; no JS search fallback.",
  find: "Glob file paths via external rg --files --no-config --sort path; respects ignore files, excludes hidden paths and symlinks. Default 100/max 1000 results. Unsafe files rejected. Enumeration <=10000 files/2MiB output.",
  list: "Sorted direct children, including hidden entries; default 100/max 1000 results, at most 10000 scanned entries. Symlinks, hardlinks and special entries fail.",
  write: "Exact approved write, create-only unless overwrite=true; existing parent required. Snapshots bind identities/content and complete diff before approval; revalidated before publication. Path checks are defense in depth, not hostile-race isolation.",
  edit: "Exact approved edit; nonempty unique oldText unless all=true (nonoverlapping replacements). Existing parent required. Identity/hash conflict detection and complete actual diff; no multi-operation transaction or hostile-race isolation.",
  shell: "Exact approved /bin/sh command in verified canonical cwd, not confinement. Workspace-wide lock, bounded output and deadline, TERM/KILL cleanup; no background jobs. Deliberate process-group escapes are not contained.",
};
const effectful = (name: string): boolean => ["write", "edit", "shell"].includes(name);
interface Prepared {
  name: string;
  signature: string;
  snapshot?: LocalPathSnapshot;
  directory?: ReturnType<LocalPaths["directory"]>;
  proposed?: string;
  active: boolean;
  committed?: boolean;
}

/** Independent POSIX local coding provider. Cooperating runtimes share lockRoot.
 * Never breaks stale/uncertain locks; recovery requires operator investigation.
 * Bounds: <=2MiB/file, <=10000 enumeration entries, <=32MiB grep input,
 * <=2MiB rg stdout/stderr, 10s rg timeout, result JSON <=min(20000,budget).
 * Search ignore files may affect enumeration; explicit roots must be safe.
 * Node pathname revalidation does not close malicious same-user TOCTOU races. */
export class LocalCodingProvider implements FabricProvider {
  readonly name = "local";
  readonly description = "Verified workspace local coding with bounded reads and exact approved effects";
  readonly #paths: LocalPaths;
  readonly #lockRoot: string;
  readonly #lockIdentity: ReturnType<typeof localIdentity>;
  readonly #budget: number;
  readonly #descriptors: FabricActionDescriptor[];
  readonly #controller = new AbortController();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #prepared = new Map<string, Prepared>();
  #closed = false;

  constructor(options: LocalProviderOptions) {
    this.#paths = new LocalPaths(options.root);
    this.#budget = Math.min(20000, options.maxResultChars ?? 20000);
    if (!Number.isSafeInteger(this.#budget) || this.#budget < 256) throw new Error("local maxResultChars must be an integer >=256");
    if (!path.isAbsolute(options.lockRoot)) throw new Error("local lockRoot must be absolute");
    // Check existing canonical ancestry before creating any private data.
    let existing = path.resolve(options.lockRoot);
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    const canonicalLockTarget = path.resolve(fs.realpathSync(existing), path.relative(existing, path.resolve(options.lockRoot)));
    if (canonicalPathContains(this.#paths.root, canonicalLockTarget)) throw new Error("local lockRoot must be outside the source workspace");
    fs.mkdirSync(options.lockRoot, { recursive: true, mode: 0o700 });
    this.#lockRoot = fs.realpathSync(options.lockRoot);
    const lockStat = fs.lstatSync(options.lockRoot);
    if (this.#lockRoot !== options.lockRoot || !lockStat.isDirectory() || lockStat.isSymbolicLink() || (lockStat.mode & 0o077) !== 0 || (process.getuid && lockStat.uid !== process.getuid())) throw new Error("local lockRoot must be a canonical private owned directory (0700)");
    this.#lockIdentity = localIdentity(lockStat);
    this.#descriptors = Object.keys(rawSchemas).map((name) => {
      const raw = rawSchemas[name]!;
      return { name, description: descriptions[name]!, inputSchema: effectful(name) ? { ...raw, properties: { ...(raw.properties as Record<string, unknown>), _localPreparation: metadataSchema, review: { type: "string", maxLength: 11000 } } } : raw, outputSchema: outputSchemas[name]!, risk: name === "shell" ? "execute" : effectful(name) ? "write" : "read", effect: { kind: effectful(name) ? "write" : "read", resources: [`local-workspace:${this.#paths.root}`] } };
    });
  }
  async list(): Promise<FabricActionDescriptor[]> { return jsonTree(this.#descriptors); }
  async describe(name: string): Promise<FabricActionDescriptor | undefined> {
    const descriptor = this.#descriptors.find((item) => item.name === name);
    return descriptor ? jsonTree(descriptor) : undefined;
  }
  effectResources(): readonly string[] { return [`local-workspace:${this.#paths.root}`]; }
  #check(context: FabricInvocationContext): void {
    if (this.#closed) throw new Error("local provider is closed");
    throwIfAbortedOrExpired(context.signal, context.deadline);
    this.#controller.signal.throwIfAborted();
    this.#paths.verifyRoot();
  }
  #validate(name: string, args: Record<string, unknown>, prepared = false): void {
    if (typeof args !== "object" || args === null || Array.isArray(args)) throw new Error(`Invalid arguments for local.${name}: must be an object`);
    const schema = prepared ? this.#descriptors.find((item) => item.name === name)?.inputSchema : Object.hasOwn(rawSchemas, name) ? rawSchemas[name] : undefined;
    if (!schema) throw new Error(`Unknown local action: ${name}`);
    if (!prepared && (Object.prototype.hasOwnProperty.call(args, "_localPreparation") || Object.prototype.hasOwnProperty.call(args, "review"))) throw new Error("Caller-injected local preparation metadata is forbidden");
    const invalid = schemaValidationMessage(jsonTree(schema), args);
    if (invalid) throw new Error(`Invalid arguments for local.${name}: ${invalid}`);
  }
  #fits(value: unknown): boolean { return JSON.stringify(value).length <= this.#budget; }
  #bounded<T>(value: T): T {
    if (!this.#fits(value)) throw new Error("local typed result metadata exceeds configured result budget");
    return value;
  }
  async prepareArguments(name: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<Record<string, unknown>> {
    this.#validate(name, args);
    this.#check(context);
    const canonical = structuredClone(args);
    if (!effectful(name)) {
      canonical.path = this.#paths.check((args.path as string | undefined) ?? ".").path;
      return canonical;
    }
    let entry: Prepared;
    const token = randomUUID();
    let metadata: Record<string, unknown>;
    let review: string;
    if (name === "shell") {
      const directory = this.#paths.directory((args.cwd as string | undefined) ?? ".");
      canonical.cwd = directory.path;
      canonical.timeoutMs = args.timeoutMs ?? 30000;
      canonical.settle = args.settle ?? false;
      if ((args.command as string).includes("\0")) throw new Error("local shell command must not contain NUL");
      review = `Command: ${JSON.stringify(args.command)}\nCanonical cwd: ${JSON.stringify(directory.path)}\nTimeout ms: ${canonical.timeoutMs}\nSettle ordinary nonzero: ${canonical.settle}`;
      metadata = { token, identity: directory.identity, parentIdentity: directory.parents.at(-1)!.identity };
      entry = { name, signature: "", directory, active: false };
    } else {
      const captured = this.#paths.snapshot(args.path as string);
      canonical.path = captured.snapshot.path;
      if (name === "write" && captured.snapshot.file && args.overwrite !== true) throw new Error("local.write is create-only; existing file requires overwrite=true");
      if (name === "edit" && !captured.snapshot.file) throw new Error("local.edit requires an existing file");
      let proposed: string;
      if (name === "write") proposed = args.content as string;
      else {
        const anchor = args.oldText as string;
        const first = captured.text.indexOf(anchor);
        if (first < 0) throw new Error("local.edit exact anchor was not found");
        if (captured.text.indexOf(anchor, first + 1) >= 0 && args.all !== true) throw new Error("local.edit anchor is not unique; use all=true for all nonoverlapping occurrences");
        proposed = captured.text.split(anchor).join(args.newText as string);
      }
      if (Buffer.byteLength(proposed) > LOCAL_MAX_FILE_BYTES || proposed.includes("\0") || Buffer.from(proposed).toString("utf8") !== proposed) throw new Error("local proposed content must be valid UTF-8 text <=2MiB without NUL");
      review = this.#review(captured.snapshot.path, captured.text, proposed);
      metadata = { token, beforeSha256: captured.snapshot.file?.sha256 ?? null, afterSha256: localHash(proposed), identity: captured.snapshot.file?.identity ?? null, parentIdentity: captured.snapshot.parents.at(-1)!.identity };
      entry = { name, signature: "", snapshot: captured.snapshot, proposed, active: false };
      this.#bounded({ path: this.#paths.relative(captured.snapshot.path), changed: true, sha256: localHash(proposed), bytes: Buffer.byteLength(proposed), identity: { dev: this.#paths.identity.dev, ino: Number.MAX_SAFE_INTEGER } });
    }
    if (review.length > 11000) throw new Error("local exact review exceeds 11000-character approval budget");
    canonical.review = review;
    canonical._localPreparation = metadata;
    // Approval display and typed result budgets are distinct: even the minimum
    // result budget must permit a short reviewed effect. Review is <=11000;
    // full canonical arguments remain bounded by the host JSON ceiling.
    entry.signature = localHash(fabricJsonText(canonical, MAX_FABRIC_JSON_CHARS));
    while (this.#prepared.size >= 100 || [...this.#prepared.values()].reduce((sum, item) => sum + (item.proposed?.length ?? 0), entry.proposed?.length ?? 0) > 8_000_000) {
      const victim = [...this.#prepared].find(([, item]) => !item.active);
      if (!victim) throw new Error("local preparation limit reached");
      this.#prepared.delete(victim[0]);
    }
    this.#prepared.set(token, entry);
    return canonical;
  }
  #review(target: string, before: string, after: string): string {
    const label = JSON.stringify(this.#paths.relative(target));
    const header = `Canonical path: ${JSON.stringify(target)}\n--- ${label} sha256:${localHash(before)}\n+++ ${label} sha256:${localHash(after)}`;
    if (before === after) return `${header}\nNo content change`;
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
    // Use UTF-16 ranges explicitly, matching exact JavaScript string edits.
    // Never omit changed text. Only identical prefix/suffix may be summarized.
    const oldEnd = before.length - suffix;
    const newEnd = after.length - suffix;
    const oldText = before.slice(prefix, oldEnd);
    const newText = after.slice(prefix, newEnd);
    const lineAt = (text: string, end: number): number => {
      let line = 1;
      for (let index = 0; index < end; index++) if (text.charCodeAt(index) === 10) line++;
      return line;
    };
    const contextStart = Math.max(0, prefix - 200);
    const contextEnd = Math.min(before.length, oldEnd + 200);
    return `${header}\n@@ original lines ${lineAt(before, prefix)}-${lineAt(before, oldEnd)}, UTF-16 [${prefix},${oldEnd}); proposed lines ${lineAt(after, prefix)}-${lineAt(after, newEnd)}, UTF-16 [${prefix},${newEnd}) @@\nUnchanged prefix omitted: ${contextStart} UTF-16 chars\n context-before ${JSON.stringify(before.slice(contextStart, prefix))}\n-${JSON.stringify(oldText)}\n+${JSON.stringify(newText)}\n context-after ${JSON.stringify(before.slice(oldEnd, contextEnd))}\nUnchanged suffix omitted: ${before.length - contextEnd} UTF-16 chars`;
  }
  #preparedEntry(name: string, args: Record<string, unknown>): { token: string; entry: Prepared } {
    this.#validate(name, args, true);
    const token = (args._localPreparation as { token?: string } | undefined)?.token;
    const entry = token ? this.#prepared.get(token) : undefined;
    if (!token || !entry || entry.name !== name || entry.signature !== localHash(JSON.stringify(args))) throw new Error("local canonical preparation is missing, altered or expired");
    return { token, entry };
  }
  #verifyLockRoot(): void {
    const stat = fs.lstatSync(this.#lockRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !sameLocalIdentity(stat, this.#lockIdentity) || fs.realpathSync(this.#lockRoot) !== this.#lockRoot || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error("local lockRoot identity/privacy changed");
  }
  async reserveInvocation(name: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<() => void> {
    this.#check(context);
    if (!effectful(name)) return () => {};
    const { token, entry } = this.#preparedEntry(name, args);
    if (entry.active) throw new Error("local invocation is already reserved");
    this.#verifyLockRoot();
    const lock = path.join(this.#lockRoot, `local-${localHash(this.#paths.root)}.lock`);
    let fd: number;
    try { fd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
    catch (error) { throw new Error("local workspace lock unavailable; concurrent or uncertain owner (never automatically broken)", { cause: error }); }
    const owned = localIdentity(fs.fstatSync(fd));
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, root: this.#paths.root })); }
    catch (error) {
      fs.closeSync(fd);
      this.#verifyLockRoot();
      if (sameLocalIdentity(fs.lstatSync(lock), owned)) fs.unlinkSync(lock);
      throw error;
    }
    fs.closeSync(fd);
    entry.active = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.active = false;
      this.#prepared.delete(token);
      try {
        this.#verifyLockRoot();
        const stat = fs.lstatSync(lock);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !sameLocalIdentity(stat, owned)) throw new Error("local lock ownership changed; refusing to release uncertain lock");
        fs.unlinkSync(lock);
      } catch (error) {
        if (entry.committed) {
          const failure = new Error("local mutation committed; lock release failed; inspect before retrying", { cause: error });
          Object.defineProperty(failure, FABRIC_COMMIT_ACKNOWLEDGEMENT, { value: { version: 1, operation: name } });
          throw failure;
        }
        throw error;
      }
    };
  }
  invoke(name: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    const pending = this.#invoke(name, args, context);
    this.#pending.add(pending);
    void pending.finally(() => this.#pending.delete(pending)).catch(() => {});
    return pending;
  }
  async #invoke(name: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    this.#validate(name, args, effectful(name));
    this.#check(context);
    if (effectful(name)) {
      const { entry } = this.#preparedEntry(name, args);
      if (!entry.active) throw new Error("local effect requires an active registry reservation");
      if (name === "shell") {
        if (JSON.stringify(this.#paths.directory(args.cwd as string)) !== JSON.stringify(entry.directory)) throw new Error("local shell approval cwd identity conflict");
        this.#check(context);
        const result: LocalShellResult = await runLocalShell({ command: args.command as string, cwd: args.cwd as string, maxOutputChars: this.#budget, signal: context.signal ? AbortSignal.any([context.signal, this.#controller.signal]) : this.#controller.signal, ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {}), ...(typeof args.settle === "boolean" ? { settle: args.settle } : {}), ...(context.deadline ? { deadline: context.deadline } : {}) });
        this.#check(context);
        return this.#bounded(result);
      }
      return this.#publish(name, entry, context);
    }
    if (name === "read") return this.#read(args);
    if (name === "list") return this.#list(args);
    if (name === "find" || name === "grep") return await this.#search(name, args, context);
    throw new Error(`Unknown local action: ${name}`);
  }
  #read(args: Record<string, unknown>): LocalReadResult {
    const { text, snapshot } = this.#paths.read(args.path as string);
    const lines = text === "" ? [] : text.split("\n");
    if (text.endsWith("\n")) lines.pop();
    const start = ((args.offset as number | undefined) ?? 1) - 1;
    const end = Math.min(lines.length, start + ((args.limit as number | undefined) ?? 200));
    const result: LocalReadResult = { path: this.#paths.relative(snapshot.path), text: "", truncated: false, sha256: snapshot.file!.sha256, identity: snapshot.file!.identity };
    this.#bounded(result);
    for (let index = start; index < end; index++) {
      const previous = result.text;
      result.text += lines[index]! + (index < lines.length - 1 || text.endsWith("\n") ? "\n" : "");
      result.truncated = index + 1 < lines.length;
      if (result.truncated) result.nextOffset = index + 2;
      else delete result.nextOffset;
      if (!this.#fits(result)) {
        if (index === start) throw new Error("local.read single line exceeds configured character budget");
        result.text = previous;
        result.truncated = true;
        result.nextOffset = index + 1;
        return this.#bounded(result);
      }
    }
    return this.#bounded(result);
  }
  #list(args: Record<string, unknown>): LocalListResult {
    const directory = this.#paths.directory((args.path as string | undefined) ?? ".");
    const handle = fs.opendirSync(directory.path);
    const names: string[] = [];
    try {
      let item: fs.Dirent | null;
      while ((item = handle.readSync())) {
        if (names.length >= 10000) throw new Error("local.list directory exceeds 10000-entry work limit");
        names.push(item.name);
      }
    } finally { handle.closeSync(); }
    const result: LocalListResult = { entries: [], truncated: false };
    const limit = (args.limit as number | undefined) ?? 100;
    for (const name of names.sort()) {
      const found = this.#paths.check(path.join(directory.path, name));
      if (result.entries.length >= limit) { result.truncated = true; continue; }
      result.entries.push({ path: this.#paths.relative(found.path), type: found.stat!.isDirectory() ? "directory" : "file" });
      // Reserve room for truncated=true (shorter than false, but explicit).
      if (!this.#fits(result)) { result.entries.pop(); result.truncated = true; break; }
    }
    if (JSON.stringify(this.#paths.directory(directory.path)) !== JSON.stringify(directory)) throw new Error("local.list directory identity changed");
    return this.#bounded(result);
  }
  async #rg(args: string[], context: FabricInvocationContext): Promise<string> {
    this.#check(context);
    const signal = context.signal ? AbortSignal.any([context.signal, this.#controller.signal]) : this.#controller.signal;
    const output = await new Promise<string>((resolve, reject) => {
      execFile("rg", ["--no-config", "--sort", "path", ...args], { cwd: this.#paths.root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: Math.max(1, Math.min(10000, Math.floor(context.deadline?.remainingMs() ?? 10000))), killSignal: "SIGKILL", signal }, (error, stdout, stderr) => {
        if (!error || (error.code === 1 && !error.killed)) resolve(stdout);
        else if (error.code === "ENOENT") reject(new Error("local search requires external ripgrep (rg) on PATH"));
        else reject(new Error(`local rg failed or exceeded bounded work/output: ${String(error.code)} ${stderr.slice(0, 500)}`, { cause: error }));
      });
    });
    this.#check(context);
    return output;
  }
  async #search(name: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<LocalFindResult | LocalGrepResult> {
    const base = this.#paths.check((args.path as string | undefined) ?? ".");
    const glob = name === "find" ? args.pattern as string : args.glob as string | undefined;
    const enumeration = await this.#rg(["--files", "--null", "--", base.path], context);
    let files = enumeration.split("\0").filter(Boolean);
    if (files.length > 10000) throw new Error("local search exceeds 10000-file work limit");
    if (glob) {
      // Positive rg globs can override hidden/ignore rules. Intersect with the
      // normal enumeration so a glob only narrows scope, never expands it.
      const filtered = await this.#rg(["--files", "--null", "--glob", glob, "--", base.path], context);
      const selected = new Set(filtered.split("\0").filter(Boolean));
      if (selected.size > 10000) throw new Error("local glob enumeration exceeds 10000-file work limit");
      files = files.filter((file) => selected.has(file));
    }
    if (files.length > 10000) throw new Error("local search exceeds 10000-file work limit");
    const checked = files.map((file) => this.#paths.check(file));
    for (const file of checked) if (!file.stat?.isFile()) throw new Error("local search requires regular files");
    const limit = (args.limit as number | undefined) ?? 100;
    if (name === "find") {
      const result: LocalFindResult = { paths: [], truncated: false };
      for (const file of checked) {
        if (result.paths.length >= limit) { result.truncated = true; break; }
        result.paths.push(this.#paths.relative(file.path));
        if (!this.#fits(result)) { result.paths.pop(); result.truncated = true; break; }
      }
      return this.#bounded(result);
    }
    const result: LocalGrepResult = { matches: [], truncated: false };
    if (!files.length) return result;
    const candidates = checked.filter((item) => item.stat!.size <= LOCAL_MAX_FILE_BYTES);
    if (candidates.length !== checked.length) result.truncated = true;
    if (files.join("\0").length > 128000 || candidates.reduce((sum, item) => sum + item.stat!.size, 0) > 32 * 1024 * 1024) throw new Error("local.grep exceeds aggregate file/path work limit");
    // Safety checks apply even to binary files. Only verified text files are
    // passed to rg. Skipping nontext is enumeration policy, not a JS search.
    const snapshots: LocalPathSnapshot[] = [];
    for (const file of candidates) {
      this.#check(context);
      try { snapshots.push(this.#paths.read(file.path).snapshot); }
      catch (error) { if (!(error instanceof LocalNonTextError)) throw error; }
    }
    if (!snapshots.length) return result;
    const output = await this.#rg(["--json", "--max-count", String(limit + 1), ...(args.literal ? ["--fixed-strings"] : []), ...(args.ignoreCase ? ["--ignore-case"] : []), "--regexp", args.pattern as string, "--", ...snapshots.map((item) => item.path)], context);
    for (const snapshot of snapshots) this.#paths.revalidate(snapshot);
    for (const line of output.split("\n")) {
      if (!line) continue;
      const record = JSON.parse(line) as { type: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
      if (record.type !== "match") continue;
      if (result.matches.length >= limit) { result.truncated = true; break; }
      const data = record.data;
      if (typeof data?.path?.text !== "string" || !Number.isSafeInteger(data.line_number) || !data.line_number || typeof data.lines?.text !== "string") throw new Error("local rg returned unsupported non-UTF-8 match data");
      const text = data.lines.text.replace(/\r?\n$/u, "");
      result.matches.push({ path: this.#paths.relative(this.#paths.check(data.path.text).path), line: data.line_number, text: text.slice(0, 500) });
      if (text.length > 500) result.truncated = true;
      if (!this.#fits(result)) { result.matches.pop(); result.truncated = true; break; }
    }
    return this.#bounded(result);
  }
  #publish(name: string, entry: Prepared, context: FabricInvocationContext): unknown {
    const snapshot = entry.snapshot!;
    const proposed = entry.proposed!;
    this.#paths.revalidate(snapshot);
    this.#check(context);
    const sha256 = localHash(proposed);
    if (snapshot.file?.sha256 === sha256) return this.#bounded({ path: this.#paths.relative(snapshot.path), changed: false, sha256, bytes: Buffer.byteLength(proposed), identity: snapshot.file.identity });
    const temporary = path.join(path.dirname(snapshot.path), `.fabric-local-${randomUUID()}.tmp`);
    const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    const owned = localIdentity(fs.fstatSync(fd));
    let published = false;
    try {
      try {
        fs.writeFileSync(fd, proposed, "utf8");
        fs.fchmodSync(fd, snapshot.file ? snapshot.file.mode & 0o777 : 0o600);
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      this.#paths.revalidate(snapshot);
      this.#check(context);
      if (!sameLocalIdentity(fs.lstatSync(temporary), owned)) throw new Error("local temporary file identity changed");
      if (snapshot.file) fs.renameSync(temporary, snapshot.path);
      else { fs.linkSync(temporary, snapshot.path); }
      published = true;
      entry.committed = true;
      if (!snapshot.file) fs.unlinkSync(temporary);
      const actual = this.#paths.read(snapshot.path).snapshot.file!;
      if (actual.sha256 !== sha256 || !sameLocalIdentity(actual.identity, owned)) throw new Error("local published verification conflict");
      this.#check(context);
      return this.#bounded({ path: this.#paths.relative(snapshot.path), changed: true, sha256, bytes: actual.size, identity: actual.identity });
    } catch (error) {
      if (published) {
        const failure = new Error("local mutation committed; verification/acknowledgement failed; inspect file before retrying", { cause: error });
        Object.defineProperty(failure, FABRIC_COMMIT_ACKNOWLEDGEMENT, { value: { version: 1, operation: name } });
        throw failure;
      }
      throw error;
    } finally {
      // Remove only our own temporary inode, never an attacker replacement.
      try { if (sameLocalIdentity(fs.lstatSync(temporary), owned)) fs.unlinkSync(temporary); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          if (published) {
            const failure = new Error("local mutation committed; temporary cleanup failed; inspect before retrying", { cause: error });
            Object.defineProperty(failure, FABRIC_COMMIT_ACKNOWLEDGEMENT, { value: { version: 1, operation: name } });
            throw failure;
          }
          throw error;
        }
      }
    }
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.#controller.abort(new Error("local provider closed"));
    await Promise.allSettled([...this.#pending]);
    // Approval reservations are released by the registry, not by close while
    // a human prompt or process cleanup is still outstanding.
    for (const [token, entry] of this.#prepared) if (!entry.active) this.#prepared.delete(token);
  }
}
