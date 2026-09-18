import type { FabricInvocationContext, FabricProvider } from "../protocol.js";
import { throwIfAbortedOrExpired } from "../async-settlement.js";
import { validateSchemaValue } from "../schema-validation.js";
import { fitsEnvelope, renderContinuity } from "../continuity/render.js";
import { ContinuityStore, type ContinuityStoreOptions } from "../continuity/store.js";
import { CONTINUITY_ACTION_DESCRIPTORS } from "./continuity-contract.js";
import { LocalPaths } from "./local-path.js";
import { assessChecks, renderTaskView } from "../continuity/task-view.js";
import { recallContinuity, type ContinuityRecallArguments } from "../continuity/recall.js";

export class ContinuityProvider implements FabricProvider {
  readonly name = "continuity";
  readonly description = "Opt-in durable task checkpoints with explicit host operation capture (not native compaction)";
  readonly #store: ContinuityStore;
  readonly #maxSummaryBytes: number;
  readonly #maxResultBytes: number;
  readonly #paths?: LocalPaths;
  constructor(root: string, options: ContinuityStoreOptions & { maxSummaryBytes: number; maxResultBytes?: number; workspaceRoot?: string }) {
    for (const [value, minimum, maximum] of [
      [options.maxTasks, 1, 32], [options.maxTaskBytes, 4096, 131072],
      [options.maxTotalBytes, 4096, 4194304], [options.maxSummaryBytes, 1024, 16384],
    ]) if (!Number.isSafeInteger(value) || value! < minimum! || value! > maximum!) throw new Error("invalid continuity limits");
    this.#maxSummaryBytes = options.maxSummaryBytes;
    this.#maxResultBytes = options.maxResultBytes ?? 24000;
    if (!Number.isSafeInteger(this.#maxResultBytes) || this.#maxResultBytes < 768) throw new Error("continuity output budget too small");
    this.#store = new ContinuityStore(root, options);
    if (options.workspaceRoot) this.#paths = new LocalPaths(options.workspaceRoot);
  }
  discoveryRevision(): string { return "3"; }
  async list() { return structuredClone([...CONTINUITY_ACTION_DESCRIPTORS]); }
  async describe(name: string) { return structuredClone(CONTINUITY_ACTION_DESCRIPTORS.find(action => action.name === name)); }
  effectResources(): readonly string[] { return ["continuity:store"]; }
  async invoke(name: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    throwIfAbortedOrExpired(context.signal, context.deadline);
    const descriptor = CONTINUITY_ACTION_DESCRIPTORS.find(action => action.name === name);
    if (!descriptor) throw new Error("unknown continuity action");
    const validation = validateSchemaValue(descriptor.inputSchema, args);
    if (validation.status !== "valid") throw new Error("invalid continuity arguments");
    const budget = Math.min(this.#maxResultBytes, context.maxResultChars ?? this.#maxResultBytes);
    // Mutation acknowledgements always fit this floor; never publish and then reject an oversized acknowledgement.
    if (budget < 768) throw new Error("continuity output budget too small");
    if (name === "create") return this.#store.create(args.objective, args.constraints, context);
    if (name === "checkpoint") return this.#store.checkpoint(args.taskId, args.expectedRevision, args.requestId, args.facts, context, args.captureCurrentExecution === true, args.checks);
    if (name === "delete") return this.#store.delete(args.taskId, args.expectedRevision, context);
    if (name === "read") {
      const source = await this.#store.read(args.taskId, args.expectedRevision, context);
      if (args.view === "task") {
        const assessments = assessChecks(source, file => {
          throwIfAbortedOrExpired(context.signal, context.deadline);
          try { return this.#paths?.read(file).snapshot.file?.sha256 ?? null; }
          catch { return null; } // Missing/unsafe/changed sources are unavailable, never silently current.
        });
        throwIfAbortedOrExpired(context.signal, context.deadline);
        return renderTaskView(source, assessments, Math.min(this.#maxSummaryBytes, (args.maxSummaryBytes as number | undefined) ?? 4096), budget);
      }
      return renderContinuity(source, Math.min(this.#maxSummaryBytes, (args.maxSummaryBytes as number | undefined) ?? this.#maxSummaryBytes), budget);
    }
    if (name === "recall") {
      if ((args.offset as number | undefined ?? 0) > 0 && (args.expectedRevision === undefined || args.hash === undefined)) throw new Error("recall continuation requires revision and hash");
      if (args.hash !== undefined && args.expectedRevision === undefined) throw new Error("recall hash requires revision");
      const source = args.hash === undefined ? await this.#store.read(args.taskId, args.expectedRevision, context)
        : await this.#store.expandSource(args.taskId, args.expectedRevision, args.hash, context);
      return recallContinuity(source, args as unknown as ContinuityRecallArguments, budget);
    }
    if (name === "list") {
      const source = await this.#store.list(context);
      if (args.expectedIndexRevision !== undefined && args.expectedIndexRevision !== source.indexRevision) throw new Error("continuity task index changed; restart listing");
      const offset = (args.offset as number | undefined) ?? 0, limit = (args.limit as number | undefined) ?? 16;
      if (offset > source.tasks.length) throw new Error("continuity list offset is out of range");
      const result = { indexRevision: source.indexRevision, tasks: source.tasks.slice(offset, offset), total: source.tasks.length, nextOffset: null as number | null };
      for (const task of source.tasks.slice(offset, offset + limit)) {
        const nextOffset = offset + result.tasks.length + 1;
        const candidate = { ...result, tasks: [...result.tasks, task], nextOffset: nextOffset < source.tasks.length ? nextOffset : null };
        if (!fitsEnvelope(candidate, budget)) break;
        Object.assign(result, candidate);
      }
      if (offset < source.tasks.length && !result.tasks.length) throw new Error("continuity output budget too small for task metadata");
      return result;
    }
    const source = await this.#store.expandSource(args.taskId, args.expectedRevision, args.hash, context);
    const from = (args.fromSequence as number | undefined) ?? 1, limit = (args.limit as number | undefined) ?? 16;
    if (from > source.task.records.length + 1) throw new Error("continuity record sequence is out of range");
    const result = { taskId: source.task.taskId, revision: source.revision, hash: source.hash,
      records: source.task.records.slice(0, 0), total: source.task.records.length, nextSequence: null as number | null };
    for (const record of source.task.records.slice(from - 1, from - 1 + limit)) {
      const candidate = { ...result, records: [...result.records, record], nextSequence: record.sequence < result.total ? record.sequence + 1 : null };
      if (!fitsEnvelope(candidate, budget)) break;
      Object.assign(result, candidate);
    }
    if (from <= result.total && !result.records.length) throw new Error("continuity output budget too small for one exact record");
    return result;
  }
}
