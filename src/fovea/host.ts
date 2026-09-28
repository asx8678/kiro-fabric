import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { resolveFoveaGit } from "./git-executable.js";
import { LocalPaths } from "../providers/local-path.js";
import type { FabricInvocationContext } from "../protocol.js";
import { FabricRepairError } from "../core/repair-error.js";
import { fabricJsonText } from "../runtime/json-budget.js";
import { schemaValidationMessage } from "../schema-validation.js";
import { REPO_NAVIGATION_SCHEMA, compactRepoCoverage } from "../providers/repo-contract.js";
import { FoveaConfiguration, createFoveaDirectory, privateFoveaDirectory } from "./config.js";
import { FoveaEngineProcess } from "./engine-process.js";
import { FoveaRootLeases, type FoveaBindingAuthority, type FoveaLease } from "./root-leases.js";
import { FoveaResultStore, type ResultOwner } from "./result-store.js";
import { FoveaScheduler } from "./scheduler.js";
import { FoveaOutbox, type FoveaDeliveryClaim } from "./delivery.js";
import { FoveaCallContexts } from "./call-context.js";
import { record, type FoveaParserDescriptor } from "./protocol.js";
import type { FoveaObservation, FoveaObserver } from "./observations.js";
import { loadManagedSourcePlatform } from './native-source-loader.js';
import { FoveaProvenanceJournal, PROVENANCE_MAX_RECORDS, validProvenanceTransition, type ProvenanceTransition } from "./provenance-journal.js";

export interface FoveaHostOptions { dataRoot: string; configFile: string; parser?: FoveaParserDescriptor; entrypoint?: string; gitPath?: string }
export interface FoveaBoundClient {
  readonly rootId: string;
  invoke(operation: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<Record<string, unknown>>;
  observer: FoveaObserver;
  /** Host-owned, after source effects settle. Caller must qualify the delivery surface. */
  collectContext(context: FabricInvocationContext, maxChars: number, nextPrompt?: boolean): Promise<FoveaDeliveryClaim | undefined>;
  /** Same-call visible context from this invocation's observed files. Transient; does not persist conversation focus. */
  collectCallContext?(files: string[], context: FabricInvocationContext, maxChars: number, sampled?: boolean): Promise<FoveaDeliveryClaim | undefined>;
  /** Trusted delivery adapter only; never exposed through invoke/guest args. */
  acknowledgeDelivery(noticeId: string, context: FabricInvocationContext): Promise<void>;
  close(): Promise<void>;
}
/** Persistent MCP-host owner. Providers borrow a revocable binding; neither
 * provider.close nor QuickJS disposal owns engine shutdown. Native Kiro session
 * routing is not inferred from a path or guest-controlled session identifier. */
export class FoveaHost {
  readonly hostInstanceId = `fhost_${randomBytes(16).toString("hex")}`;
  readonly #lifetime = new AbortController();
  readonly #leases = new FoveaRootLeases();
  readonly #results = new FoveaResultStore();
  readonly #scheduler = new FoveaScheduler();
  readonly #outbox = new FoveaOutbox();
  readonly #calls = new FoveaCallContexts();
  readonly #conversations = new Map<string, { configuration: FoveaConfiguration; trustedRules: Map<string, string>; leases: Set<FoveaLease> }>();
  readonly #retirements = new Map<string, Promise<void>>();
  readonly #process: FoveaEngineProcess | undefined;
  readonly #observed = new Map<string, { paths: Set<string>; dirty: boolean; gap: boolean; operations: number }>();
  readonly #journal: Promise<FoveaProvenanceJournal | undefined>;
  #journalTail: Promise<void> = Promise.resolve();
  #pendingTransitions = 0;
  readonly #preparations = new Map<string, { noticeId: string; preparationId: string; generation: number }>();
  #closeTask: Promise<void> | undefined;
  constructor(readonly options: FoveaHostOptions) {
    const root = createFoveaDirectory(options.dataRoot, "fovea"), instances = createFoveaDirectory(root, "instances");
    const storageRoot = createFoveaDirectory(instances, this.hostInstanceId);
    this.#journal = (async () => {
      // Reuse complete-generation authentication, but capture in a host-owned
      // directory distinct from the engine's read-only binding copy.
      const platform = process.platform === 'darwin' && options.parser
        ? await loadManagedSourcePlatform(options.parser, createFoveaDirectory(storageRoot, 'provenance-native')) : undefined;
      return new FoveaProvenanceJournal(root, platform);
    })().catch(() => undefined); // unavailable storage is reported as a gap
    privateFoveaDirectory(path.dirname(options.configFile));
    const gitPath = resolveFoveaGit(options.gitPath);
    if (options.parser) this.#process = new FoveaEngineProcess({ parser: options.parser, storageRoot, ...(options.entrypoint ? { entrypoint: options.entrypoint } : {}), ...(gitPath ? { gitPath } : {}) });
  }
  bind(authority: FoveaBindingAuthority): FoveaBoundClient {
    this.#lifetime.signal.throwIfAborted();
    const lease = this.#leases.issue(authority);
    try { this.#conversation(lease).leases.add(lease); }
    catch (error) { this.#leases.revoke(lease); throw error; }
    const observer: FoveaObserver = { observe: event => this.#observe(lease, event), gap: () => { if (lease.signal.aborted || this.#lifetime.signal.aborted) return; const state = this.#observation(lease); state.gap = true; state.dirty = true; } };
    return { rootId: lease.rootId, observer, collectContext: (context, maxChars, nextPrompt) => this.#collectContext(lease, context, maxChars, nextPrompt), collectCallContext: (files, context, maxChars, sampled) => this.#collectCallContext(lease, files, context, maxChars, sampled === true), acknowledgeDelivery: (id, context) => this.#acknowledgeDelivery(lease, id, context), invoke: (operation, args, context) => this.#invoke(lease, operation, args, context), close: async () => { this.#release(lease); } };
  }
  #release(lease: FoveaLease): void {
    this.#leases.revoke(lease);
    this.#results.revoke(lease.rootId, lease.authorizationEpoch);
    this.#outbox.revoke(lease.rootId); this.#calls.revoke(lease.rootId);
    this.#observed.delete(lease.rootId); this.#preparations.delete(lease.rootId);
    this.#conversations.get(JSON.stringify([lease.conversationId, lease.conversationEpoch]))?.leases.delete(lease);
  }
  /** Trusted lifecycle only, never repo.*. Revocation is synchronous; completion
   * joins selective engine cleanup across ALL roots, even closed/replaced bindings.
   * Unlike binding.close/reset this forgets session settings and adopted trust.
   * The caller owns lifecycle authority and must not regrant a retired epoch. */
  retireConversation(conversationId: string, conversationEpoch: number): Promise<void> {
    if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(conversationId) || !Number.isSafeInteger(conversationEpoch) || conversationEpoch < 0) throw new Error("Invalid Navigator retirement owner");
    this.#lifetime.signal.throwIfAborted();
    const key = JSON.stringify([conversationId, conversationEpoch]);
    const pending = this.#retirements.get(key);
    if (pending) return pending;
    const controls = this.#conversations.get(key);
    if (!controls) return Promise.resolve();
    for (const lease of [...controls.leases]) this.#release(lease);
    controls.trustedRules.clear();
    // Keep the capacity reservation until cleanup settles; do not admit an
    // unlimited backlog or allow same-owner rebinding during retirement.
    const task = this.#scheduler.run(this.#lifetime.signal, async () => {
      await this.#process?.retireConversation(conversationId, conversationEpoch);
      this.#conversations.delete(key);
    }, true).then(() => { this.#retirements.delete(key); });
    // Failed cleanup stays latched: no same-owner regrant or silent eviction.
    this.#retirements.set(key, task);
    return task;
  }
  #conversation(lease: FoveaLease): { configuration: FoveaConfiguration; trustedRules: Map<string, string>; leases: Set<FoveaLease> } {
    const key = JSON.stringify([lease.conversationId, lease.conversationEpoch]);
    if (this.#retirements.has(key)) throw new Error("Navigator conversation retirement pending");
    let state = this.#conversations.get(key);
    if (!state) {
      // Retain controls across workspace-provider replacement, never inherit
      // them into another conversation/epoch or evict a live owner's choices.
      if (this.#conversations.size >= 128) throw new Error("Navigator conversation control capacity reached");
      state = { configuration: new FoveaConfiguration(this.options.configFile), trustedRules: new Map(), leases: new Set() };
      this.#conversations.set(key, state);
    }
    return state;
  }
  close(): Promise<void> {
    if (this.#closeTask) return this.#closeTask;
    const failures: unknown[] = [];
    this.#closeTask = Promise.resolve().then(async () => {
      for (const operation of [() => this.#journalTail, () => this.#journal, () => this.#process?.close()]) {
        try { await operation(); } catch (error) { failures.push(error); }
      }
      this.#conversations.clear(); this.#retirements.clear();
      this.#observed.clear(); this.#preparations.clear();
      if (failures.length) throw new AggregateError(failures, 'Navigator host cleanup failed', { cause: failures[0] });
    });
    // Install shared ownership before abort listeners can reenter close.
    for (const operation of [() => this.#lifetime.abort(new Error('Navigator host shutdown')), () => this.#leases.close(), () => this.#scheduler.close(), () => this.#results.clear(), () => this.#calls.clear()]) {
      try { operation(); } catch (error) { failures.push(error); }
    }
    return this.#closeTask;
  }
  #observation(lease: FoveaLease): { paths: Set<string>; dirty: boolean; gap: boolean; operations: number } {
    let state = this.#observed.get(lease.rootId);
    if (!state) { state = { paths: new Set(), dirty: false, gap: false, operations: 0 }; this.#observed.set(lease.rootId, state); }
    return state;
  }
  #observe(lease: FoveaLease, event: FoveaObservation): void {
    if (lease.signal.aborted || this.#lifetime.signal.aborted) return;
    if (!["access", "committed"].includes(event.phase)) return;
    const state = this.#observation(lease); state.operations++;
    for (const file of event.paths ?? []) {
      const relative = path.isAbsolute(file) ? path.relative(lease.canonicalPath, file) : file;
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
      if (state.paths.size >= 256) { state.gap = true; break; } state.paths.add(relative);
    }
    if (event.uncertain) state.gap = true;
    if (event.phase === "committed") {
      state.dirty = true;
      const transitions = event.transitions;
      if (!transitions?.length) { state.gap = true; return; }
      if (transitions.length > PROVENANCE_MAX_RECORDS || this.#pendingTransitions + transitions.length > 512) { state.gap = true; return; }
      // Synchronously copy the actual commit evidence; never reread source to
      // invent a before image. Admission happens in a microtask after source locks.
      const copied: ProvenanceTransition[] = [];
      for (const t of transitions) {
        const relative = path.isAbsolute(t.path) ? path.relative(lease.canonicalPath, t.path) : t.path;
        const item = { path: relative.split(path.sep).join('/'), beforeSha256: t.beforeSha256, afterSha256: t.afterSha256 };
        if (!validProvenanceTransition(item)) { state.gap = true; continue; }
        copied.push(item);
      }
      this.#pendingTransitions += copied.length;
      this.#journalTail = this.#journalTail.then(async () => {
        try {
          this.#lifetime.signal.throwIfAborted(); this.#leases.check(lease);
          const journal = await this.#journal;
          this.#lifetime.signal.throwIfAborted(); this.#leases.check(lease);
          if (!journal) throw new Error('Provenance storage unavailable');
          await journal.append(lease.worktreeId, this.#origin(lease), copied, AbortSignal.any([this.#lifetime.signal, lease.signal]));
        } catch { state.gap = true; state.dirty = true; }
        finally { this.#pendingTransitions -= copied.length; }
      });
    }
  }
  async #collectContext(lease: FoveaLease, context: FabricInvocationContext, maxChars: number, nextPrompt = false): Promise<FoveaDeliveryClaim | undefined> {
    this.#check(lease, {}, context);
    if (!Number.isSafeInteger(maxChars) || maxChars < 0 || maxChars > 131_072) throw new Error("Invalid Navigator delivery budget");
    // A host capability is required at the call site. Visible-only here: an
    // unqualified hidden mode must not silently become visible output.
    const config = this.#conversation(lease).configuration.read(lease.worktreeId).config;
    if (config.sync.mode !== "enabled" || !this.#observed.has(lease.rootId) || maxChars < 160) return undefined;
    await this.#invoke(lease, "sync", {}, context);
    this.#check(lease, {}, context);
    const claim = this.#outbox.claim(lease.rootId, lease.authorizationEpoch, maxChars, nextPrompt);
    if (!claim) return undefined;
    const cancel = (): void => claim.cancel();
    const signal = AbortSignal.any([lease.signal, this.#lifetime.signal, ...(context.signal ? [context.signal] : [])]);
    signal.throwIfAborted(); signal.addEventListener("abort", cancel, { once: true });
    const settle = (kind: "emitted" | "uncertain" | "cancel"): void => {
      signal.removeEventListener("abort", cancel);
      try { this.#check(lease, {}, context); claim[kind](); } catch { claim.cancel(); }
    };
    return { notices: claim.notices, isCurrent: () => { try { this.#check(lease, {}, context); return claim.isCurrent(); } catch { return false; } }, emitted: () => settle("emitted"), uncertain: () => settle("uncertain"), cancel: () => settle("cancel") };
  }
  async #collectCallContext(lease: FoveaLease, files: string[], context: FabricInvocationContext, maxChars: number, sampled = false): Promise<FoveaDeliveryClaim | undefined> {
    this.#check(lease, {}, context);
    if (!Number.isSafeInteger(maxChars) || maxChars < 0 || maxChars > 131_072) throw new Error("Invalid Navigator delivery budget");
    const config = this.#conversation(lease).configuration.read(lease.worktreeId).config;
    if (config.sync.mode !== "enabled" || !this.#process || this.#scheduler.busy || maxChars < 160) return undefined;
    if (!Array.isArray(files) || files.length < 1 || files.length > 16) return undefined;
    for (const file of files) {
      if (typeof file !== "string" || !file || file.length > 4096 || path.isAbsolute(file) || file.includes("\0") || file === ".." || file.startsWith(`..${path.sep}`) || path.normalize(file) !== file) return undefined;
    }
    const remaining = context.deadline?.remainingMs() ?? 0;
    const budget = this.#calls.budget(lease.rootId, this.#process.generation, remaining);
    if (budget < 100) return undefined;
    await this.#journalTail;
    this.#check(lease, {}, context);
    const signals = [lease.signal, this.#lifetime.signal, ...(context.signal ? [context.signal] : [])];
    const signal = AbortSignal.any(signals);
    let value: Record<string, unknown>;
    try {
      value = await this.#scheduler.run(signal, async () => {
        this.#check(lease, {}, context);
        const parameters: Record<string, unknown> = { files, includeUncommitted: false, maxTokens: Math.min(512, config.tools.defaultBudget), transient: true };
        const trustedRulesSha256 = this.#conversation(lease).trustedRules.get(lease.worktreeId);
        if (trustedRulesSha256) parameters.trustedRulesSha256 = trustedRulesSha256;
        return this.#process!.query({
          conversationId: lease.conversationId, conversationEpoch: lease.conversationEpoch, rootId: lease.rootId, root: lease.canonicalPath,
          authorizationEpoch: lease.authorizationEpoch, operation: "impact", args: parameters,
        }, signal, budget);
      });
      this.#check(lease, {}, context);
      this.#calls.analyzed(lease.rootId, this.#process.generation);
    } catch {
      if (!lease.signal.aborted && !this.#lifetime.signal.aborted) this.#calls.failed(lease.rootId);
      throw new Error("Navigator call context unavailable");
    }
    this.#check(lease, {}, context);
    const body = typeof value.text === "string" ? value.text.slice(0, 8_192) : "";
    if (!body) return undefined;
    const text = sampled ? `Sampled 16 observed files.\n${body}` : body;
    const snapshot = typeof value.sourceSnapshotId === "string" ? value.sourceSnapshotId : "none";
    const key = `call:${snapshot}:${createHash("sha256").update(files.join("\0")).digest("hex").slice(0, 16)}`;
    const claimSignal = AbortSignal.any([lease.signal, this.#lifetime.signal, ...(context.signal ? [context.signal] : [])]);
    return this.#calls.claim(lease.rootId, lease.authorizationEpoch, key, text, maxChars, claimSignal, () => this.#check(lease, {}, context));
  }
  #origin(lease: FoveaLease): string { return createHash('sha256').update(JSON.stringify([this.hostInstanceId, lease.conversationId, lease.conversationEpoch])).digest('hex'); }
  async #acknowledgeDelivery(lease: FoveaLease, noticeId: string, context: FabricInvocationContext): Promise<void> {
    this.#check(lease, {}, context);
    const signal = AbortSignal.any([lease.signal, this.#lifetime.signal, ...(context.signal ? [context.signal] : [])]);
    await this.#scheduler.run(signal, async () => {
      this.#check(lease, {}, context);
      const prepared = this.#preparations.get(lease.rootId);
      if (!this.#outbox.get(lease.rootId, lease.authorizationEpoch, noticeId)) throw new Error('Unknown delivery preparation');
      // A retained older notice may still be delivered after a clean/newer
      // reconciliation. It must never rewind the newer semantic baseline.
      if (prepared?.noticeId === noticeId && prepared.generation === this.#process?.generation) {
        await this.#process!.query({ conversationId: lease.conversationId, conversationEpoch: lease.conversationEpoch, rootId: lease.rootId, root: lease.canonicalPath, authorizationEpoch: lease.authorizationEpoch, operation: 'sync', args: { commitPreparationId: prepared.preparationId } }, signal, context.deadline?.remainingMs() ?? 120_000);
        this.#check(lease, {}, context);
        this.#preparations.delete(lease.rootId);
      }
      this.#outbox.remove(noticeId);
    });
  }
  #owner(lease: FoveaLease): ResultOwner { return { conversationId: lease.conversationId, conversationEpoch: lease.conversationEpoch, rootId: lease.rootId, authorizationEpoch: lease.authorizationEpoch, engineGeneration: this.#process?.generation ?? 0 }; }
  #check(lease: FoveaLease, args: Record<string, unknown>, context: FabricInvocationContext): void { this.#lifetime.signal.throwIfAborted(); context.signal?.throwIfAborted(); context.deadline?.throwIfExpired(); this.#leases.check(lease, args.rootId); }
  async #invoke(lease: FoveaLease, operation: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<Record<string, unknown>> {
    this.#check(lease, args, context);
    if (operation === "retireConversation") throw new Error("Private Navigator host operation");
    for (const key of ["commitPreparationId", "nativeProvenance", "trustedRulesSha256"]) if (key in args) throw new Error("Private Navigator host argument");
    await this.#journalTail;
    this.#check(lease, args, context);
    const controls = this.#conversation(lease), configuration = controls.configuration;
    if (operation === "status") {
      const state = this.#observed.get(lease.rootId), config = configuration.read(lease.worktreeId);
      return { schemaVersion: 1, advisory: true, hostInstanceId: this.hostInstanceId, engineGeneration: this.#process?.generation ?? 0, engineStarts: this.#process?.starts ?? 0, engineActive: this.#process?.active ?? false, cleanup: this.#process?.cleanup ?? null, retainedScratchGenerations: this.#process?.retainedScratchGenerations ?? 0, available: !!this.#process && !this.#process.unavailable, reason: this.#process?.unavailable ?? (this.#process ? null : "No admitted generation-matched parser; repository analysis unavailable"), rootId: lease.rootId, worktreeId: lease.worktreeId, authorizationEpoch: lease.authorizationEpoch, conversationEpoch: lease.conversationEpoch, conversationAssociation: "host-supplied conversation/epoch; native session lifecycle unqualified", scope: "whole verified root subject to analysis exclusions; focus filters are not access boundaries", coverage: "not checked by status", freshness: state?.dirty || state?.gap ? "reconciliation-required" : "unknown", observations: { operations: state?.operations ?? 0, attentionPaths: state?.paths.size ?? 0, gap: state?.gap ?? false }, notices: this.#outbox.status(lease.rootId, lease.authorizationEpoch), capabilities: { explicit: !!this.#process, automatic: false, nativeSessionRouting: false, hiddenDelivery: false, continuation: false, reason: "Native Kiro lifecycle/queue/delivery gates remain unqualified; no invented RPC or idle restart" }, requested: config.config, settingSupport: config.settingSupport };
    }
    if (operation === "adoptRules") {
      if (typeof args.expectedSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(args.expectedSha256)) throw new Error("Rule adoption requires exact local.read SHA-256");
      const source = new LocalPaths(lease.canonicalPath).read(".fovea/rules.json");
      if (source.snapshot.file?.sha256 !== args.expectedSha256) throw new Error("Rule source changed; reread before adoption");
      if (source.text.length > 32_000) throw new Error("Rule document exceeds 32000 characters");
      const document: unknown = JSON.parse(source.text);
      if (!record(document) || Object.keys(document).some(k => !["rules", "fileRoutes"].includes(k)) ||
          (document.rules !== undefined && (!Array.isArray(document.rules) || document.rules.length > 32)) ||
          (document.fileRoutes !== undefined && (!Array.isArray(document.fileRoutes) || document.fileRoutes.length > 32))) throw new Error("Invalid bounded declarative rule document");
      this.#check(lease, args, context);
      if (!controls.trustedRules.has(lease.worktreeId) && controls.trustedRules.size >= 32) throw new Error("Navigator conversation rule trust capacity reached");
      controls.trustedRules.set(lease.worktreeId, source.snapshot.file.sha256);
      return { schemaVersion: 1, adopted: true, sha256: source.snapshot.file.sha256, scope: "conversation-epoch exact canonical worktree and content", sourceMutation: false, note: "Rules were already published through normal local writes; only exact-content analysis trust changed" };
    }
    if (operation === "settings") return configuration.read(lease.worktreeId) as unknown as Record<string, unknown>;
    if (operation === "configure") return configuration.update(args.config, args.scope as "session" | "project" | "global", String(args.expectedRevision), lease.worktreeId) as unknown as Record<string, unknown>;
    if (operation === "result") return this.#results.page(this.#owner(lease), String(args.resultId), args.cursor as string | undefined, args.maxChars as number | undefined);
    if (operation === "searchResult") return this.#results.search(this.#owner(lease), String(args.resultId), String(args.query), args.limit as number | undefined);
    if (!this.#process) throw new FabricRepairError("Navigator analysis unavailable: no admitted generation-matched parser", { code: "provider_error", phase: "dispatch", dispatchState: "not_dispatched", effectOutcome: "none", ref: `repo.${operation}` });
    const signals = [lease.signal, this.#lifetime.signal, ...(context.signal ? [context.signal] : [])], signal = AbortSignal.any(signals);
    return this.#scheduler.run(signal, async () => {
      this.#check(lease, args, context);
      if (operation === "reload") {
        await this.#process!.restart();
        this.#check(lease, args, context); // Close/retirement may have revoked publication during restart.
        configuration.reload(lease.worktreeId); this.#results.clear(); this.#outbox.replay(); this.#calls.clear();
        return { schemaVersion: 1, restarted: true, scope: "process-wide", invalidates: "all engine navigation and retained results; not a session reset", codeTransition: "same generation only; update and restart session for new code" };
      }
      const { rootId: _rootId, ...parameters } = args;
      const config = configuration.read(lease.worktreeId).config;
      const trustedRulesSha256 = controls.trustedRules.get(lease.worktreeId);
      if (trustedRulesSha256) parameters.trustedRulesSha256 = trustedRulesSha256;
      if (operation === "sync") {
        const observed = this.#observed.get(lease.rootId);
        parameters.files = [...(observed?.paths ?? [])];
        parameters.maxTokens = config.sync.budget;
        parameters.scope = config.sync.scope; parameters.steerThreshold = config.sync.steerThreshold;
        parameters.pushFocus = config.sync.pushFocus;
        await this.#journalTail;
        this.#check(lease, args, context);
        const state = this.#observation(lease);
        try {
          const journal = await this.#journal;
          this.#check(lease, args, context);
          if (!journal) throw new Error('Provenance storage unavailable');
          parameters.nativeProvenance = { origin: this.#origin(lease), journal: await journal.read(lease.worktreeId), gap: state.gap };
        } catch { state.gap = true; parameters.nativeProvenance = { origin: this.#origin(lease), gap: true }; }
        this.#check(lease, args, context); // Native reads introduced an asynchronous revocation boundary.
      }
      const observedRevision = this.#observed.get(lease.rootId)?.operations;
      if (["focus", "sketch", "dwell", "impact", "augment"].includes(operation) && parameters.maxTokens === undefined) parameters.maxTokens = config.tools.defaultBudget;
      const value = await this.#process!.query({ conversationId: lease.conversationId, conversationEpoch: lease.conversationEpoch, rootId: lease.rootId, root: lease.canonicalPath, authorizationEpoch: lease.authorizationEpoch, operation: operation === "augment" ? "focus" : operation, args: operation === "augment" ? { ...parameters, transient: true } : parameters }, signal, context.deadline?.remainingMs() ?? 120_000);
      this.#check(lease, args, context);
      if (operation === "reset") { this.#results.revoke(lease.rootId, lease.authorizationEpoch); this.#outbox.revoke(lease.rootId); this.#calls.revoke(lease.rootId); this.#preparations.delete(lease.rootId); this.#observed.delete(lease.rootId); }
      if (["focus", "sketch", "dwell", "impact", "augment"].includes(operation)) {
        this.#observation(lease); // Explicit graph work authorizes attention, not delivery.
        const resultId = this.#results.put(this.#owner(lease), value);
        const packet: Record<string, unknown> = { schemaVersion: 1, advisory: true, resultId, rootId: lease.rootId, status: value.status, sourceSnapshotId: value.sourceSnapshotId, graphGeneration: value.graphGeneration, text: value.text, estimatedTokens: value.estimatedTokens, coverage: record(value.coverage) ? compactRepoCoverage(value.coverage) : value.coverage, reads: value.reads, truncated: value.truncated, ...(typeof value.focusId === "string" ? { focusId: value.focusId } : {}), ...(typeof value.focusRevision === "number" ? { focusRevision: value.focusRevision } : {}) };
        const error = schemaValidationMessage(REPO_NAVIGATION_SCHEMA, packet);
        if (error) throw new Error(`Navigator navigation contract: ${error}`);
        fabricJsonText(packet, Math.min(context.maxResultChars ?? 128_000, 128_000));
        return packet;
      }
      if (operation === "sync") {
        const observed = this.#observation(lease);
        // A host reconciliation consumes observation hints, not proof of delivery.
        if (observed.operations === observedRevision) observed.dirty = false;
        if (value.red === true && typeof value.text === "string" && value.text) {
          const details = record(value.details) ? value.details : undefined;
          const provenance = details && record(details.provenance) ? details.provenance.kind : undefined;
          const origin = provenance === "current-session" ? "own" : provenance === "other-session" ? "foreign" : provenance === "mixed" ? "mixed" : "unattributed";
          // Replay the same immutable notice for the same semantic snapshot,
          // including after emission. Never discard pending context on refresh.
          const key = typeof value.sourceSnapshotId === "string" ? value.sourceSnapshotId : undefined;
          const noticeId = this.#outbox.prepare(lease.rootId, lease.authorizationEpoch, value.text, origin, key);
          if (typeof value.syncPreparationId === "string") this.#preparations.set(lease.rootId, { noticeId, preparationId: value.syncPreparationId, generation: this.#process!.generation });
          return { ...value, noticeId, deliveryState: "prepared", delivered: false, automaticContinuation: false, observationGap: observed.gap || value.observationGap === true };
        }
        this.#preparations.delete(lease.rootId); // Clean baseline is independent of older, still-pending notices.
        return { ...value, deliveryState: "not-required", delivered: false, automaticContinuation: false, observationGap: observed.gap || value.observationGap === true };
      }
      if (!record(value)) throw new Error("Navigator returned invalid control response");
      return value;
    });
  }
}
