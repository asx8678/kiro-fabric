import fs from "node:fs";
import { largestFittingInteger } from "../bounded-search.js";
import { applyLocalEditsWithRegions, type LocalEditRegion, type LocalTextEdit } from "./local-edit.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { throwIfAbortedOrExpired } from "../async-settlement.js";
import { schemaValidationMessage } from "../schema-validation.js";
import { canonicalPathContains } from "../kiro/canonical-path.js";
import { fabricJsonText, MAX_FABRIC_JSON_CHARS } from "../runtime/json-budget.js";
import { FABRIC_COMMIT_ACKNOWLEDGEMENT } from "../protocol.js";
import type { FabricActionDescriptor, FabricInvocationContext, FabricProvider } from "../protocol.js";
import type { LocalProviderOptions, LocalReadResult, LocalReadWindow, LocalShellInput, LocalGrepResult, LocalFindResult, LocalListResult, LocalShellResult } from "./local-contract.js";
import { LocalReadFailure, readManyWindows } from "./local-read-many.js";
import { formatLocalEvidence } from "./local-evidence.js";
import { LocalLineIndex } from "./local-line-index.js";
import { LOCAL_MAX_FILE_BYTES, LocalNonTextError, LocalPaths, localHash, localIdentity, sameLocalIdentity } from "./local-path.js";
import type { LocalPathSnapshot } from "./local-path.js";
import { runLocalShell } from "./local-shell.js";
import { initializeOwnedFile, type OwnedFile } from "./owned-file.js";
import { FabricDeadline } from "../runtime/deadline.js";
import { resolveSearchExecutable, verifySearchExecutable, searchEnvironment, type SearchExecutable } from "./local-executable.js";

// Fabric's bounded JSON/schema walkers intentionally reject shared graphs.
const jsonTree = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const object = (properties: Record<string, unknown>, required: string[] = []) => jsonTree({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string" };
const boolean = { type: "boolean" };
const integer = { type: "integer", minimum: 0 };
const identitySchema = object({ dev: integer, ino: integer }, ["dev", "ino"]);
const pathSchema = { type: "string", minLength: 1, maxLength: 4096 };
const count = { type: "integer", minimum: 1, maximum: 1000 };
const searchScopeSchema = object({ path: string, glob: string, hidden: boolean, ignoreFiles: { const: true }, snapshotScope: { const: "query-v1" } }, ["path", "hidden", "ignoreFiles"]);
const truncationSchema = { type: "array", maxItems: 4, items: { enum: ["match-text", "count", "output", "oversized-files"] } };
const VCS_METADATA = new Set([".git", ".hg", ".svn"]);
const metadataSchema = object({ token: { type: "string", minLength: 36, maxLength: 36 }, beforeSha256: { type: ["string", "null"] }, afterSha256: string, identity: { ...identitySchema, type: ["object", "null"] }, parentIdentity: identitySchema }, ["token"]);
const readWindowSchema = object({ path: pathSchema, offset: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, limit: { type: "integer", minimum: 1, maximum: 2000 }, expectedSha256: { type: "string", minLength: 64, maxLength: 64 } }, ["path"]);
const textEditSchema = object({ oldText: { type: "string", minLength: 1, maxLength: LOCAL_MAX_FILE_BYTES }, newText: { type: "string", maxLength: LOCAL_MAX_FILE_BYTES }, all: boolean }, ["oldText", "newText"]);
const rawSchemas: Record<string, Record<string, unknown>> = {
  read: object({ path: pathSchema, offset: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, limit: { type: "integer", minimum: 1, maximum: 2000 } }, ["path"]),
  readMany: object({ windows: { type: "array", minItems: 1, maxItems: 32, items: readWindowSchema }, maxChars: { type: "integer", minimum: 1000, maximum: 40000 }, partial: boolean }, ["windows"]),
  readEvidence: object({ windows: { type: "array", minItems: 1, maxItems: 32, items: readWindowSchema }, maxChars: { type: "integer", minimum: 1000, maximum: 40000 }, partial: boolean }, ["windows"]),
  grep: object({ pattern: { type: "string", maxLength: 2000 }, path: pathSchema, glob: { type: "string", minLength: 1, maxLength: 2000 }, literal: boolean, ignoreCase: boolean, hidden: boolean, limit: count, paginate: boolean, snapshotScope: { enum: ["query-v1"] }, cursor: { type: "string", minLength: 36, maxLength: 36 } }, ["pattern"]),
  find: object({ pattern: { type: "string", minLength: 1, maxLength: 2000 }, path: pathSchema, hidden: boolean, limit: count, paginate: boolean, snapshotScope: { enum: ["query-v1"] }, cursor: { type: "string", minLength: 36, maxLength: 36 } }, ["pattern"]),
  list: object({ path: pathSchema, limit: count }),
  write: object({ path: pathSchema, content: { type: "string", maxLength: LOCAL_MAX_FILE_BYTES }, overwrite: boolean, expectedSha256: { type: "string", minLength: 64, maxLength: 64 } }, ["path", "content"]),
  edit: object({ path: pathSchema, ...(textEditSchema.properties as Record<string, unknown>), edits: { type: "array", minItems: 1, maxItems: 100, items: textEditSchema }, expectedSha256: { type: "string", minLength: 64, maxLength: 64 } }, ["path", "expectedSha256"]),
  shell: object({ command: { type: "string", minLength: 1, maxLength: 8000 }, script: { type: "string", minLength: 1, maxLength: 8000 }, interpreter: { enum: ["bash", "sh"] }, args: { type: "array", maxItems: 64, items: { type: "string", maxLength: 8000 } }, cwd: pathSchema, timeoutMs: { type: "integer", minimum: 1, maximum: 900000 }, settle: boolean }),
};
const mutationOutput = object({ path: string, changed: boolean, sha256: string, bytes: integer, identity: identitySchema }, ["path", "changed", "sha256", "bytes", "identity"]);
const outputSchemas: Record<string, Record<string, unknown>> = {
  readEvidence: string,
  read: object({ path: string, text: string, totalLines: integer, truncated: boolean, nextOffset: { type: "integer", minimum: 1 }, sha256: string, identity: identitySchema, requestedRangeDelivered: boolean, fileExhausted: boolean }, ["path", "text", "totalLines", "truncated", "sha256", "identity", "requestedRangeDelivered", "fileExhausted"]),
  readMany: object({ files: { type: "array", maxItems: 32, items: object({ path: string, startLine: { type: "integer", minimum: 1 }, endLine: { type: ["integer", "null"] }, totalLines: integer, sha256: string, source: string, truncated: boolean, nextOffset: { type: "integer", minimum: 1 } }, ["path", "startLine", "endLine", "totalLines", "sha256", "source", "truncated"]) }, remaining: { type: "array", maxItems: 32, items: readWindowSchema }, complete: boolean, unreadTails: { type: "array", maxItems: 32, items: readWindowSchema }, failures: { type: "array", maxItems: 32, items: object({ index: { type: "integer", minimum: 0, maximum: 31 }, path: string, code: { enum: ["read", "stale-hash"] }, message: { type: "string", maxLength: 200 } }, ["index", "path", "code", "message"]) } }, ["files", "remaining", "complete", "unreadTails"]),
  grep: object({ scope: searchScopeSchema, matches: { type: "array", maxItems: 1000, items: object({ path: string, line: { type: "integer", minimum: 1 }, text: { type: "string", maxLength: 500 } }, ["path", "line", "text"]) }, truncated: boolean, scopeExhausted: boolean, truncationReasons: truncationSchema, nextCursor: string }, ["scope", "matches", "truncated", "scopeExhausted"]),
  find: object({ scope: searchScopeSchema, paths: { type: "array", maxItems: 1000, items: string }, truncated: boolean, scopeExhausted: boolean, truncationReasons: truncationSchema, nextCursor: string }, ["scope", "paths", "truncated", "scopeExhausted"]),
  list: object({ entries: { type: "array", maxItems: 1000, items: object({ path: string, type: { enum: ["file", "directory"] } }, ["path", "type"]) }, truncated: boolean }, ["entries", "truncated"]),
  write: mutationOutput, edit: mutationOutput,
  shell: object({ ok: boolean, exitCode: { type: ["integer", "null"] }, signal: { type: ["string", "null"] }, stdout: string, stderr: string, truncated: boolean, stdoutTruncated: boolean, stderrTruncated: boolean }, ["ok", "exitCode", "signal", "stdout", "stderr", "truncated", "stdoutTruncated", "stderrTruncated"]),
};
const descriptions: Record<string, string> = {
  readEvidence: "Explicit compact text packet: KIRO_LOCAL_EVIDENCE/1 header, numbered sources, final META JSON footer with ranges, full-file hashes, UTF-16 sourceOffset/sourceChars, remaining, unreadTails, complete and failures (always present). Same windows/defaults/path safety/partial failures/final snapshot checks as readMany. Default 32000/maxChars 1000..40000; full JSON-serialized returned string including escaping fits runtime and visible source allowances or rejects, never drops metadata. Continue remaining verbatim after repairing failures, then relevant unreadTails; tails may overlap remaining and omit prefixes/gaps. complete covers requested windows only; not proof of inspection. Return directly with resultFormat:text and headroom for other data/logs. No automatic inspection, steering or guaranteed delivery of discarded/remapped results.",
  read: "Read valid UTF-8, one-based offset; default 200/max 2000 lines, <=2MiB file, bounded JSON. Whole lines only; totalLines counts the whole file; truncated means unread file suffix. nextOffset is the next one-based line; stop at the requested end. requestedRangeDelivered states the requested range was returned; fileExhausted states no unread suffix remains. Oversized single lines fail. No traversal, symlinks, hardlinks or special files.",
  readMany: "Read 1..32 numbered source windows with line ranges and hashes. Default 200/max 2000 lines per window; 32000 aggregate JSON chars, maxChars 1000..40000, clamped to runtime budgets. Read related callers/implementations/configs together; lower maxChars when returning other data. Return files plus remaining requests; continue remaining verbatim. Hash conflicts reject by default. partial:true retains independent successes and zero-based indexed failures (read/stale-hash), complete:false and failed requests in remaining; repair failed requests before retrying. Safety, cancellation and final snapshot drift remain hard failures. Same-file windows reuse one invocation-local snapshot, revalidated before return. complete covers requested windows only. unreadTails contains hash-bound suffix windows (<=2000 lines) after the last delivered line per file snapshot; finish remaining first to avoid overlapping reads. Empty tails do not cover omitted prefixes/gaps or other files. Same path protections as read; no hidden persistent ledger.",
  grep: "Search with external rg, --no-config --sort path; hidden:true includes dotfiles (default false); respects ignore files, excludes VCS metadata and symlinks. Returned scope records path/glob/hidden/ignore rules; truncated:false is only complete within that scope, and scopeExhausted states that explicitly. Default 100/max 1000 records, text <=500 chars (truncated flags omissions). Binary/invalid UTF-8 files skipped; >2MiB files skipped with truncated=true. Pinned startup-validated executable. Selected candidates <=10000; batches <=256 text files/2MiB stop at requested prefix with truncated=true for unsearched files. Aggregate input <=32MiB; search <=10s; narrow path/glob on work limits. No JS search fallback. truncationReasons: match-text => read the reported line; count => increase limit or narrow scope; output => narrow scope; oversized-files => exclude or inspect separately. paginate:true enables bounded snapshot pages; repeat identical query/options/limit with cursor:nextCursor. Cursors expire after 60s; provider-local, at most 8 snapshots, 262144 JSON chars each. Collection rejects work/cache limits and nontext/oversized snapshot files; count/output are resumable, match-text is not. Optional snapshotScope:query-v1 (paginate only) hashes glob-selected candidates, not unrelated files, and reports scope.snapshotScope. Selected membership/content/identity changes still reject; defaults retain unfiltered-scope validation.",
  find: "Glob file paths via external rg --files --no-config --sort path; hidden:true includes dotfiles (default false); respects ignore files, excludes VCS metadata and symlinks. Returned scope records path/glob/hidden/ignore rules; truncated:false is only complete within that scope, and scopeExhausted states that explicitly. Default 100/max 1000 results. Unsafe files rejected. Glob only narrows normal enumeration; selected candidates <=10000, raw process output <=2MiB; search <=10s. Narrow path/glob on work limits. truncationReasons: count => increase limit or narrow scope; output => narrow scope. paginate:true enables bounded snapshot pages; repeat identical query/options/limit with cursor:nextCursor. Cursors expire after 60s; provider-local, at most 8 snapshots, 262144 JSON chars each. Collection rejects work/cache limits and nontext/oversized snapshot files; count/output are resumable, match-text is not. Optional snapshotScope:query-v1 (paginate only) hashes glob-selected candidates, not unrelated files, and reports scope.snapshotScope. Selected membership/content/identity changes still reject; defaults retain unfiltered-scope validation.",
  list: "Sorted direct children, including hidden entries; only path/limit, no depth. Use local.find for nested files. Default 100/max 1000 results, at most 10000 scanned entries. Symlinks, hardlinks and special entries fail.",
  write: "Exact approved write, create-only unless overwrite=true; existing parent required. Replacing an existing file requires expectedSha256 from the read of the file being replaced, so an unbound or stale version is rejected before approval; create-only writes omit it. Snapshots bind identities/content and complete diff before approval; revalidated before publication. Path checks are defense in depth, not hostile-race isolation.",
  edit: "Exact approved edit: oldText/newText OR edits[1..100], required expectedSha256 from the read that supplied the anchors. All anchors resolve against that snapshot, must be disjoint, and validate before one complete multi-hunk approval/publication; unchanged text between hunks is summarized while changed text is never omitted; unique unless per-edit all=true. Existing parent required. Identity/hash conflict detection and complete actual per-hunk diff; no multi-operation transaction or hostile-race isolation.",
  shell: "Exact approved host command OR literal script in verified canonical cwd, not confinement. command uses /bin/sh; script uses interpreter bash/sh (default sh), args become positional $1... without outer expansion or scratch files. Workspace-wide lock, bounded head/tail output and deadline, TERM/KILL cleanup; ordinary nonzero exits expose error.result or return data with settle=true; no background jobs or network isolation. Deliberate process-group escapes are not contained.",
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
 * <=2MiB rg stdout/stderr, 10s rg timeout, result JSON <=min(20000,budget),
 * except readMany/readEvidence <=min(40000,budget,visible source allowance).
 * Search ignore files may affect enumeration; explicit roots must be safe.
 * Node pathname revalidation does not close malicious same-user TOCTOU races. */
export class LocalCodingProvider implements FabricProvider {
  readonly name = "local";
  readonly description = "Verified workspace local coding with bounded reads and exact approved effects";
  readonly #paths: LocalPaths;
  readonly #lockRoot: string;
  readonly #lockIdentity: ReturnType<typeof localIdentity>;
  readonly #budget: number;
  readonly #readManyBudget: number;
  readonly #descriptors: FabricActionDescriptor[];
  readonly #controller = new AbortController();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #prepared = new Map<string, Prepared>();
  readonly #searchPages = new Map<string, { key: string; fingerprint: string; result: LocalFindResult | LocalGrepResult; offset: number; expires: number }>();
  #closed = false;
  #pendingRelease: (() => void) | undefined;
  readonly #searchExecutable: SearchExecutable;

  constructor(options: LocalProviderOptions) {
    this.#paths = new LocalPaths(options.root);
    this.#searchExecutable = resolveSearchExecutable(options.managedSearch);
    this.#budget = Math.min(20000, options.maxResultChars ?? 20000);
    if (!Number.isSafeInteger(this.#budget) || this.#budget < 256) throw new Error("local maxResultChars must be an integer >=256");
    if (options.maxReadManyChars !== undefined && (!Number.isSafeInteger(options.maxReadManyChars) || options.maxReadManyChars < 256)) throw new Error("local maxReadManyChars must be an integer >=256");
    this.#readManyBudget = Math.min(40000, options.maxResultChars ?? 40000, options.maxReadManyChars ?? 40000);
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
  discoveryRevision(): string { return "1"; }
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
    // Keep the generic schema walker bounded; enforce these trusted, constant
    // semantic constraints here rather than introducing delegated combinators.
    if (name === "shell" && ((typeof args.command === "string") === (typeof args.script === "string") ||
        (typeof args.command === "string" && (args.interpreter !== undefined || args.args !== undefined)))) {
      throw new Error("local.shell requires exactly one of command or script; interpreter/args require script");
    }
    if ((name === "find" || name === "grep") && args.snapshotScope !== undefined && args.paginate !== true) throw new Error("local search snapshotScope requires paginate:true");
    if (name === "edit") {
      const batch = args.edits !== undefined;
      if (batch ? args.oldText !== undefined || args.newText !== undefined || args.all !== undefined : typeof args.oldText !== "string" || typeof args.newText !== "string") throw new Error("local.edit requires exactly one of edits or oldText/newText");
      if (args.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(args.expectedSha256 as string)) throw new Error("local.edit expectedSha256 must be a lowercase SHA-256 digest");
    }
    if (name === "write" && args.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(args.expectedSha256 as string)) throw new Error("local.write expectedSha256 must be a lowercase SHA-256 digest");
    if ((name === "readMany" || name === "readEvidence") && (args.windows as LocalReadWindow[]).some(window =>
      window.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(window.expectedSha256))) {
      throw new Error(`local.${name} expectedSha256 must be a lowercase SHA-256 digest`);
    }
  }
  #fits(value: unknown, budget = this.#budget): boolean { return JSON.stringify(value).length <= budget; }
  #bounded<T>(value: T, budget = this.#budget): T {
    if (!this.#fits(value, budget)) throw new Error("local typed result metadata exceeds configured result budget");
    return value;
  }
  async prepareArguments(name: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<Record<string, unknown>> {
    this.#validate(name, args);
    this.#check(context);
    const canonical = structuredClone(args);
    if (!effectful(name)) {
      if (name === "readMany" || name === "readEvidence") {
        canonical.windows = (args.windows as LocalReadWindow[]).map(window => ({ ...window, path: this.#readWindowPath(window.path, args.partial === true) }));
        return canonical;
      }
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
      const shellValues = [args.command ?? args.script, ...((args.args as string[] | undefined) ?? [])];
      if (shellValues.some(value => (value as string).includes("\0"))) throw new Error("local shell input must not contain NUL");
      const sourceReview = typeof args.command === "string" ? `Command: ${JSON.stringify(args.command)}`
        : `Interpreter: ${args.interpreter ?? "sh"}\nScript: ${JSON.stringify(args.script)}\nArguments: ${JSON.stringify(args.args ?? [])}`;
      review = `${sourceReview}\nCanonical cwd: ${JSON.stringify(directory.path)}\nTimeout ms: ${canonical.timeoutMs}\nSettle ordinary nonzero: ${canonical.settle}`;
      metadata = { token, identity: directory.identity, parentIdentity: directory.parents.at(-1)!.identity };
      entry = { name, signature: "", directory, active: false };
    } else {
      const captured = this.#paths.snapshot(args.path as string);
      canonical.path = captured.snapshot.path;
      if (name === "write" && captured.snapshot.file && args.overwrite !== true) throw new Error("local.write is create-only; existing file requires overwrite=true");
      if (name === "edit" && !captured.snapshot.file) throw new Error("local.edit requires an existing file");
      // Snapshot binding is the normal path: an edit or an existing-file
      // replacement must name the exact version the caller read. The error
      // never reveals the current hash, so recovery requires an actual reread.
      const expectedSha256 = args.expectedSha256 as string | undefined;
      if (name === "write") {
        if (captured.snapshot.file) {
          if (expectedSha256 === undefined) throw new Error("local.write overwrite requires expectedSha256 from the read of the file being replaced; reread the current file first");
          if (expectedSha256 !== captured.snapshot.file.sha256) throw new Error("local.write source changed: expectedSha256 conflict; reread before recovery");
        } else if (expectedSha256 !== undefined) throw new Error("local.write expectedSha256 cannot bind a missing file; omit it for create-only writes");
      }
      let proposed: string;
      let regions: LocalEditRegion[];
      if (name === "write") {
        proposed = args.content as string;
        regions = [{ beforeStart: 0, beforeEnd: captured.text.length, afterStart: 0, afterEnd: proposed.length }];
      } else {
        if (expectedSha256 !== captured.snapshot.file!.sha256) throw new Error("local.edit source changed: expectedSha256 conflict; reread before recovery");
        const applied = applyLocalEditsWithRegions(captured.text, (args.edits as LocalTextEdit[] | undefined) ?? [{ oldText: args.oldText as string, newText: args.newText as string, all: args.all === true }]);
        proposed = applied.text;
        regions = applied.regions;
      }
      if (Buffer.byteLength(proposed) > LOCAL_MAX_FILE_BYTES || proposed.includes("\0") || Buffer.from(proposed).toString("utf8") !== proposed) throw new Error("local proposed content must be valid UTF-8 text <=2MiB without NUL");
      review = this.#review(captured.snapshot.path, captured.text, proposed, regions);
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
  #review(target: string, before: string, after: string, regions: readonly LocalEditRegion[]): string {
    const label = JSON.stringify(this.#paths.relative(target));
    const header = `Canonical path: ${JSON.stringify(target)}\n--- ${label} sha256:${localHash(before)}\n+++ ${label} sha256:${localHash(after)}`;
    if (before === after) return `${header}\nNo content change`;
    // Trim only identical edges within each resolved occurrence, never changed
    // text. Keep UTF-16 coordinates to match exact JavaScript string edits.
    const changes: LocalEditRegion[] = [];
    for (const region of regions) {
      let { beforeStart, beforeEnd, afterStart, afterEnd } = region;
      while (beforeStart < beforeEnd && afterStart < afterEnd && before[beforeStart] === after[afterStart]) { beforeStart++; afterStart++; }
      while (beforeEnd > beforeStart && afterEnd > afterStart && before[beforeEnd - 1] === after[afterEnd - 1]) { beforeEnd--; afterEnd--; }
      if (beforeStart !== beforeEnd || afterStart !== afterEnd) changes.push({ beforeStart, beforeEnd, afterStart, afterEnd });
    }
    // Hunk coordinates are monotonic: scan each source at most once rather
    // than rescanning its prefix for every line number (including all=true).
    const lineCounter = (text: string) => {
      let position = 0, line = 1;
      return (end: number): number => {
        while (position < end) if (text.charCodeAt(position++) === 10) line++;
        return line;
      };
    };
    const beforeLine = lineCounter(before), afterLine = lineCounter(after);
    const sections = [header];
    let cursor = 0, reviewChars = header.length;
    for (const [index, change] of changes.entries()) {
      const { beforeStart, beforeEnd, afterStart, afterEnd } = change;
      // Context is unchanged, shown only once, and bounded both by characters
      // and line breaks. Never label a neighbouring edit as unchanged context.
      let contextStart = beforeStart, contextEnd = beforeEnd, lines = 0;
      while (contextStart > cursor && beforeStart - contextStart < 200) {
        if (before.charCodeAt(contextStart - 1) === 10) {
          if (lines === 3) break;
          lines++;
        }
        contextStart--;
      }
      const nextStart = changes[index + 1]?.beforeStart ?? before.length;
      lines = 0;
      while (contextEnd < nextStart && contextEnd - beforeEnd < 200 && lines < 3) {
        if (before.charCodeAt(contextEnd++) === 10) lines++;
      }
      const omitted = contextStart - cursor;
      const section: string[] = [];
      if (omitted > 0) {
        const startLine = beforeLine(cursor), endLine = beforeLine(contextStart);
        section.push(`${index === 0 ? "Unchanged prefix" : "Unchanged region"} omitted: ${omitted} UTF-16 chars (${endLine - startLine} line breaks; original lines ${startLine}-${endLine})`);
      }
      section.push(
        `@@ change ${index + 1}/${changes.length}: original lines ${beforeLine(beforeStart)}-${beforeLine(beforeEnd)}, UTF-16 [${beforeStart},${beforeEnd}); proposed lines ${afterLine(afterStart)}-${afterLine(afterEnd)}, UTF-16 [${afterStart},${afterEnd}) @@`,
        ` context-before ${JSON.stringify(before.slice(contextStart, beforeStart))}`,
        `-${JSON.stringify(before.slice(beforeStart, beforeEnd))}`,
        `+${JSON.stringify(after.slice(afterStart, afterEnd))}`,
        ` context-after ${JSON.stringify(before.slice(beforeEnd, contextEnd))}`,
      );
      const text = section.join("\n");
      reviewChars += text.length + 1;
      // Fail closed rather than truncating changes; also bound work for many
      // occurrences before assembling an oversized approval string.
      if (reviewChars > 11000) throw new Error("local exact review exceeds 11000-character approval budget");
      sections.push(text);
      cursor = contextEnd;
    }
    if (cursor < before.length) sections.push(`Unchanged suffix omitted: ${before.length - cursor} UTF-16 chars`);
    return sections.join("\n");
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
    try { this.#pendingRelease?.(); }
    catch (error) { throw new Error("local workspace lock unavailable; uncertain cleanup from previous invocation", { cause: error }); }
    const { token, entry } = this.#preparedEntry(name, args);
    if (entry.active) throw new Error("local invocation is already reserved");
    this.#verifyLockRoot();
    const lock = path.join(this.#lockRoot, `local-${localHash(this.#paths.root)}.lock`);
    const owned: OwnedFile = { created: false };
    let released = false;
    const release = (): void => {
      if (released) return;
      try {
        this.#verifyLockRoot();
        if (!owned.identity) throw new Error("uncertain local lock: ownership identity unavailable; operator recovery required");
        try {
          const stat = fs.lstatSync(lock);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !sameLocalIdentity(stat, owned.identity)) throw new Error("local lock ownership changed; refusing to release uncertain lock");
          fs.unlinkSync(lock);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        released = true;
        entry.active = false;
        this.#prepared.delete(token);
        if (this.#pendingRelease === release) this.#pendingRelease = undefined;
      } catch (error) {
        this.#pendingRelease = release;
        if (entry.committed) {
          const failure = new Error("local mutation committed; lock release failed; inspect before retrying", { cause: error });
          Object.defineProperty(failure, FABRIC_COMMIT_ACKNOWLEDGEMENT, { value: { version: 1, operation: name } });
          throw failure;
        }
        throw new Error("uncertain local lock cleanup; ownership responsibility retained", { cause: error });
      }
    };
    try {
      initializeOwnedFile(lock, owned, (fd) => {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, root: this.#paths.root }));
      });
      this.#verifyLockRoot();
    } catch (error) {
      if (!owned.created) throw new Error("local workspace lock unavailable; concurrent or uncertain owner (never automatically broken)", { cause: error });
      try { release(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "local lock initialization failed; uncertain cleanup", { cause: error }); }
      throw error;
    }
    entry.active = true;
    return release;
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
        const input: LocalShellInput = typeof args.command === "string" ? { command: args.command } : { script: args.script as string, interpreter: (args.interpreter ?? "sh") as "bash" | "sh", args: (args.args ?? []) as string[] };
        const result: LocalShellResult = await runLocalShell({ ...input, cwd: args.cwd as string, maxOutputChars: this.#budget, signal: context.signal ? AbortSignal.any([context.signal, this.#controller.signal]) : this.#controller.signal, ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {}), ...(typeof args.settle === "boolean" ? { settle: args.settle } : {}), ...(context.deadline ? { deadline: context.deadline } : {}) });
        this.#check(context);
        return this.#bounded(result);
      }
      return this.#publish(name, entry, context);
    }
    if (name === "read") return this.#read(args);
    if (name === "readMany" || name === "readEvidence") {
      const windows = (args.windows as LocalReadWindow[]).map(window => ({ ...window, path: this.#paths.relative(this.#readWindowPath(window.path, args.partial === true)) }));
      const budget = Math.min(this.#readManyBudget, (args.maxChars as number | undefined) ?? 32000,
        name === "readEvidence" ? context.maxResultChars ?? this.#readManyBudget : this.#readManyBudget);
      const snapshots = new Map<string, ReturnType<LocalPaths["read"]> & { lines: LocalLineIndex }>();
      const result = readManyWindows(windows, budget, window => {
        this.#check(context);
        let captured = snapshots.get(window.path);
        if (!captured) {
          try {
            const source = this.#paths.read(window.path);
            captured = { ...source, lines: new LocalLineIndex(source.text) };
          }
          catch (error) {
            if (args.partial === true && (error instanceof LocalNonTextError || ["ENOENT", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))) throw new LocalReadFailure(`local.${name} ordinary read failure`, { cause: error });
            throw error;
          }
          snapshots.set(window.path, captured);
        }
        return this.#read({ ...window }, budget, captured);
      }, args.partial === true, name === "readEvidence" ? { serialize: formatLocalEvidence, operation: "local.readEvidence" } : {});
      for (const captured of snapshots.values()) { this.#check(context); this.#paths.revalidate(captured.snapshot); }
      return this.#bounded(name === "readEvidence" ? formatLocalEvidence(result) : result, budget);
    }
    if (name === "list") return this.#list(args);
    if (name === "find" || name === "grep") return await this.#search(name, args, context);
    throw new Error(`Unknown local action: ${name}`);
  }
  #read(args: Record<string, unknown>, budget = this.#budget, captured?: ReturnType<LocalPaths["read"]> & { lines: LocalLineIndex }): LocalReadResult {
    const { text, snapshot } = captured ?? this.#paths.read(args.path as string);
    const lines = captured?.lines ?? new LocalLineIndex(text);
    const start = ((args.offset as number | undefined) ?? 1) - 1;
    const end = Math.min(lines.totalLines, start + ((args.limit as number | undefined) ?? 200));
    const empty: LocalReadResult = { path: this.#paths.relative(snapshot.path), text: "", totalLines: lines.totalLines, truncated: false, sha256: snapshot.file!.sha256, identity: snapshot.file!.identity, requestedRangeDelivered: true, fileExhausted: true };
    this.#bounded(empty, budget);
    if (start >= end) return empty;
    const page = (count: number): LocalReadResult => {
      const truncated = start + count < lines.totalLines;
      return {
        ...empty, text: lines.slice(start, start + count), truncated,
        // Requested-range delivery and file exhaustion stay unambiguous even
        // when the caller requested only part of a longer file.
        requestedRangeDelivered: !truncated || start + count >= end,
        fileExhausted: !truncated,
        ...(truncated ? { nextOffset: start + count + 1 } : {}),
      };
    };
    // Test EOF first: removing continuation metadata can make the last page
    // smaller. All remaining candidates retain it and have monotone sizes.
    const complete = page(end - start);
    if (this.#fits(complete, budget)) return complete;
    const low = largestFittingInteger(0, end - start - 1, count => this.#fits(page(count), budget));
    if (!low) throw new Error("local.read single line exceeds configured character budget");
    return this.#bounded(page(low), budget);
  }
  #readWindowPath(input: string, partial: boolean): string {
    try { return this.#paths.check(input).path; }
    catch (error) {
      if (!partial || !["ENOENT", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      return this.#paths.resolve(input);
    }
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
      // Stop inspecting entries once the requested page is filled. An unsafe
      // entry beyond the limit is never returned, so it must not fail the read.
      if (result.entries.length >= limit) { result.truncated = true; continue; }
      const found = this.#paths.check(path.join(directory.path, name));
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
    verifySearchExecutable(this.#searchExecutable);
    const output = await new Promise<string>((resolve, reject) => {
      execFile(this.#searchExecutable.path, ["--no-config", "--sort", "path", ...args], { cwd: this.#paths.root, env: searchEnvironment(), encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: Math.max(1, Math.min(10000, Math.floor(context.deadline?.remainingMs() ?? 10000))), killSignal: "SIGKILL", signal }, (error, stdout, stderr) => {
        if (!error || (error.code === 1 && !error.killed)) resolve(stdout);
        else if (error.code === "ENOENT") reject(new Error("ripgrep (rg) is required for local.grep/local.find but was not found"));
        else reject(new Error(`local rg failed or exceeded bounded work/output: ${String(error.code)} ${stderr.slice(0, 500)}`, { cause: error }));
      });
    });
    this.#check(context);
    return output;
  }
  async #selectSearch(name: string, args: Record<string, unknown>, context: FabricInvocationContext) {
    const base = this.#paths.check((args.path as string | undefined) ?? ".");
    const glob = name === "find" ? args.pattern as string : args.glob as string | undefined;
    const relative = this.#paths.relative(base.path) || ".";
    if (relative.split("/").some(part => VCS_METADATA.has(part))) throw new Error("local search excludes VCS metadata");
    const scope = { path: relative, ...(glob ? { glob } : {}), hidden: args.hidden === true, ignoreFiles: true as const,
      ...(args.snapshotScope === "query-v1" ? { snapshotScope: "query-v1" as const } : {}) };
    // Opting into dotfiles does not opt into repository internals or ignored data.
    const enumerationArgs = ["--files", "--null", ...(scope.hidden ? ["--hidden"] : []),
      ...[...VCS_METADATA].flatMap(name => ["--glob", `!**/${name}`, "--glob", `!**/${name}/**`])];
    const enumeration = await this.#rg([...enumerationArgs, "--", base.path], context);
    let files = enumeration.split("\0").filter(Boolean);
    if (!glob && files.length > 10000) throw new Error("local search exceeded 10000-file work limit; narrow path or glob");
    if (glob && glob !== "**/*") {
      // The all-files manifest needs no second rg launch or executable hash.
      // Positive rg globs can override hidden/ignore rules. Intersect with the
      // normal enumeration so a glob only narrows scope, never expands it.
      const filtered = await this.#rg([...enumerationArgs, "--glob", glob, "--", base.path], context);
      const selected = new Set(filtered.split("\0").filter(Boolean));
      files = files.filter((file) => selected.has(file));
    }
    if (files.length > 10000) throw new Error("local search exceeded 10000-file work limit; narrow path or glob");
    const checked = files.map((file) => { this.#check(context); return this.#paths.check(file); });
    for (const file of checked) if (!file.stat?.isFile()) throw new Error("local search requires regular files");
    return { scope, files, checked };
  }
  async #search(name: string, args: Record<string, unknown>, context: FabricInvocationContext, collect = false): Promise<LocalFindResult | LocalGrepResult> {
    if (args.cursor !== undefined && args.paginate !== true) throw new Error("local search cursor requires paginate:true");
    if (args.paginate === true && !collect) return this.#searchPage(name, args, context);
    const searchMs = Math.max(1, Math.min(10000, context.deadline?.remainingMs() ?? 10000));
    context = { ...context, deadline: new FabricDeadline(searchMs, searchMs) };
    const { scope, files, checked } = await this.#selectSearch(name, args, context);
    const limit = collect ? 10001 : (args.limit as number | undefined) ?? 100;
    const finish = <T extends LocalFindResult | LocalGrepResult>(value: T): T => {
      value.scopeExhausted = !value.truncated;
      return this.#bounded(value, collect ? 262144 : this.#budget);
    };
    const mark = (result: LocalFindResult | LocalGrepResult, reason: NonNullable<LocalGrepResult["truncationReasons"]>[number]): void => {
      result.truncated = true;
      result.scopeExhausted = false;
      result.truncationReasons ??= [];
      if (!result.truncationReasons.includes(reason)) result.truncationReasons.push(reason);
    };
    // Reserve bounded metadata space before accepting a record.
    const searchFits = (result: LocalFindResult | LocalGrepResult): boolean => this.#fits({ ...result, truncationReasons: ["match-text", "count", "output", "oversized-files"] }, collect ? 262144 : this.#budget);
    if (name === "find") {
      const result: LocalFindResult = { scope, paths: [], truncated: false, scopeExhausted: true };
      for (const file of checked) {
        if (result.paths.length >= limit) { mark(result, "count"); break; }
        result.paths.push(this.#paths.relative(file.path));
        if (!searchFits(result)) { result.paths.pop(); mark(result, "output"); break; }
      }
      return finish(result);
    }
    const result: LocalGrepResult = { scope, matches: [], truncated: false, scopeExhausted: true };
    if (!files.length) return finish(result);
    const candidates = checked.filter((item) => item.stat!.size <= LOCAL_MAX_FILE_BYTES);
    if (candidates.length !== checked.length) mark(result, "oversized-files");
    let searchedBytes = 0;
    let searchedPathChars = 0;
    let outputBytes = 0;
    // Validate selected aliases above; snapshot/search bounded batches only.
    // Amortize rg launch + executable hashing over up to 256 small files, still
    // capped at 2MiB per batch and 128000 UTF-8 argv bytes across the search.
    // Revalidate consumed snapshots before exposing results. Disclose unsearched files.
    for (let index = 0; index < candidates.length;) {
      const snapshots: LocalPathSnapshot[] = [];
      let batchBytes = 0;
      while (index < candidates.length && snapshots.length < 256) {
        const file = candidates[index]!;
        if (snapshots.length && batchBytes + file.stat!.size > LOCAL_MAX_FILE_BYTES) break;
        index++;
        this.#check(context);
        searchedBytes += file.stat!.size;
        searchedPathChars += Buffer.byteLength(file.path) + 1;
        if (searchedBytes > 32 * 1024 * 1024 || searchedPathChars > 128000) throw new Error("local.grep exceeded aggregate search work limit; narrow path or glob");
        batchBytes += file.stat!.size;
        try { snapshots.push(this.#paths.read(file.path).snapshot); }
        catch (error) { if (!(error instanceof LocalNonTextError)) throw error; }
      }
      if (!snapshots.length) continue;
      const output = await this.#rg(["--json", "--max-count", String(limit - result.matches.length + 1), ...(args.literal ? ["--fixed-strings"] : []), ...(args.ignoreCase ? ["--ignore-case"] : []), "--regexp", args.pattern as string, "--", ...snapshots.map((item) => item.path)], context);
      outputBytes += Buffer.byteLength(output);
      if (outputBytes > 2 * 1024 * 1024) throw new Error("local rg exceeded bounded work/output; narrow path or glob");
      for (const snapshot of snapshots) this.#paths.revalidate(snapshot);
      for (const line of output.split("\n")) {
        if (!line) continue;
        const record = JSON.parse(line) as { type: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
        if (record.type !== "match") continue;
        if (result.matches.length >= limit) { mark(result, "count"); return finish(result); }
        const data = record.data;
        if (typeof data?.path?.text !== "string" || !Number.isSafeInteger(data.line_number) || !data.line_number || typeof data.lines?.text !== "string") throw new Error("local rg returned unsupported non-UTF-8 match data");
        const text = data.lines.text.replace(/\r?\n$/u, "");
        result.matches.push({ path: this.#paths.relative(this.#paths.check(data.path.text).path), line: data.line_number, text: text.slice(0, 500) });
        if (text.length > 500) mark(result, "match-text");
        if (!searchFits(result)) { result.matches.pop(); mark(result, "output"); return finish(result); }
      }
      if (result.matches.length >= limit && index < candidates.length) { mark(result, "count"); break; }
    }
    return finish(result);
  }
  async #searchFingerprint(name: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<string> {
    const base = this.#paths.check((args.path as string | undefined) ?? ".");
    const enumerationArgs = ["--files", "--null", ...(args.hidden ? ["--hidden"] : []), ...[...VCS_METADATA].flatMap(name => ["--glob", `!**/${name}`, "--glob", `!**/${name}/**`]), "--", base.path];
    // Default retains the whole-enumeration contract. Query-v1 explicitly
    // binds only glob-selected files (including nonmatching grep candidates).
    // Re-enumeration still applies hidden/ignore/VCS rules on every page.
    const enumerate = async (): Promise<string> => args.snapshotScope === "query-v1"
      ? (await this.#selectSearch(name, args, context)).files.join("\0")
      : this.#rg(enumerationArgs, context);
    const output = await enumerate();
    const files = output.split("\0").filter(Boolean);
    if (files.length > 10000) throw new Error("local snapshot exceeds 10000-file work limit");
    let bytes = 0;
    let metadataChars = 0;
    const hashes: string[] = [];
    const snapshots: LocalPathSnapshot[] = [];
    for (const file of files) {
      this.#check(context);
      const checked = this.#paths.check(file);
      bytes += checked.stat!.size;
      if (bytes > 32 * 1024 * 1024) throw new Error("local snapshot exceeds 32MiB work limit");
      const snapshot = this.#paths.read(file).snapshot;
      hashes.push(JSON.stringify(snapshot));
      snapshots.push(snapshot);
      metadataChars += hashes[hashes.length - 1]!.length;
      if (metadataChars > 2 * 1024 * 1024) throw new Error("local snapshot metadata work limit");
    }
    // A resume must not publish cached records if an earlier file changed while
    // later files were fingerprinted, or enumeration changed during capture.
    if (await enumerate() !== output) throw new Error("local search snapshot enumeration drift during validation");
    for (const snapshot of snapshots) { this.#check(context); this.#paths.revalidate(snapshot); }
    this.#check(context);
    return localHash(JSON.stringify([base.path, hashes]));
  }
  async #searchPage(name: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<LocalFindResult | LocalGrepResult> {
    const ms = Math.max(1, Math.min(10000, context.deadline?.remainingMs() ?? 10000));
    context = { ...context, deadline: new FabricDeadline(ms, ms) };
    const now = Date.now();
    for (const [token, entry] of this.#searchPages) if (entry.expires <= now) this.#searchPages.delete(token);
    const key = JSON.stringify([this.#paths.root, name, Object.entries(args).filter(([key]) => key !== "cursor").sort(([a], [b]) => a.localeCompare(b))]);
    let entry = args.cursor ? this.#searchPages.get(args.cursor as string) : undefined;
    if (args.cursor && (!entry || entry.key !== key)) throw new Error("local search cursor invalid, expired, or query/provider mismatch");
    // A fresh request against a full cache is rejected before any workspace
    // enumeration or hashing. The identical guard below is still required: under
    // concurrency every caller can pass this check before any of them inserts.
    if (!entry && this.#searchPages.size >= 8) throw new Error("local search snapshot cache limit; wait for expiry");
    const fingerprint = await this.#searchFingerprint(name, args, context);
    if (entry && entry.fingerprint !== fingerprint) throw new Error("local search snapshot drift; restart pagination");
    if (!entry) {
      if (this.#searchPages.size >= 8) throw new Error("local search snapshot cache limit; wait for expiry");
      const result = await this.#search(name, args, context, true);
      if (result.truncationReasons?.some(reason => reason !== "match-text")) throw new Error("local search snapshot collection incomplete: work/cache limit or nonresumable omission; narrow scope");
      if (await this.#searchFingerprint(name, args, context) !== fingerprint) throw new Error("local search snapshot drift during collection");
      entry = { key, fingerprint, result, offset: 0, expires: now + 60000 };
    }
    // Copy only the page, not the entire cached 262144-character result.
    // No mutable scope/record/array from the cache is exposed to callers.
    const result: LocalFindResult | LocalGrepResult = "paths" in entry.result
      ? { scope: { ...entry.result.scope }, paths: [], truncated: true, scopeExhausted: false }
      : { scope: { ...entry.result.scope }, matches: [], truncated: true, scopeExhausted: false };
    const records = "paths" in result ? result.paths : result.matches;
    const all = "paths" in entry.result ? entry.result.paths : entry.result.matches;
    const next = randomUUID();
    result.nextCursor = next;
    result.truncated = true;
    result.truncationReasons = [...(entry.result.truncationReasons ?? []), "count", "output"];
    let offset = entry.offset;
    while (offset < all.length && records.length < ((args.limit as number | undefined) ?? 100)) {
      const record = all[offset]!;
      (records as unknown[]).push(typeof record === "string" ? record : { ...record });
      if (!this.#fits(result)) { records.pop(); break; }
      offset++;
    }
    if (offset === entry.offset && offset < all.length) throw new Error("local search record exceeds output budget; cannot advance cursor");
    result.truncationReasons = [...(entry.result.truncationReasons ?? [])];
    if (offset < all.length) result.truncationReasons.push(records.length === ((args.limit as number | undefined) ?? 100) ? "count" : "output");
    else delete result.nextCursor;
    result.truncated = result.truncationReasons.length > 0;
    result.scopeExhausted = !result.truncated;
    if (!result.truncationReasons.length) delete result.truncationReasons;
    this.#check(context);
    if (Date.now() >= entry.expires) throw new Error("local search cursor expired");
    this.#bounded(result);
    if (args.cursor && this.#searchPages.get(args.cursor as string) !== entry) throw new Error("local search cursor already consumed");
    if (args.cursor) this.#searchPages.delete(args.cursor as string);
    if (result.nextCursor) {
      if (this.#searchPages.size >= 8) throw new Error("local search snapshot cache limit");
      this.#searchPages.set(next, { ...entry, offset });
    }
    return result;
  }
  #publish(name: string, entry: Prepared, context: FabricInvocationContext): unknown {
    const snapshot = entry.snapshot!;
    const proposed = entry.proposed!;
    this.#paths.revalidate(snapshot);
    this.#check(context);
    const sha256 = localHash(proposed);
    if (snapshot.file?.sha256 === sha256) return this.#bounded({ path: this.#paths.relative(snapshot.path), changed: false, sha256, bytes: Buffer.byteLength(proposed), identity: snapshot.file.identity });
    const temporary = path.join(path.dirname(snapshot.path), `.fabric-local-${randomUUID()}.tmp`);
    const owned: OwnedFile = { created: false };
    let published = false;
    let operationError: unknown;
    try {
      initializeOwnedFile(temporary, owned, (fd) => {
        fs.writeFileSync(fd, proposed, "utf8");
        fs.fchmodSync(fd, snapshot.file ? snapshot.file.mode & 0o777 : 0o600);
        fs.fsyncSync(fd);
      });
      this.#paths.revalidate(snapshot);
      this.#check(context);
      if (!sameLocalIdentity(fs.lstatSync(temporary), owned.identity!)) throw new Error("local temporary file identity changed");
      if (snapshot.file) fs.renameSync(temporary, snapshot.path);
      else { fs.linkSync(temporary, snapshot.path); }
      published = true;
      entry.committed = true;
      if (!snapshot.file) fs.unlinkSync(temporary);
      const actual = this.#paths.read(snapshot.path).snapshot.file!;
      if (actual.sha256 !== sha256 || !sameLocalIdentity(actual.identity, owned.identity!)) throw new Error("local published verification conflict");
      this.#check(context);
      return this.#bounded({ path: this.#paths.relative(snapshot.path), changed: true, sha256, bytes: actual.size, identity: actual.identity });
    } catch (error) {
      operationError = error;
      if (published) {
        const failure = new Error("local mutation committed; verification/acknowledgement failed; inspect file before retrying", { cause: error });
        Object.defineProperty(failure, FABRIC_COMMIT_ACKNOWLEDGEMENT, { value: { version: 1, operation: name } });
        throw failure;
      }
      throw error;
    } finally {
      // Remove only our own temporary inode, never an attacker replacement.
      try {
        if (owned.created) {
          if (!owned.identity) throw new Error("uncertain local temporary file: ownership identity unavailable");
          const current = fs.lstatSync(temporary);
          if (!current.isFile() || current.isSymbolicLink() || !sameLocalIdentity(current, owned.identity)) throw new Error("local temporary file ownership changed; refusing cleanup");
          fs.unlinkSync(temporary);
        }
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          if (published) {
            const failure = new Error("local mutation committed; temporary cleanup failed; inspect before retrying", { cause: error });
            Object.defineProperty(failure, FABRIC_COMMIT_ACKNOWLEDGEMENT, { value: { version: 1, operation: name } });
            throw failure;
          }
          if (operationError) throw new AggregateError([operationError, error], "local mutation and temporary cleanup failed; uncertain file ownership", { cause: operationError });
          throw error;
        }
      }
    }
  }
  async close(): Promise<void> {
    this.#searchPages.clear();
    this.#closed = true;
    this.#controller.abort(new Error("local provider closed"));
    await Promise.allSettled([...this.#pending]);
    // Approval reservations are released by the registry, not by close while
    // a human prompt or process cleanup is still outstanding.
    for (const [token, entry] of this.#prepared) if (!entry.active) this.#prepared.delete(token);
  }
}
