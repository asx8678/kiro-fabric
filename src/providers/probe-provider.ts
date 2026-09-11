import path from "node:path";
import { randomUUID } from "node:crypto";
import { throwIfAbortedOrExpired } from "../async-settlement.js";
import { schemaValidationMessage } from "../schema-validation.js";
import { FABRIC_COMMIT_ACKNOWLEDGEMENT } from "../protocol.js";
import type { FabricActionDescriptor, FabricInvocationContext, FabricProvider } from "../protocol.js";
import { runLocalShell } from "./local-shell.js";
import { PROBE_ACTION_DESCRIPTORS, PROBE_INPUT_SCHEMAS } from "./probe-contract.js";
import type { ProbeCreateArguments, ProbeDeclarations, ProbeFile, ProbeHandle, ProbeProviderOptions, ProbeRunArguments, ProbeRunResult, ProbeWriteResult } from "./probe-contract.js";
import { discoverProbeExecutables } from "./probe-discovery.js";
import { ProbeStorage, probeHash } from "./probe-storage.js";
import type { ProbeDirectorySnapshot } from "./probe-storage.js";

type Probe = { handle: ProbeHandle; directory: string; records: string; declarations: ProbeDeclarations; bytes: number; writes: number; runs: number; blocked: boolean };
type Preparation = { token: string; id: string; operationId: string; cwd: string; recordPath: string };
type Prepared = {
  name: string; signature: string; expires: number; active: boolean; used: boolean;
  metadata: Preparation; directories: ProbeDirectorySnapshot; environment?: Record<string, string>;
  byteReservation: number; outputBudget: number;
};
// No disk locks before approval. IDs/directories are instance-owned and cannot be
// opened by another instance. This map also excludes same-process probe effects
// across registries; it does not claim cross-process host-shell confinement.
const reservations = new Map<string, { token: string; run: boolean }>();
const hardLimit = (value: number | undefined, fallback: number, min: number, max: number, name: string): number => {
  const actual = value ?? fallback;
  if (!Number.isSafeInteger(actual) || actual < min || actual > max) throw new Error(`probe ${name} must be ${min}..${max}`);
  return actual;
};
const effectful = (name: string): boolean => name !== "discover";
const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";
const fileBytes = (files: ProbeFile[]): number => files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
// Mirrors runLocalShell's allowlist, solely to retain/review the actual forwarded
// environment. Declarations do not override it; no other ambient keys are read.
const observedEnvironment = (): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const key of ["HOME", "PATH", "TMPDIR", "LANG", "TERM", "TZ", "USER", "LOGNAME", ...Object.keys(process.env).filter(key => /^LC_[A-Z_]+$/.test(key)).sort()]) {
    if (process.env[key] !== undefined) result[key] = process.env[key];
  }
  if (JSON.stringify(result).length > 16000) throw new Error("probe shell environment exceeds retained approval budget");
  return result;
};

/** Ordinary nonzero command evidence, already retained. Cancellation, timeout,
 * abnormal termination and cleanup uncertainty never become this result. */
export class ProbeRunExitError extends Error {
  readonly result: ProbeRunResult;
  readonly [FABRIC_COMMIT_ACKNOWLEDGEMENT] = { version: 1 as const, operation: "write" as const };
  constructor(result: ProbeRunResult) {
    super(`Probe command exited with code ${result.exitCode}; retained run ${result.runId}`);
    this.name = "ProbeRunExitError";
    this.result = result;
    Object.defineProperty(this, "result", { enumerable: false });
  }
}

/** Independent projects and retained evidence, not an execution sandbox. No
 * deletion/reopen/import/rerun API; existing retained projects are never adopted.
 * Preparation/reservation/constructor only validate/read/reserve memory. All
 * writes and commands occur in invoke after the registry's exact approval. */
export class ProbeProvider implements FabricProvider {
  readonly name = "probe";
  readonly description = "Explicit approved retained independent probes with declared provenance; host execution, not production proof or network isolation";
  readonly #storage: ProbeStorage;
  readonly #options: ProbeProviderOptions;
  readonly #budget: number;
  readonly #maxProbes: number;
  readonly #maxRuns: number;
  readonly #maxWrites: number;
  readonly #maxBytes: number;
  readonly #descriptors: FabricActionDescriptor[];
  readonly #probes = new Map<string, Probe>();
  readonly #prepared = new Map<string, Prepared>();
  readonly #controller = new AbortController();
  readonly #pending = new Set<Promise<unknown>>();
  #closed = false;

  constructor(options: ProbeProviderOptions) {
    this.#options = structuredClone(options);
    this.#budget = Math.min(20000, hardLimit(options.maxResultChars, 20000, 1000, Number.MAX_SAFE_INTEGER, "maxResultChars"));
    this.#maxProbes = hardLimit(options.maxProbes, 64, 1, 1000, "maxProbes");
    this.#maxRuns = hardLimit(options.maxRunsPerProbe, 64, 1, 1000, "maxRunsPerProbe");
    this.#maxWrites = hardLimit(options.maxWritesPerProbe, 128, 1, 1000, "maxWritesPerProbe");
    this.#maxBytes = hardLimit(options.maxManagedBytesPerProbe, 8 * 1024 * 1024, 65536, 64 * 1024 * 1024, "maxManagedBytesPerProbe");
    if (options.sdkDirectories && (options.sdkDirectories.length > 8 || options.sdkDirectories.some(dir => !path.isAbsolute(dir) || dir.length > 4000 || dir.includes("\0")))) throw new Error("probe sdkDirectories must contain <=8 bounded absolute paths");
    this.#storage = new ProbeStorage(options.root, options.probesRoot);
    this.#descriptors = structuredClone(PROBE_ACTION_DESCRIPTORS) as FabricActionDescriptor[];
    for (const descriptor of this.#descriptors) descriptor.effect = { kind: descriptor.name === "discover" ? "read" : "write", resources: [...this.effectResources(descriptor.name)] };
  }

  async list(): Promise<FabricActionDescriptor[]> { return structuredClone(this.#descriptors); }
  async describe(name: string): Promise<FabricActionDescriptor | undefined> { return structuredClone(this.#descriptors.find(item => item.name === name)); }
  effectResources(name: string): readonly string[] { return name === "run" ? ["*"] : name === "discover" ? [] : [`probe-root:${this.#storage.probesRoot}`]; }
  #check(context: FabricInvocationContext): void {
    if (this.#closed) throw new Error("probe provider is closed");
    throwIfAbortedOrExpired(context.signal, context.deadline);
    this.#controller.signal.throwIfAborted();
    this.#storage.verify();
  }
  #resultBudget(context: FabricInvocationContext): number {
    return Math.min(this.#budget, hardLimit(context.maxResultChars, this.#budget, 1000, Number.MAX_SAFE_INTEGER, "context maxResultChars"));
  }
  #bounded<T>(value: T, budget: number): T {
    if (JSON.stringify(value).length > budget) throw new Error("probe result metadata exceeds maxResultChars");
    return value;
  }
  #validate(name: string, args: Record<string, unknown>, prepared = false): void {
    if (!Object.hasOwn(PROBE_INPUT_SCHEMAS, name)) throw new Error(`Unknown probe action: ${name}`);
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("probe arguments must be an object");
    const invalid = schemaValidationMessage(prepared ? this.#descriptors.find(item => item.name === name)!.inputSchema : PROBE_INPUT_SCHEMAS[name]!, args);
    if (invalid) throw new Error(`Invalid probe.${name} arguments: ${invalid}`);
    const serialized = JSON.stringify(args);
    if (serialized.length > 64000) throw new Error("probe exact arguments exceed 64000-character approval budget");
    // JSON serialization escapes NUL, so test raw strings recursively without
    // treating valid backslash-u text as an actual NUL.
    const checkText = (value: unknown): void => {
      if (typeof value === "string" && (value.includes("\0") || Buffer.from(value).toString("utf8") !== value)) throw new Error("probe arguments require valid UTF-8 without NUL");
      if (Array.isArray(value)) value.forEach(checkText);
      else if (value && typeof value === "object") Object.values(value).forEach(checkText);
    };
    checkText(args);
    if (typeof args.id === "string" && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(args.id)) throw new Error("probe ID must be a host-issued UUID");
    if (name === "discover" && (args.executables as string[]).some(item => !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(item))) throw new Error("Invalid probe executable name");
    if (name === "run" && ((typeof args.script === "string") === (typeof args.executable === "string") || (args.executable !== undefined && args.interpreter !== undefined))) throw new Error("probe.run requires script/interpreter OR executable, not both");
    const declarations = args.declarations as ProbeDeclarations | undefined;
    if (declarations?.sourceReferences?.some(item => item.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(item.sha256))) throw new Error("probe source sha256 declaration must be 64 lowercase hex characters");
  }
  #probe(id: string): Probe {
    const probe = this.#probes.get(id);
    if (!probe || probe.blocked) throw new Error("probe ID is not owned by this instance or has uncertain retained state");
    this.#storage.snapshot(probe.directory); this.#storage.snapshot(probe.handle.cwd); this.#storage.snapshot(probe.records);
    return probe;
  }
  #quota(probe: Probe, name: string, bytes: number): void {
    if (probe.bytes + bytes > this.#maxBytes || (name === "run" && probe.runs >= this.#maxRuns) || (name === "write" && probe.writes >= this.#maxWrites)) throw new Error("probe managed bytes/run/write quota exceeded (retained data is never deleted)");
  }
  #handle(id: string, kind: ProbeHandle["kind"]): ProbeHandle {
    const directory = path.join(this.#storage.probesRoot, id);
    return { id, kind, cwd: path.join(directory, "project"), manifestPath: path.join(directory, "manifest.json"), retained: true, productionProof: false };
  }

  async prepareArguments(name: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<Record<string, unknown>> {
    this.#validate(name, args); this.#check(context);
    const budget = this.#resultBudget(context);
    if (!effectful(name)) return structuredClone(args);
    const canonical = structuredClone(args);
    const id = name === "create" ? randomUUID() : args.id as string;
    const operationId = randomUUID();
    const token = randomUUID();
    let directories: ProbeDirectorySnapshot = [];
    let environment: Record<string, string> | undefined;
    let handle: ProbeHandle;
    if (name === "create") {
      if (this.#storage.countRoots(this.#maxProbes) >= this.#maxProbes) throw new Error("probe retained directory quota exceeded");
      const files = (args.files ?? []) as ProbeFile[];
      for (const file of files) this.#storage.safeName(file.path);
      const names = files.map(file => file.path);
      if (names.some((file, i) => names.some((other, j) => i !== j && (file === other || other.startsWith(file + "/"))))) throw new Error("probe initial files overlap");
      if (files.length > this.#maxWrites || fileBytes(files) > 32768) throw new Error("probe initial files exceed write/content quota");
      handle = this.#handle(id, args.kind as ProbeHandle["kind"]);
      this.#bounded(handle, budget);
    } else {
      const probe = this.#probe(id);
      handle = probe.handle;
      directories = [...this.#storage.snapshot(probe.handle.cwd), ...this.#storage.snapshot(probe.records)];
      if (name === "write") directories.push(...this.#storage.filePlan(handle.cwd, args.path as string));
      else {
        if (typeof args.executable === "string" && (!path.isAbsolute(args.executable) && !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(args.executable))) throw new Error("probe executable must be an absolute path or a bare executable name");
        canonical.timeoutMs = args.timeoutMs ?? 30000;
        canonical.settle = args.settle ?? false;
        canonical.args = args.args ?? [];
        if (typeof args.script === "string") canonical.interpreter = args.interpreter ?? "sh";
        environment = observedEnvironment();
      }
    }
    const recordPath = name === "create" ? handle.manifestPath : path.join(this.#storage.probesRoot, id, "records", `${name}-${operationId}.result.json`);
    const metadata: Preparation = { token, id, operationId, cwd: handle.cwd, recordPath };
    canonical._probePreparation = metadata;
    canonical.review = `${name} retained probe ${id}; kind=${handle.kind}; productionProof=false. Canonical cwd: ${JSON.stringify(handle.cwd)}. Record: ${JSON.stringify(recordPath)}. Exact files/script/argv/declarations are in these approved arguments. No deletion or implicit install/test/rerun. ${name === "run" ? 'HOST AUTHORITY: cwd is not filesystem/network confinement. Direct executable uses /bin/sh exec "$@"; scripts return the shell last exit. Environment declarations are not applied.' : 'Provider-managed create-only writes, including retained evidence.'}`;
    if (environment) {
      // A host-generated explicit environment review is bound by the same token
      // without widening the public raw input schema.
      canonical.review += ` Forwarded environment: ${JSON.stringify(environment)}`;
    }
    if ((canonical.review as string).length > 4096) throw new Error("probe exact environment/review exceeds approval budget");
    this.#validate(name, canonical, true);
    const outputBudget = name === "run" ? budget - JSON.stringify(this.#runEnvelope(metadata, handle.kind)).length - 128 : budget;
    if (outputBudget < 256) throw new Error("probe run metadata exceeds result budget before execution");
    if (name === "write") this.#bounded(this.#writeResult(metadata, args.path as string, args.content as string), budget);
    // Conservative managed-data reservation includes pretty-printed requests,
    // result records and original file bytes. Shell-created data is not bounded.
    const byteReservation = Buffer.byteLength(json(canonical)) * 2 + 8192 + budget + (name === "create" ? fileBytes((args.files ?? []) as ProbeFile[]) : name === "write" ? Buffer.byteLength(args.content as string) : 0);
    if (name === "create") { if (byteReservation > this.#maxBytes) throw new Error("probe managed byte quota exceeded"); }
    else this.#quota(this.#probe(id), name, byteReservation);
    for (const [key, entry] of this.#prepared) if (!entry.active && entry.expires < Date.now()) this.#prepared.delete(key);
    while (this.#prepared.size >= 64) {
      const victim = [...this.#prepared].find(([, entry]) => !entry.active);
      if (!victim) throw new Error("probe preparation quota exceeded");
      this.#prepared.delete(victim[0]);
    }
    this.#prepared.set(token, { name, signature: probeHash(JSON.stringify(canonical)), expires: Date.now() + 60000, active: false, used: false, metadata, directories, ...(environment ? { environment } : {}), byteReservation, outputBudget });
    return canonical;
  }

  #entry(name: string, args: Record<string, unknown>): Prepared {
    this.#validate(name, args, true);
    const token = (args._probePreparation as Preparation | undefined)?.token;
    const entry = token ? this.#prepared.get(token) : undefined;
    if (!entry || entry.name !== name || entry.signature !== probeHash(JSON.stringify(args)) || (!entry.active && entry.expires < Date.now())) throw new Error("probe preparation missing, altered, or expired");
    return entry;
  }
  async reserveInvocation(name: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<() => void> {
    this.#check(context);
    if (!effectful(name)) return () => {};
    const entry = this.#entry(name, args);
    if (entry.active || entry.used) throw new Error("probe preparation already reserved/used");
    const root = this.#storage.probesRoot;
    if (reservations.has(root) || [...reservations.values()].some(item => item.run) || (name === "run" && reservations.size)) throw new Error("probe overlapping effect reservation rejected");
    entry.active = true;
    reservations.set(root, { token: entry.metadata.token, run: name === "run" });
    return () => {
      if (reservations.get(root)?.token === entry.metadata.token) reservations.delete(root);
      entry.active = false;
      this.#prepared.delete(entry.metadata.token);
    };
  }
  invoke(name: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    const pending = this.#invoke(name, args, context);
    this.#pending.add(pending);
    void pending.finally(() => this.#pending.delete(pending)).catch(() => {});
    return pending;
  }
  async #invoke(name: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    this.#check(context);
    if (name === "discover") {
      this.#validate(name, args);
      return discoverProbeExecutables(args.executables as string[], this.#options, this.#resultBudget(context), () => this.#check(context));
    }
    const entry = this.#entry(name, args);
    if (!entry.active || entry.used) throw new Error("probe effect requires unused active registry reservation");
    this.#storage.verifySnapshot(entry.directories);
    if (entry.environment && JSON.stringify(entry.environment) !== JSON.stringify(observedEnvironment())) throw new Error("probe forwarded environment changed since approval");
    if (name !== "create") {
      const probe = this.#probe(entry.metadata.id);
      this.#quota(probe, name, entry.byteReservation);
      // A foreign record inserted during approval must reject before even the
      // request write or shell launch, not merely fail when publishing results.
      for (const target of [entry.metadata.recordPath, entry.metadata.recordPath.replace(".result.json", ".request.json")]) {
        this.#storage.filePlan(probe.records, path.basename(target));
      }
    }
    entry.used = true;
    if (name === "create") return this.#create(args as ProbeCreateArguments & Record<string, unknown>, entry, context);
    const probe = this.#probe(entry.metadata.id);
    if (name === "write") {
      // Recheck target/parents after approval before ANY record or file write.
      this.#storage.filePlan(probe.handle.cwd, args.path as string);
      this.#check(context);
      probe.bytes += entry.byteReservation; probe.writes++;
      try {
        this.#storage.writeRecord(entry.metadata.recordPath.replace(".result.json", ".request.json"), json({ schemaVersion: 1, operation: "write", approvedArguments: args, startedAt: new Date().toISOString() }));
        this.#storage.writeProjectFile(probe.handle.cwd, args.path as string, args.content as string);
        const result = this.#writeResult(entry.metadata, args.path as string, args.content as string);
        this.#storage.writeRecord(entry.metadata.recordPath, json(result));
        this.#check(context);
        return result;
      } catch (cause) { probe.blocked = true; throw this.#retainedError("write", entry, cause); }
    }
    return this.#run(args as ProbeRunArguments & Record<string, unknown>, probe, entry, context);
  }

  #retainedError(operation: string, entry: Prepared, cause: unknown): Error {
    const error = new Error(`Probe ${operation} failed after retained writes may have begun; inspect ${entry.metadata.id}/${entry.metadata.operationId} before any explicit retry`, { cause });
    // Publication may have failed before a write; do not manufacture a commit
    // acknowledgement. The error honestly reports uncertainty instead.
    return error;
  }
  #create(args: ProbeCreateArguments & Record<string, unknown>, entry: Prepared, context: FabricInvocationContext): ProbeHandle {
    if (this.#storage.countRoots(this.#maxProbes) >= this.#maxProbes) throw new Error("probe retained directory quota exceeded");
    this.#check(context);
    const handle = this.#handle(entry.metadata.id, args.kind);
    const directory = path.dirname(handle.cwd);
    const probe: Probe = { handle, directory, records: path.join(directory, "records"), declarations: structuredClone(args.declarations ?? {}), bytes: entry.byteReservation, writes: (args.files ?? []).length, runs: 0, blocked: false };
    try {
      this.#storage.ensureRoot();
      this.#storage.createDirectory(directory);
      this.#storage.createDirectory(handle.cwd);
      this.#storage.createDirectory(probe.records);
      this.#probes.set(handle.id, probe);
      this.#storage.writeRecord(handle.manifestPath, json({ schemaVersion: 1, ...handle, label: args.label ?? null, createdAt: new Date().toISOString(), approvedArguments: args, declarations: { status: "caller-declared-unverified", ...probe.declarations }, files: (args.files ?? []).map(file => ({ path: file.path, bytes: Buffer.byteLength(file.content), sha256: probeHash(file.content) })), evidence: "Independent probe only; kind is caller-declared, not proof about repository/production. Records are retained host files, not tamper-proof attestations.", execution: "Approved host authority, no network/filesystem confinement; no automatic execution/install/rerun. Managed quotas do not bound shell effects." }));
      for (const file of args.files ?? []) this.#storage.writeProjectFile(handle.cwd, file.path, file.content);
      this.#storage.writeRecord(path.join(probe.records, `create-${entry.metadata.operationId}.result.json`), json({ complete: true, ...handle }));
      this.#check(context);
      return handle;
    } catch (cause) { probe.blocked = true; throw this.#retainedError("create", entry, cause); }
  }
  #writeResult(metadata: Preparation, name: string, content: string): ProbeWriteResult {
    return { id: metadata.id, path: name, sha256: probeHash(content), bytes: Buffer.byteLength(content), recordPath: metadata.recordPath, retained: true };
  }
  #runEnvelope(metadata: Preparation, kind: ProbeHandle["kind"]): Pick<ProbeRunResult, "id" | "runId" | "kind" | "productionProof" | "recordPath"> {
    return { id: metadata.id, runId: metadata.operationId, kind, productionProof: false, recordPath: metadata.recordPath };
  }
  async #run(args: ProbeRunArguments & Record<string, unknown>, probe: Probe, entry: Prepared, context: FabricInvocationContext): Promise<ProbeRunResult> {
    this.#check(context);
    probe.bytes += entry.byteReservation; probe.runs++;
    const input = typeof args.executable === "string"
      ? { script: 'exec "$@"', interpreter: "sh" as const, args: [args.executable, ...(args.args ?? [])] }
      : { script: args.script!, interpreter: args.interpreter ?? "sh", args: args.args ?? [] };
    const startedAt = new Date().toISOString();
    const envelope = this.#runEnvelope(entry.metadata, probe.handle.kind);
    try {
      this.#storage.writeRecord(entry.metadata.recordPath.replace(".result.json", ".request.json"), json({ schemaVersion: 1, ...envelope, startedAt, cwd: probe.handle.cwd, approvedArguments: args, executedInput: input, environment: { policy: "runLocalShell allowlist; no declaration injection", observed: entry.environment }, declarations: { status: "caller-declared-unverified", project: probe.declarations, run: args.declarations ?? {} }, versionObservation: "No version detection performed. Command stdout/stderr are observations, never parsed into verified SDK/package claims.", semantics: "Literal scripts return shell last status; arbitrary pipeline correctness is not inferred. Explicit direct executable uses exec positional arguments. Host authority; not network confinement." }));
    } catch (cause) { probe.blocked = true; throw this.#retainedError("run record", entry, cause); }
    let result: ProbeRunResult;
    try {
      this.#check(context);
      // runLocalShell owns process-group termination, pipe closure and bounded
      // cleanup even after abort/deadline. Do not race its promise.
      const shell = await runLocalShell({ ...input, cwd: probe.handle.cwd, timeoutMs: args.timeoutMs ?? 30000, settle: true, maxOutputChars: entry.outputBudget, signal: context.signal ? AbortSignal.any([context.signal, this.#controller.signal]) : this.#controller.signal, ...(context.deadline ? { deadline: context.deadline } : {}) });
      result = { ...envelope, ...shell };
    } catch (cause) {
      try {
        // The shared helper intentionally withholds partial streams/signal on
        // hard failures. Record unavailable, never synthesize successful evidence.
        this.#storage.verifySnapshot(entry.directories);
        this.#storage.writeRecord(entry.metadata.recordPath, json({ schemaVersion: 1, ...envelope, startedAt, endedAt: new Date().toISOString(), status: "hard-failure", result: null, evidenceUnavailable: true, reason: cause instanceof Error ? cause.message.slice(0, 512) : "Shell execution failed", note: "runLocalShell did not return diagnostic streams/exit/signal; cancellation, timeout and cleanup failure are not settled. External effects may have occurred." }));
      } catch (recordFailure) {
        probe.blocked = true;
        throw this.#retainedError("run/retention", entry, new AggregateError([cause, recordFailure], "Execution and evidence retention failed"));
      }
      // Cleanup uncertainty permanently blocks this ID, but ordinary cancellation
      // permits a separately approved future run, never an automatic retry.
      if (cause instanceof Error && /uncertain/.test(cause.message)) probe.blocked = true;
      throw cause;
    }
    try {
      this.#storage.verifySnapshot(entry.directories);
      this.#storage.writeRecord(entry.metadata.recordPath, json({ schemaVersion: 1, startedAt, endedAt: new Date().toISOString(), status: "completed", result }));
    } catch (cause) { probe.blocked = true; throw this.#retainedError("run retention", entry, cause); }
    this.#check(context);
    this.#bounded(result, this.#resultBudget(context));
    if (!result.ok && args.settle !== true) throw new ProbeRunExitError(result);
    return result;
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#controller.abort(new Error("probe provider closed"));
    await Promise.allSettled([...this.#pending]);
    // Pending approval reservations stay held until the registry settles the
    // approver. A late approved invocation sees closed before any side effect.
    for (const [token, entry] of this.#prepared) if (!entry.active) this.#prepared.delete(token);
  }
}
