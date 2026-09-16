import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { throwIfAbortedOrExpired } from "../async-settlement.js";
import type { FabricActionDescriptor, FabricInvocationContext, FabricProvider } from "../protocol.js";
import { fabricJsonText } from "../runtime/json-budget.js";
import { validateSchemaValue } from "../schema-validation.js";
import { LocalPaths, LOCAL_MAX_FILE_BYTES } from "./local-path.js";
import type {
  ReviewBeginArguments, ReviewBeginResult, ReviewCoverage, ReviewEndResult,
  ReviewEvidence, ReviewEvidenceInput, ReviewFinding, ReviewFindingArguments,
  ReviewMutationResult, ReviewObligation, ReviewPageArguments, ReviewProviderOptions,
  ReviewReconcileResult, ReviewRole, ReviewStatusResult, ReviewSummary, ReviewUpdateArguments,
} from "./review-contract.js";

const DEFAULT_SCENARIOS = ["normal", "repeated", "malformed", "partial-failure"];
const ROLES: ReviewRole[] = ["entry", "model-validation", "service", "dependency", "persistence", "consumer"];
const COVERAGE: ReviewCoverage[] = ["unknown", "retrieved", "traced", "verified", "blocked"];
const FAILURE_CHECKS = ["before-effect", "after-effect", "retry-idempotency", "compensation", "acknowledgement", "consumer-visibility"];
const MAX_FINDINGS = 32;
const MAX_INPUT_CHARS = 64_000;
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
const id = (prefix: string): string => `${prefix}_${randomUUID()}`;
const validId = (value: string, prefix: string): boolean =>
  new RegExp(`^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, "u").test(value);
const boundedInteger = (value: number | undefined, fallback: number, min: number, max: number): number => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error("review option/budget is out of bounds");
  return result;
};
// Factories deliberately create trees, not shared schema graphs. Fabric's bounded
// schema validator rejects repeated object identities as potentially cyclic.
const text = (maxLength = 2_000): Record<string, unknown> => ({ type: "string", minLength: 1, maxLength });
const integer = (minimum: number, maximum: number): Record<string, unknown> => ({ type: "integer", minimum, maximum });
const enumeration = (values: string[]): Record<string, unknown> => ({ type: "string", enum: [...values] });
const array = (items: Record<string, unknown>, maxItems: number, minItems = 0): Record<string, unknown> => ({ type: "array", items, minItems, maxItems });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)): Record<string, unknown> => ({ type: "object", properties, required: [...required], additionalProperties: false });
const evidenceSchema = (): Record<string, unknown> => object({
  path: text(512), startLine: integer(1, 2_000_000), endLine: integer(1, 2_000_000),
  kind: enumeration(["source", "static-proof", "test", "probe"]), rationale: text(), expectedSha256: text(64),
}, ["path", "startLine", "endLine", "kind", "rationale"]);
const evidences = (): Record<string, unknown> => array(evidenceSchema(), 8);
const pages = (): Record<string, unknown> => object({ taskId: text(41), offset: integer(0, 1_000), limit: integer(1, 50) }, ["taskId"]);
const descriptors = (): FabricActionDescriptor[] => [
  { name: "begin", description: "Begin an ephemeral task. paths are execution-path IDs, not filenames. Adds per-path default scenario and role/edge obligations; no source reads or execution.", inputSchema: object({ objective: text(1_000), paths: array(text(120), 8, 1), scenarios: array(text(120), 4) }, ["objective", "paths"]), risk: "write", effect: { kind: "write" } },
  { name: "update", description: "Replace one in-memory obligation. Host-read evidence; traced needs note, verified needs contract and proof, blocked needs reason and nextAction. No semantic judgment.", inputSchema: object({ taskId: text(41), obligationId: text(41), status: enumeration(COVERAGE), evidence: evidences(), note: text(), contract: text(), blocker: object({ reason: text(), nextAction: text() }) }, ["taskId", "obligationId", "status"]), risk: "write", effect: { kind: "write" } },
  { name: "finding", description: "Admit or replace a structured finding. Severity is independent of confidence. Confirmed is structural admission only; counterexamples/assumptions can prevent it. Never runs code.", inputSchema: object({ taskId: text(41), findingId: text(41), title: text(300), requestedStatus: enumeration(["candidate", "confirmed", "conditional", "disproved"]), severity: enumeration(["critical", "high", "medium", "low", "info"]), confidence: enumeration(["high", "medium", "low"]), caller: text(), trigger: text(), expectedContract: text(), actualAction: text(), consequence: text(), evidence: evidences(), counterexample: object({ verdict: enumeration(["not-checked", "survived", "disproved", "conditional"]), method: enumeration(["static-proof", "test", "probe"]), description: text(), evidence: evidences() }), unresolvedAssumptions: array(text(), 8) }, ["taskId", "title", "requestedStatus", "severity", "confidence", "caller", "trigger", "expectedContract", "actualAction", "consequence", "evidence", "counterexample", "unresolvedAssumptions"]), risk: "write", effect: { kind: "write" } },
  { name: "status", description: "Read a bounded page of last-known in-memory coverage/findings. No source reads or mutations; last-reconciled is not a current freshness guarantee. Ready is advisory only.", inputSchema: pages(), risk: "read", effect: { kind: "none" } },
  { name: "reconcile", description: "Explicit approved mutation: reread all evidence, invalidate stale coverage and downgrade stale findings, return paged unresolved IDs. Does not execute tools, prove semantics, or force a final answer.", inputSchema: pages(), risk: "write", effect: { kind: "write" } },
  { name: "end", description: "Discard one in-memory task regardless of readiness; no durable state or automatic final answer.", inputSchema: object({ taskId: text(41) }), risk: "write", effect: { kind: "write" } },
];

interface Task {
  taskId: string;
  objective: string;
  revision: number;
  expiresAt: number;
  reconciled: boolean;
  obligations: ReviewObligation[];
  findings: ReviewFinding[];
}
interface Source { bytes: number; lines: string[]; sha256: string }
class ReviewSourceQuotaError extends Error {}

/** One instance per host session/chat, reused across exec/compaction, never global.
 * The registry owns approval; direct host invoke is a trusted integration boundary.
 * Mutations are synchronous copy/validate/commit, so no partially applied batches.
 * LocalPaths is defense in depth, not isolation from hostile same-user writers.
 */
export class ReviewProvider implements FabricProvider {
  readonly name = "review";
  readonly description = "Optional ephemeral review ledger; structural evidence accounting, not a semantic judge";
  readonly #root: string;
  readonly #reader: (path: string, context: FabricInvocationContext) => string;
  readonly #now: () => number;
  readonly #maxResultChars: number;
  readonly #maxTasks: number;
  readonly #maxTaskChars: number;
  readonly #maxSessionChars: number;
  readonly #taskTtlMs: number;
  readonly #expiresAt: number;
  readonly #scope = `review:${randomUUID()}`;
  readonly #descriptors = descriptors();
  readonly #tasks = new Map<string, Task>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #sessionTimer: ReturnType<typeof setTimeout>;
  #closed = false;

  constructor(options: ReviewProviderOptions) {
    const allowed = ["root", "maxResultChars", "maxTasks", "maxTaskChars", "maxSessionChars", "taskTtlMs", "sessionTtlMs", "sourceSnapshot", "now"];
    if (!options || Object.keys(options).some(key => !allowed.includes(key))) throw new Error("Invalid review options");
    if (typeof options.root !== "string" || !path.isAbsolute(options.root) || path.resolve(options.root) !== options.root || options.root.includes("\0")) throw new Error("review root must be canonical and absolute");
    this.#root = options.root;
    this.#maxResultChars = Math.min(32_000, boundedInteger(options.maxResultChars, 16_000, 1_000, 8_000_000));
    this.#maxTasks = boundedInteger(options.maxTasks, 16, 1, 64);
    this.#maxTaskChars = boundedInteger(options.maxTaskChars, 256_000, 4_096, 1_000_000);
    this.#maxSessionChars = boundedInteger(options.maxSessionChars, 1_000_000, 4_096, 8_000_000);
    this.#taskTtlMs = boundedInteger(options.taskTtlMs, 3_600_000, 1, 86_400_000);
    const sessionTtlMs = boundedInteger(options.sessionTtlMs, 28_800_000, 1, 86_400_000);
    if (options.now !== undefined && typeof options.now !== "function") throw new Error("Invalid review clock");
    if (options.sourceSnapshot !== undefined && typeof options.sourceSnapshot !== "function") throw new Error("Invalid review snapshot reader");
    this.#now = options.now ?? (() => performance.now());
    const now = this.#now();
    if (!Number.isFinite(now)) throw new Error("Invalid review clock");
    this.#expiresAt = now + sessionTtlMs;
    const local = options.sourceSnapshot ? undefined : new LocalPaths(this.#root);
    this.#reader = options.sourceSnapshot ?? ((file) => local!.read(file).text);
    this.#sessionTimer = setTimeout(() => { void this.close(); }, sessionTtlMs);
    this.#sessionTimer.unref();
  }

  async list(): Promise<FabricActionDescriptor[]> { this.#open(); return structuredClone(this.#descriptors); }
  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> {
    this.#open();
    return structuredClone(this.#descriptors.find(entry => entry.name === actionName));
  }
  effectResources(): readonly string[] { return [this.#scope]; }

  async invoke(actionName: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    this.#check(context);
    const descriptor = this.#descriptors.find(entry => entry.name === actionName);
    if (!descriptor) throw new Error("Unknown review action");
    // Also validate direct trusted-host calls, not just calls through ActionRegistry.
    const input: unknown = JSON.parse(fabricJsonText(args, MAX_INPUT_CHARS));
    const validation = validateSchemaValue(descriptor.inputSchema, args);
    if (validation.status !== "valid") throw new Error(`Invalid review arguments${validation.status === "invalid" ? `: ${validation.message}` : " schema"}`);
    this.#nonempty(input);
    const budget = Math.min(this.#maxResultChars, boundedInteger(context.maxResultChars, this.#maxResultChars, 1, 8_000_000));
    if (actionName === "begin") return this.#begin(input as ReviewBeginArguments, context, budget);
    const taskId = (input as { taskId: string }).taskId;
    const task = this.#get(taskId);
    if (actionName === "status") {
      const result = this.#status(task, input as ReviewPageArguments, budget);
      this.#check(context, task);
      return result;
    }
    if (actionName === "end") {
      const result: ReviewEndResult = { taskId, ended: true };
      this.#fit(result, budget); this.#check(context, task);
      this.#discard(taskId);
      return result;
    }
    const draft = structuredClone(task);
    draft.revision++;
    draft.reconciled = false;
    let result: ReviewMutationResult | ReviewReconcileResult;
    if (actionName === "update") result = this.#update(draft, input as ReviewUpdateArguments, context);
    else if (actionName === "finding") result = this.#finding(draft, input as ReviewFindingArguments, context);
    else result = this.#reconcile(draft, input as ReviewPageArguments, context, budget);
    this.#fit(result, budget);
    this.#commit(draft, context);
    return result;
  }

  async close(): Promise<void> {
    this.#closed = true;
    clearTimeout(this.#sessionTimer);
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear(); this.#tasks.clear();
  }

  #open(): void {
    if (this.#closed || this.#now() >= this.#expiresAt) throw new Error("review session is closed or expired");
  }
  #check(context: FabricInvocationContext, task?: Task): void {
    throwIfAbortedOrExpired(context.signal, context.deadline);
    this.#open();
    if (task && this.#now() >= task.expiresAt) throw new Error("review task is expired");
  }
  #get(taskId: string): Task {
    if (!validId(taskId, "task")) throw new Error("Invalid review task ID");
    const task = this.#tasks.get(taskId);
    if (!task || this.#now() >= task.expiresAt) throw new Error("Unknown or expired review task");
    return task;
  }
  #nonempty(value: unknown): void {
    if (typeof value === "string" && !value.trim()) throw new Error("review fields must not be empty or whitespace");
    if (value && typeof value === "object") for (const item of Object.values(value)) this.#nonempty(item);
  }
  #fit(value: unknown, budget: number): void {
    if (JSON.stringify(value).length > budget) throw new Error("review result exceeds budget; increase maxResultChars or narrow the record");
  }
  #discard(taskId: string): void {
    clearTimeout(this.#timers.get(taskId)); this.#timers.delete(taskId); this.#tasks.delete(taskId);
  }
  #commit(task: Task, context: FabricInvocationContext): void {
    const chars = JSON.stringify(task).length;
    if (chars > this.#maxTaskChars) throw new Error("review task memory quota exceeded");
    const now = this.#now();
    const active = [...this.#tasks.values()].filter(entry => entry.expiresAt > now && entry.taskId !== task.taskId);
    if (active.length >= this.#maxTasks) throw new Error("review task count quota exceeded");
    if (chars + active.reduce((sum, entry) => sum + JSON.stringify(entry).length, 0) > this.#maxSessionChars) throw new Error("review session memory quota exceeded");
    // Ensure every stored record is individually retrievable under the host budget.
    const header = JSON.stringify({ ...this.#summary(task), objective: task.objective, entries: [], total: 999, nextOffset: 999 }).length;
    for (const entry of [...task.obligations, ...task.findings]) this.#fit(entry, this.#maxResultChars - header - 16);
    this.#check(context, task);
    for (const entry of this.#tasks.values()) if (entry.expiresAt <= now) this.#discard(entry.taskId);
    if (!this.#tasks.has(task.taskId)) {
      const timer = setTimeout(() => this.#discard(task.taskId), Math.max(1, task.expiresAt - this.#now()));
      timer.unref(); this.#timers.set(task.taskId, timer);
    }
    this.#tasks.set(task.taskId, task);
  }

  #begin(args: ReviewBeginArguments, context: FabricInvocationContext, budget: number): ReviewBeginResult {
    const paths = args.paths.map(value => value.trim());
    if (new Set(paths).size !== paths.length) throw new Error("Duplicate review execution-path IDs");
    const extras = (args.scenarios ?? []).map(value => value.trim());
    if (new Set(extras).size !== extras.length) throw new Error("Duplicate review scenarios");
    const scenarios = [...new Set([...DEFAULT_SCENARIOS, ...extras])];
    const task: Task = { taskId: id("task"), objective: args.objective, revision: 1, expiresAt: Math.min(this.#expiresAt, this.#now() + this.#taskTtlMs), reconciled: false, obligations: [], findings: [] };
    const add = (target: Pick<ReviewObligation, "kind" | "pathId"> & Partial<Pick<ReviewObligation, "scenario" | "role" | "from" | "to" | "failureCheck">>): void => {
      task.obligations.push({ type: "obligation", id: id("obl"), ...target, status: "unknown", evidence: [], note: null, contract: null, blocker: null, stale: false });
    };
    for (const pathId of paths) {
      add({ kind: "path", pathId });
      for (const scenario of scenarios) add({ kind: "scenario", pathId, scenario });
      for (const check of FAILURE_CHECKS) add({ kind: "partial-failure", pathId, failureCheck: check });
      for (const role of ROLES) add({ kind: "role", pathId, role });
      for (let index = 0; index < ROLES.length - 1; index++) add({ kind: "edge", pathId, from: ROLES[index]!, to: ROLES[index + 1]! });
    }
    const result: ReviewBeginResult = { taskId: task.taskId, revision: task.revision, obligationCount: task.obligations.length, expiresInMs: Math.max(0, task.expiresAt - this.#now()) };
    this.#fit(result, budget); this.#commit(task, context);
    return result;
  }

  #source(file: string, context: FabricInvocationContext, cache: Map<string, Source>): Source {
    this.#check(context);
    if (cache.has(file)) return cache.get(file)!;
    if (cache.size >= 32) throw new ReviewSourceQuotaError("review source snapshot count quota exceeded");
    const value: unknown = this.#reader(file, context);
    this.#check(context);
    if (typeof value !== "string" || value.includes("\0") || Buffer.byteLength(value, "utf8") > LOCAL_MAX_FILE_BYTES || Buffer.from(value, "utf8").toString("utf8") !== value) throw new Error("review source must be bounded valid UTF-8 text");
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes + [...cache.values()].reduce((sum, source) => sum + source.bytes, 0) > 8 * LOCAL_MAX_FILE_BYTES) throw new ReviewSourceQuotaError("review source snapshot byte quota exceeded");
    const lines = value.split("\n");
    if (lines.at(-1) === "") lines.pop();
    const source = { bytes, lines, sha256: hash(value) };
    cache.set(file, source);
    return source;
  }
  #file(input: string): string {
    if (input.includes("\0") || input.includes("\\") || path.isAbsolute(input) || input.split("/").some(part => part === ".." || part === "." || part === "")) throw new Error("review evidence path must be normalized workspace-relative, without traversal");
    const relative = path.relative(this.#root, path.resolve(this.#root, input));
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("review evidence path is outside workspace");
    return relative.split(path.sep).join("/");
  }
  #capture(inputs: ReviewEvidenceInput[], context: FabricInvocationContext, cache: Map<string, Source>): ReviewEvidence[] {
    return inputs.map(input => {
      const file = this.#file(input.path);
      const source = this.#source(file, context, cache);
      if (input.endLine < input.startLine || input.endLine - input.startLine >= 2_000 || input.endLine > source.lines.length) throw new Error("review evidence range is invalid or exceeds 2000 lines");
      if (input.expectedSha256 !== undefined && (!/^[0-9a-f]{64}$/u.test(input.expectedSha256) || input.expectedSha256 !== source.sha256)) throw new Error("review evidence hash is stale or invalid");
      const { expectedSha256: _expected, ...rest } = input;
      return { ...rest, path: file, sha256: source.sha256, rangeSha256: hash(source.lines.slice(input.startLine - 1, input.endLine).join("\n")) };
    });
  }
  #proof(evidence: ReviewEvidence[]): boolean { return evidence.some(item => item.kind !== "source"); }

  #update(task: Task, args: ReviewUpdateArguments, context: FabricInvocationContext): ReviewMutationResult {
    if (!validId(args.obligationId, "obl")) throw new Error("Invalid review obligation ID");
    const entry = task.obligations.find(item => item.id === args.obligationId);
    if (!entry) throw new Error("Unknown review obligation");
    if (args.status === "blocked" ? !args.blocker : args.blocker !== undefined) throw new Error("review blocker requires blocked status and reason/nextAction");
    const inputs = args.evidence ?? [];
    if (["retrieved", "traced", "verified"].includes(args.status) && inputs.length === 0) throw new Error("review coverage requires evidence");
    if (["traced", "verified"].includes(args.status) && !args.note) throw new Error("review tracing requires a causal note");
    if (args.status === "verified" && !args.contract) throw new Error("review verification requires an expected contract");
    const evidence = this.#capture(inputs, context, new Map());
    if (args.status === "verified" && !this.#proof(evidence)) throw new Error("review verification requires static-proof, test, or probe evidence");
    Object.assign(entry, { status: args.status, evidence, note: args.note ?? null, contract: args.contract ?? null, blocker: args.blocker ?? null, stale: false });
    return { taskId: task.taskId, revision: task.revision, id: entry.id, status: entry.status };
  }

  #admit(finding: ReviewFinding): void {
    const reasons: string[] = [];
    if (!this.#proof(finding.evidence)) reasons.push("supporting static-proof/test/probe evidence missing");
    if (finding.counterexample.verdict !== "survived") reasons.push(`counterexample verdict: ${finding.counterexample.verdict}`);
    if (!finding.counterexample.evidence.some(item => item.kind === finding.counterexample.method)) reasons.push("counterexample evidence matching method missing");
    if (finding.unresolvedAssumptions.length) reasons.push("unresolved assumptions");
    if (finding.needsDowngrade) reasons.push("evidence changed or unreadable; re-admit with fresh evidence");
    finding.admissionReasons = reasons;
    if (finding.requestedStatus === "disproved" || finding.counterexample.verdict === "disproved") finding.status = "disproved";
    else if (finding.requestedStatus === "conditional" || finding.counterexample.verdict === "conditional" || finding.unresolvedAssumptions.length) finding.status = "conditional";
    else finding.status = finding.requestedStatus === "confirmed" && reasons.length === 0 ? "confirmed" : "candidate";
  }
  #finding(task: Task, args: ReviewFindingArguments, context: FabricInvocationContext): ReviewMutationResult {
    if (args.findingId !== undefined && !validId(args.findingId, "find")) throw new Error("Invalid review finding ID");
    const index = args.findingId === undefined ? -1 : task.findings.findIndex(item => item.id === args.findingId);
    if (args.findingId !== undefined && index < 0) throw new Error("Unknown review finding");
    if (index < 0 && task.findings.length >= MAX_FINDINGS) throw new Error("review finding quota exceeded");
    const cache = new Map<string, Source>();
    const { taskId: _taskId, findingId: _findingId, ...fields } = args;
    const finding: ReviewFinding = { ...fields, type: "finding", id: args.findingId ?? id("find"), status: "candidate", evidence: this.#capture(args.evidence, context, cache), counterexample: { ...args.counterexample, evidence: this.#capture(args.counterexample.evidence, context, cache) }, admissionReasons: [], needsDowngrade: false };
    this.#admit(finding);
    if (index < 0) task.findings.push(finding); else task.findings[index] = finding;
    return { taskId: task.taskId, revision: task.revision, id: finding.id, status: finding.status, admissionReasons: [...finding.admissionReasons] };
  }

  #summary(task: Task): ReviewSummary {
    const coverage: Record<ReviewCoverage, number> = { unknown: 0, retrieved: 0, traced: 0, verified: 0, blocked: 0 };
    for (const entry of task.obligations) coverage[entry.status]++;
    const unresolvedCount = task.obligations.filter(entry => entry.status !== "verified").length;
    const findingsNeedingDowngradeCount = task.findings.filter(entry => entry.needsDowngrade || entry.status === "candidate" || entry.status === "conditional").length;
    return { taskId: task.taskId, revision: task.revision, ready: task.reconciled && unresolvedCount === 0 && findingsNeedingDowngradeCount === 0, advisory: true, semanticValidation: false, freshness: task.reconciled ? "last-reconciled" : "unreconciled", unresolvedCount, findingsNeedingDowngradeCount, coverage, expiresInMs: Math.max(0, task.expiresAt - this.#now()) };
  }
  #status(task: Task, args: ReviewPageArguments, budget: number): ReviewStatusResult {
    const all = [...task.obligations, ...task.findings];
    const offset = args.offset ?? 0;
    if (offset > all.length) throw new Error("review page offset exceeds total");
    const result: ReviewStatusResult = { ...this.#summary(task), objective: task.objective, entries: [], total: all.length, nextOffset: offset < all.length ? offset : null };
    this.#fit(result, budget);
    for (let index = offset; index < Math.min(all.length, offset + (args.limit ?? 20)); index++) {
      const previous = result.nextOffset;
      result.entries.push(all[index]!); result.nextOffset = index + 1 < all.length ? index + 1 : null;
      if (JSON.stringify(result).length > budget) { result.entries.pop(); result.nextOffset = previous; break; }
    }
    if (offset < all.length && !result.entries.length) throw new Error("review record exceeds result budget; increase maxResultChars");
    return structuredClone(result);
  }

  #reconcile(task: Task, args: ReviewPageArguments, context: FabricInvocationContext, budget: number): ReviewReconcileResult {
    const cache = new Map<string, Source>();
    const failures = new Set<string>();
    const current = (evidence: ReviewEvidence): boolean => {
      this.#check(context, task);
      if (failures.has(evidence.path)) return false;
      let source: Source;
      try { source = this.#source(evidence.path, context, cache); }
      catch (error) {
        this.#check(context, task);
        if (error instanceof ReviewSourceQuotaError) throw error;
        failures.add(evidence.path); return false;
      }
      return source.sha256 === evidence.sha256 && evidence.endLine <= source.lines.length && hash(source.lines.slice(evidence.startLine - 1, evidence.endLine).join("\n")) === evidence.rangeSha256;
    };
    for (const entry of task.obligations) {
      if (entry.evidence.some(item => !current(item))) {
        entry.stale = true;
        if (entry.status !== "blocked") entry.status = "unknown";
        entry.blocker = entry.status === "blocked" ? entry.blocker : null;
      }
    }
    for (const finding of task.findings) {
      if ([...finding.evidence, ...finding.counterexample.evidence].some(item => !current(item))) {
        finding.needsDowngrade = true;
        this.#admit(finding);
        // Even a formerly disproved claim needs renewed evidence before dismissal.
        finding.status = "candidate";
      }
    }
    task.reconciled = true;
    const unresolved = task.obligations.filter(entry => entry.status !== "verified").map(entry => entry.id);
    const downgrade = task.findings.filter(entry => entry.needsDowngrade || entry.status === "candidate" || entry.status === "conditional").map(entry => entry.id);
    const all = [...unresolved, ...downgrade];
    const offset = args.offset ?? 0;
    if (offset > all.length) throw new Error("review page offset exceeds total");
    const result: ReviewReconcileResult = { ...this.#summary(task), unresolvedObligations: [], findingsNeedingDowngrade: [], total: all.length, nextOffset: offset < all.length ? offset : null };
    this.#fit(result, budget);
    for (let index = offset; index < Math.min(all.length, offset + (args.limit ?? 20)); index++) {
      const target = index < unresolved.length ? result.unresolvedObligations : result.findingsNeedingDowngrade;
      const previous = result.nextOffset;
      target.push(all[index]!); result.nextOffset = index + 1 < all.length ? index + 1 : null;
      if (JSON.stringify(result).length > budget) { target.pop(); result.nextOffset = previous; break; }
    }
    if (offset < all.length && result.unresolvedObligations.length + result.findingsNeedingDowngrade.length === 0) throw new Error("review result budget cannot fit an obligation ID");
    return result;
  }
}
