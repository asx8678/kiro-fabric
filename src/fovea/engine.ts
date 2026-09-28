import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, realpath, writeFile } from 'node:fs/promises';
import { FoveaScratchOwner } from './scratch-owner.js';
import { isAbsolute, join, resolve } from 'node:path';
import { coreContext, type CoreContext } from './core/context.js';
import { sketch, focus, dwell, impact, type OpResult, type FocusOptions } from './core/ops.js';
import { ensureState, getState } from './core/state.js';
import { gitHead } from './core/git.js';
import { sync, syncBaselineStore } from './core/sync.js';
import { provenancePathFor } from './core/provenance.js';
import { writeAtomicTemp } from './core/temp-storage.js';
import { validateProvenanceJournal } from './provenance-journal.js';
import { observeSessionPaths, type FoveaSession } from './core/session.js';
import { discoverFiles } from './core/build.js';
import { loadRepoRules, DEFAULT_PACK } from './core/anchors.js';
import { aggregateFiles, promote, posterior } from './core/discover.js';
import { boundResultDetails } from './core/result-budget.js';
import { SourceAccess, relativeStorageExclusion, type SourceRoot } from './source-access.js';
import { sourcePlatform } from './source-platform.js';
import { loadManagedSourcePlatform } from './native-source-loader.js';
import { resolveParserDescriptor, readVerifiedExecutable, type ParserDescriptor } from './parser-executable.js';

export interface FoveaEngineOptions {
  parser: ParserDescriptor;
  storageRoot: string;
  gitPath?: string | undefined;
}
export interface EngineRequest {
  conversationId: string;
  conversationEpoch: number;
  rootId: string;
  root: string;
  deviceId?: string;
  fileId?: string;
  authorizationEpoch: number;
  operation: string;
  args: Record<string, unknown>;
}
interface NavigationResult extends Record<string, unknown> {
  text: string;
  estimatedTokens: number;
  details: Record<string, unknown>;
  reads: Array<{ path: string; offset: number; limit: number; expectedSha256?: string }>;
  coverage: Record<string, unknown>;
  sourceSnapshotId: string;
  graphGeneration: string;
  status: 'ok' | 'no-match';
  focusId?: string;
  focusRevision?: number;
  truncated: boolean;
}
export type EngineResult = NavigationResult | Record<string, unknown>;
interface Conversation {
  store: Map<string, unknown>;
  focuses: Map<string, number>;
  active: string;
}
interface RootState { path: string; store: Map<string, unknown>; snapshotId?: string; snapshotHashes?: Map<string, string>; head?: string | undefined; hot: boolean; gap: boolean }
interface NativeBaseline { hashes: Map<string, string>; sequence: number }

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function strings(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 1000 || value.some(v => typeof v !== 'string' || v.length > 4096)) throw new Error('Expected bounded string array');
  return value as string[];
}
function number(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Numeric argument out of range');
  return value;
}
function cloneStore(store: Map<string, unknown>): Map<string, unknown> {
  return new Map([...store].map(([key, value]) => [key, value instanceof WeakMap ? new WeakMap() : structuredClone(value)]));
}

/** Persistent instance-owned adapter. The host owns authorization and retained result IDs. */
export class FoveaEngine {
  private readonly options: FoveaEngineOptions;
  private readonly lifetime = new AbortController();
  private tail: Promise<unknown> = Promise.resolve();
  private directory: string | undefined;
  private parser: ParserDescriptor | undefined;
  private source: SourceAccess | undefined;
  private git: string | undefined;
  private readonly roots = new Map<string, RootState>();

  private readonly conversations = new Map<string, Conversation>();
  private readonly preparedSync = new Map<string, { id: string; conversation: Conversation }>();
  private closed = false;
  private closeTask: Promise<void> | undefined;
  private scratch: FoveaScratchOwner | undefined;
  private cleanupFailure: unknown;
  constructor(options: FoveaEngineOptions) {
    this.options = { ...options, parser: { ...options.parser } };
    if (!isAbsolute(options.storageRoot)) throw new Error('Navigator storageRoot must be absolute');
  }
  query(request: EngineRequest, signal?: AbortSignal): Promise<EngineResult> {
    // Copy before queueing: caller mutation must not change a scheduled capability.
    const input = structuredClone(request);
    const combined = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    const run = this.tail.then(async () => {
      if (this.closed || this.cleanupFailure) throw new Error('Navigator engine closed or cleanup uncertain', { cause: this.cleanupFailure });
      combined.throwIfAborted();
      const result = await this.execute(input, combined);
      combined.throwIfAborted();
      return result;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
  /** Private lifecycle control: no source access, parser initialization or graph
   * invalidation. Serialized with queries so a late query cannot resurrect state. */
  retireConversation(conversationId: string, conversationEpoch: number): Promise<void> {
    const run = this.tail.then(() => {
      if (this.closed || this.cleanupFailure) throw new Error('Navigator engine closed or cleanup uncertain', { cause: this.cleanupFailure });
      if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(conversationId) || !Number.isSafeInteger(conversationEpoch) || conversationEpoch < 0) throw new Error('Invalid Navigator retirement owner');
      for (const map of [this.conversations, this.preparedSync]) for (const key of map.keys()) {
        const owner = JSON.parse(key) as [string, number, string];
        if (owner[0] === conversationId && owner[1] === conversationEpoch) map.delete(key);
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
  private async initialize(signal: AbortSignal): Promise<void> {
    if (this.parser) return;
    await mkdir(this.options.storageRoot, { recursive: true, mode: 0o700 });
    const info = await lstat(this.options.storageRoot);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || info.uid !== process.getuid?.() || await realpath(this.options.storageRoot) !== this.options.storageRoot) {
      throw new Error('Navigator storageRoot must be canonical, private, and owned');
    }
    signal.throwIfAborted();
    const scratch = new FoveaScratchOwner(this.options.storageRoot);
    this.scratch = scratch;
    try {
      const directory = await scratch.createRoot(signal);
      const parser = await resolveParserDescriptor(this.options.parser, directory, signal);
      let git: string | undefined;
      if (this.options.gitPath) {
        const bytes = await readVerifiedExecutable(this.options.gitPath);
        git = join(directory, 'git');
        await writeFile(git, bytes, { flag: 'wx', mode: 0o500 });
      }
      const source = new SourceAccess(process.platform === 'darwin'
        ? await loadManagedSourcePlatform(this.options.parser, directory) : sourcePlatform());
      signal.throwIfAborted();
      this.directory = directory; this.parser = parser; this.git = git; this.source = source;
    } catch (error) {
      try { await scratch.close(); this.scratch = undefined; }
      catch (cleanup) { this.cleanupFailure = cleanup; throw new AggregateError([error, cleanup], 'Navigator initialization and scratch cleanup failed', { cause: error }); }
      throw error;
    }
  }
  private async execute(request: EngineRequest, signal: AbortSignal): Promise<EngineResult> {
    const { operation, args } = request;
    if (!['sketch', 'focus', 'dwell', 'impact', 'status', 'anchors', 'rules', 'reset', 'reload', 'sync'].includes(operation)) throw new Error(`Unsupported Navigator operation: ${operation}`);
    if (!object(args) || !request.conversationId || !request.rootId || !Number.isSafeInteger(request.conversationEpoch) || request.conversationEpoch < 0 || !Number.isSafeInteger(request.authorizationEpoch) || request.authorizationEpoch < 0) throw new Error('Invalid engine request identity');
    const identity = await lstat(request.root, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error("Navigator root must be a physical directory");
    const expected = { deviceId: String(identity.dev), fileId: String(identity.ino) };
    if ((request.deviceId !== undefined || request.fileId !== undefined) && (request.deviceId !== expected.deviceId || request.fileId !== expected.fileId)) throw new Error('Navigator authorized filesystem identity changed');
    if (['status', 'reset', 'reload'].includes(operation) || operation === 'sync' && args.commitPreparationId !== undefined) return this.executeAtRoot(request, signal, expected);
    await this.initialize(signal);
    const sourceRoot = await this.source!.openRoot(request.root, expected, signal);
    try { return await this.executeAtRoot(request, signal, sourceRoot, sourceRoot); }
    finally { await sourceRoot.handle.close(); }
  }
  private async executeAtRoot(request: EngineRequest, signal: AbortSignal, identity: { deviceId: string; fileId: string }, sourceRoot?: SourceRoot): Promise<EngineResult> {
    const { operation, args } = request;
    // Authorization is checked by the host for every call; cache identity never grants access.
    const rootKey = JSON.stringify([request.root, identity.deviceId, identity.fileId]);
    const conversationKey = JSON.stringify([request.conversationId, request.conversationEpoch, rootKey]);
    // Private host-only acknowledgment. Guests must never supply this field.
    if (operation === 'sync' && args.commitPreparationId !== undefined) {
      const prepared = this.preparedSync.get(conversationKey);
      if (!prepared || prepared.id !== args.commitPreparationId) throw new Error('Unknown or superseded sync preparation');
      signal.throwIfAborted();
      const current = this.conversations.get(conversationKey);
      // Delivery commits baseline/memory, never overwrites newer user focus.
      const navigation = current?.store.get('session.ts:sessions');
      if (navigation) prepared.conversation.store.set('session.ts:sessions', navigation);
      if (current) { prepared.conversation.focuses = current.focuses; prepared.conversation.active = current.active; }
      this.conversations.set(conversationKey, prepared.conversation);
      this.preparedSync.delete(conversationKey);
      return { status: 'ok', deliveryAccounting: 'acknowledged', syncPreparationId: prepared.id };
    }
    if (operation === 'status') return { status: 'ok', initialized: !!this.parser, roots: this.roots.size, hotRoots: [...this.roots.values()].filter(r => r.hot).length, rootLimit: 32, hotRootLimit: 2,
      conversationLoaded: this.conversations.has(conversationKey), parser: { version: this.options.parser.version, sha256: this.options.parser.sha256, verified: !!this.parser },
      sourceAccess: this.source || process.platform === 'linux' ? 'descriptor-relative' : 'requires-managed-native-binding', gitConfigured: !!this.options.gitPath };
    if (operation === 'reset' || operation === 'reload') {
      signal.throwIfAborted();
      this.conversations.delete(conversationKey);
      this.preparedSync.delete(conversationKey);
      if (operation === 'reload') this.roots.get(rootKey)?.store.clear();
      return { status: 'ok', operation, reset: 'conversation-root', ...(operation === 'reload' ? { graphInvalidated: true } : {}) };
    }
    let root = this.roots.get(rootKey);
    if (!root) {
      if (this.roots.size >= 32) {
        const oldest = this.roots.keys().next().value!;
        await this.retireRoot(oldest, true);
      }
      root = { path: join(this.directory!, `root-${randomUUID()}`), store: new Map(), hot: false, gap: true };
      this.roots.set(rootKey, root);
    }
    // Metadata LRU and heavyweight residency are independent. Derivable graphs
    // and conversation vectors expire together; cached roots never grant access.
    this.roots.delete(rootKey); this.roots.set(rootKey, root);
    if (!root.hot) {
      const hot = [...this.roots.entries()].filter(([, r]) => r.hot);
      if (hot.length >= 2) await this.retireRoot(hot[0]![0], false);
      root.hot = true;
    }
    if (operation === 'dwell' && root.gap && !this.conversations.has(conversationKey)) throw new Error('Unknown or expired focusId after root retirement; focus again');
    const original = this.conversations.get(conversationKey) ?? { store: new Map(), focuses: new Map<string, number>(), active: '' };
    if (!this.conversations.has(conversationKey) && this.conversations.size >= 128) throw new Error('Navigator conversation capacity reached');
    const conversation: Conversation = { store: cloneStore(original.store), focuses: new Map(original.focuses), active: original.active };
    const transient = args.transient === true;
    let focusId = typeof args.focusId === 'string' ? args.focusId : conversation.active;
    if (typeof args.focusId === 'string' && !conversation.focuses.has(args.focusId)) throw new Error('Unknown or expired conversation-owned focusId');
    // Omitted focusId uses this conversation/root's default focus, never another caller's.
    if (operation === 'focus' && (!focusId || args.fresh === true)) focusId = randomUUID();
    if (!focusId) focusId = 'transient';
    const stage = await this.scratch!.createStage(signal);
    const ctx: CoreContext = { store: root.store, sessionStore: conversation.store, parserPath: this.parser!.path,
      storageRoot: this.directory!, sourceRoot: request.root, snapshotRoot: root.path, gitPath: this.git,
      cleanupTemporary: (file, snapshot, available) => this.scratch!.removeTemporary(file, snapshot, available),
      readGitMetadata: async path => {
        signal.throwIfAborted();
        const text = await this.source!.readScopeSafeFile(sourceRoot!, resolve(request.root, path), 1024 * 1024);
        if (text === undefined) throw new Error('Git shallow metadata unavailable');
        return text;
      },
      signal, gitFailures: [], focusKey: focusId, spills: new Map(), artifactLabel: operation => `retained:${operation}`,
      displayName: 'Navigator', toolName: operation => `repo.${operation}` };
    return coreContext.run(ctx, async () => {
      let primary: { error: unknown } | undefined;
      try {
        const snapshot = await this.source!.captureSourceSnapshot(sourceRoot!, stage, signal, { exclude: relativeStorageExclusion(request.root, this.options.storageRoot),
          trustedRulesSha256: typeof args.trustedRulesSha256 === 'string' ? args.trustedRulesSha256 : undefined,
          ...(root.snapshotId && root.snapshotHashes ? { previous: { id: root.snapshotId, root: root.path, hashes: root.snapshotHashes } } : {}) });
        signal.throwIfAborted();
        const snapshotReused = snapshot.root === root.path && root.snapshotId === snapshot.id;
        if (!snapshotReused) {
          await this.removeScratchTree(root.path);
          signal.throwIfAborted();
          await this.scratch!.moveStage(stage, root.path);
        }
        const head = this.git ? await gitHead(root.path) : undefined;
        const cached = getState(root.path);
        let warm = snapshotReused && head === root.head ? cached : undefined;
        if (cached && this.git) {
          const { fileRoutes } = await loadRepoRules(root.path);
          const listing = await discoverFiles(root.path, fileRoutes.map(route => new RegExp(route.re)), cached.store.enrolled);
          if (JSON.stringify(listing.files) !== JSON.stringify(cached.files) || JSON.stringify(listing.report) !== JSON.stringify(cached.discovery)) {
            await this.clearRootStore(root);
            warm = undefined;
          }
        }
        const state = warm ?? await ensureState(root.path, { force: true, hints: [...snapshot.hashes.keys()] });
        signal.throwIfAborted();
        root.snapshotId = snapshot.id; root.snapshotHashes = snapshot.hashes; root.head = head;
        signal.throwIfAborted();
        const budget = number(args.maxTokens ?? args.budget, 512, operation === 'sync' ? 128 : 256, operation === 'sync' ? 8192 : 16000);
        let result: OpResult;
        if (operation === 'anchors' || operation === 'rules') {
          if (args.adopt !== undefined || args.rules !== undefined || args.action === 'adopt') throw new Error('Rule adoption is not implemented; inspect rules only');
          const offset = Math.floor(number(args.offset, 0, 0, 1_000_000));
          const limit = Math.floor(number(args.limit, 100, 1, 1000));
          let value: Record<string, unknown>;
          if (operation === 'anchors') {
            const filter = typeof args.filter === 'string' ? args.filter : '';
            // Build each anchor's sort key once instead of twice per comparison:
            // sorting n anchors with per-compare template strings is O(n log n)
            // allocations. Code-unit key order is locale-independent.
            const anchorKey = (anchor: (typeof state.graph.anchors)[number]): string => `${anchor.kind}\t${anchor.id}\t${anchor.file}:${anchor.line}`;
            const rows = state.graph.anchors
              .map(anchor => [anchorKey(anchor), anchor] as const)
              .filter(([key, anchor]) => (!args.discovered || anchor.implicit) && (!filter || key.includes(filter)))
              .sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)
              .map(([, anchor]) => anchor);
            value = { anchors: rows.slice(offset, offset + limit), total: rows.length, offset, limit, truncated: offset + limit < rows.length };
          } else {
            const sigs = aggregateFiles(Object.fromEntries(Object.entries(state.facts).map(([file, facts]) => [file, facts.sigs])));
            const hypotheses = promote(sigs, DEFAULT_PACK);
            const rows = args.sigs === true ? sigs.filter(s => s.pathN > 0).sort((a, b) => posterior(b.pathN, b.n) - posterior(a.pathN, a.n)) : hypotheses;
            const pack = await loadRepoRules(root.path);
            value = { rules: rows.slice(offset, offset + limit), total: rows.length, offset, limit, truncated: offset + limit < rows.length,
              inventory: { rules: pack.pack.slice(offset, offset + limit), totalRules: pack.pack.length, fileRoutes: pack.fileRoutes.slice(offset, offset + limit), totalFileRoutes: pack.fileRoutes.length, offset, limit, truncated: offset + limit < Math.max(pack.pack.length, pack.fileRoutes.length) },
              rulePackSha: pack.sha, readOnly: true, trust: args.trustedRulesSha256 ? 'host-approved-hash' : 'built-in-only', hypotheses: true };
          }
          signal.throwIfAborted();
          return { status: 'ok', ...boundResultDetails(value), sourceSnapshotId: snapshot.id, graphGeneration: state.generation, coverage: snapshot.coverage };
        }
        if (operation === 'sync') {
          const navigationBeforePush = conversation.store.get('session.ts:sessions');
          const savedNavigation = navigationBeforePush ? structuredClone(navigationBeforePush) : undefined;
          const attention = strings(args.files);
          if (attention?.length) observeSessionPaths(root.path, attention);
          const native = await this.bridgeProvenance(request, root, conversation, snapshot.hashes, state.facts, identity.deviceId, identity.fileId);
          let outcome: Awaited<ReturnType<typeof sync>>;
          let syncFailure: { error: unknown } | undefined;
          try { outcome = await sync(root.path, { files: strings(args.files), budget,
            steerThreshold: number(args.steerThreshold, 0.15, 0, 1_000_000), pushFocus: args.pushFocus !== false,
            scope: args.scope === 'repository' ? 'repository' : 'session', sessionId: native.origin,
          }, state, { current: () => !signal.aborted });
          } catch (error) { syncFailure = { error }; throw error; }
          finally {
            try { await this.removeScratchFiles(native.paths); }
            catch (cleanup) { throw syncFailure ? new AggregateError([syncFailure.error, cleanup], 'Navigator sync and temporary cleanup failed', { cause: syncFailure.error }) : cleanup; }
          }
          conversation.store.set('native:provenance', { hashes: new Map(snapshot.hashes), sequence: native.sequence });
          signal.throwIfAborted();
          // Sync's push focus is transient: retain baselines, not disclosure/vector changes.
          if (savedNavigation) conversation.store.set('session.ts:sessions', savedNavigation);
          else conversation.store.delete('session.ts:sessions');
          const observationGap = native.gap || root.gap;
          let syncPreparationId: string | undefined;
          if (!transient && outcome.red) {
            syncPreparationId = randomUUID();
            this.preparedSync.set(conversationKey, { id: syncPreparationId, conversation });
            while (this.preparedSync.size > 128) this.preparedSync.delete(this.preparedSync.keys().next().value!);
          } else if (!transient) {
            root.gap = false;
            this.conversations.set(conversationKey, conversation);
            this.preparedSync.delete(conversationKey);
          }
          return { observationGap, syncPreparationId, deliveryAccounting: outcome.red ? 'prepared' : 'silent-baseline', status: 'ok', ...outcome, details: boundResultDetails(outcome.details), text: this.cleanText(outcome.text ?? ''), estimatedTokens: outcome.tokens,
            sourceSnapshotId: snapshot.id, graphGeneration: state.generation, coverage: { ...snapshot.coverage, gitFailures: [...new Set(ctx.gitFailures)].slice(0, 10) } };
        }
        if (operation === 'sketch') result = await sketch(root.path, budget, state);
        else if (operation === 'focus') {
          if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 4096) throw new Error('focus requires a bounded query');
          const options: FocusOptions = {};
          if (typeof args.path === 'string') options.path = args.path;
          if (typeof args.language === 'string') options.language = args.language;
          if (typeof args.kind === 'string') options.kind = args.kind as FocusOptions['kind'];
          if (args.fresh === true) options.fresh = true;
          result = await focus(root.path, args.query, budget, options, state);
        } else if (operation === 'dwell') result = await dwell(root.path, number(args.factor, 2, 1, 64), budget, state);
        else {
          if ((args.base !== undefined || args.includeUncommitted !== false) && !this.git) throw new Error('Git-backed impact requires an explicit verified gitPath; use includeUncommitted:false for what-if analysis');
          result = await impact(root.path, { files: strings(args.files), symbols: strings(args.symbols),
            includeUncommitted: args.includeUncommitted !== false, ...(typeof args.base === 'string' ? { base: args.base } : {}), budget }, state);
        }
        signal.throwIfAborted();
        const details = { ...result.details };
        delete details.overflowPath;
        const retained = [...ctx.spills.values()];
        if (retained.length) { details.fullText = retained.join('\n').slice(0, 200_000); details.retentionCapped = retained.some(text => text.length >= 200_000); }
        const reads: NavigationResult['reads'] = [];
        const deferredReads: NavigationResult['reads'] = [];
        if (Array.isArray(details.suggestedReads)) for (const read of details.suggestedReads) {
          if (object(read) && typeof read.path === 'string' && typeof read.offset === 'number' && typeof read.limit === 'number') {
            const hash = snapshot.hashes.get(read.path);
            if (hash && Number.isSafeInteger(read.offset) && read.offset > 0 && Number.isSafeInteger(read.limit) && read.limit > 0) {
              for (let offset = read.offset, remaining = read.limit; remaining > 0; offset += 2000, remaining -= 2000) {
                const window = { path: read.path, offset, limit: Math.min(2000, remaining), expectedSha256: hash };
                if (reads.length < 64) reads.push(window);
                else if (deferredReads.length < 960) deferredReads.push(window);
                else { details.readWindowRetentionCapped = true; break; }
              }
            }
          }
        }
        details.suggestedReads = reads;
        if (deferredReads.length) { details.readsDeferred = true; details.deferredReads = deferredReads; }
        details.snapshotReused = snapshotReused;
        details.observationGap = root.gap;
        const boundedDetails = boundResultDetails(details);
        const packet: NavigationResult = { text: this.cleanText(result.text), estimatedTokens: Math.ceil(this.cleanText(result.text).length / 4), details: boundedDetails, reads,
          coverage: boundResultDetails({ ...(object(details.coverage) ? details.coverage : {}), source: snapshot.coverage, gitFailures: [...new Set(ctx.gitFailures)].slice(0, 10) }, 100_000, 4000),
          sourceSnapshotId: snapshot.id, graphGeneration: state.generation, status: details.seeds === 0 ? 'no-match' : 'ok', truncated: details.truncated === true || boundedDetails.detailsTruncated === true };
        if ((operation === 'focus' || operation === 'dwell') && packet.status === 'ok' && !transient) {
          const revision = (conversation.focuses.get(focusId) ?? 0) + 1;
          conversation.focuses.set(focusId, revision); conversation.active = focusId;
          packet.focusId = focusId; packet.focusRevision = revision;
        }
        signal.throwIfAborted();
        if (!transient && !(operation === 'focus' && packet.status === 'no-match')) {
          const sessions = conversation.store.get('session.ts:sessions') as Map<string, FoveaSession> | undefined;
          for (const id of conversation.focuses.keys()) if (!sessions?.has(`${root.path}:${id}`)) conversation.focuses.delete(id);
          if (!conversation.focuses.has(conversation.active)) conversation.active = '';
          this.conversations.set(conversationKey, conversation);
        }
        return packet;
      } catch (error) {
        // Never reuse partially refreshed state or forget in-flight filesystem work.
        primary = { error };
        try { await this.clearRootStore(root); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Navigator query and maintenance failed', { cause: error }); }
        delete root.snapshotId; delete root.snapshotHashes;
        throw error;
      } finally {
        const failures: unknown[] = [];
        try { await this.removeScratchTree(stage); } catch (error) { failures.push(error); }
        if (signal.aborted) {
          try { await this.clearRootStore(root); } catch (error) { failures.push(error); }
          delete root.snapshotId; delete root.snapshotHashes;
          this.preparedSync.delete(conversationKey);
          if (original.active || original.store.size) this.conversations.set(conversationKey, original);
          else this.conversations.delete(conversationKey);
          failures.push(signal.reason);
        }
        if (failures.length) throw new AggregateError([...(primary ? [primary.error] : []), ...failures], 'Navigator query/cleanup failed', { cause: primary?.error ?? failures[0] });
      }
    });
  }
  private async retireRoot(key: string, remove: boolean): Promise<void> {
    const root = this.roots.get(key);
    if (!root) return;
    // A store belongs to exactly one physical root. No other root's caches or
    // semaphore are cleared, and pending per-root persistence timers are stopped.
    await this.clearRootStore(root);
    root.hot = false; root.gap = true;
    delete root.snapshotId; delete root.snapshotHashes; delete root.head;
    for (const conversationKey of this.conversations.keys()) if (JSON.parse(conversationKey)[2] === key) this.conversations.delete(conversationKey);
    for (const conversationKey of this.preparedSync.keys()) if (JSON.parse(conversationKey)[2] === key) this.preparedSync.delete(conversationKey);
    await this.removeScratchTree(root.path);
    if (remove) this.roots.delete(key);
  }
  /** Adapt only exact captured SHA-256 endpoints to core's SHA-1 fact IDs.
   * Intermediate identities are tagged SHA-256 tokens, never claimed as SHA-1.
   * Core v1 journal records are engine-private, ephemeral inputs to the unchanged
   * native core chain classifier. Only the host journal is shared across hosts. */
  private async bridgeProvenance(request: EngineRequest, root: RootState, conversation: Conversation,
    hashes: Map<string, string>, facts: Record<string, { sha1: string }>, dev: string, ino: string): Promise<{ paths: string[]; origin: string; sequence: number; gap: boolean }> {
    const input = request.args.nativeProvenance;
    const origin = object(input) && typeof input.origin === 'string' && /^[a-f0-9]{64}$/u.test(input.origin) ? input.origin : 'unobserved';
    const result = { paths: [] as string[], origin, sequence: 0, gap: origin === 'unobserved' || !object(input) || input.gap === true };
    if (!object(input) || !object(input.journal)) return result;
    const worktree = createHash('sha256').update(`${request.root}\0${dev}\0${ino}`).digest('hex');
    let journal;
    try { journal = validateProvenanceJournal(input.journal, worktree); } catch { result.gap = true; return result; }
    result.sequence = journal.sequence;
    const previous = conversation.store.get('native:provenance') as NativeBaseline | undefined;
    const baseline = syncBaselineStore().get(root.path);
    // First entry is a baseline, not evidence about work preceding observation.
    if (!previous || !baseline) return result;
    if (previous.sequence > journal.sequence || previous.sequence < journal.sequence - journal.records.length) { result.gap = true; return result; }
    if (result.gap) return result;
    const mapHash = (file: string, hash: string | null): string | undefined => {
      if (hash === null) return undefined;
      if (hash === previous.hashes.get(file) && baseline.shas.has(file)) return baseline.shas.get(file);
      if (hash === hashes.get(file) && facts[file]) return facts[file].sha1;
      return `sha256:${hash}`;
    };
    const byOwner = new Map<string, Array<Record<string, unknown>>>();
    // Fractional timestamps retain the journal's total commit admission order,
    // even for interleaved owners in the same millisecond. No wall-clock claim
    // about the source mutation is made: these are fresh classifier inputs.
    const at = Date.now();
    for (const r of journal.records) {
      if (r.sequence <= previous.sequence) continue;
      const owner = createHash('sha1').update(r.origin).digest('hex').slice(0, 16);
      const rows = byOwner.get(r.origin) ?? [];
      rows.push({ file: r.path, beforeSha: mapHash(r.path, r.beforeSha256), afterSha: mapHash(r.path, r.afterSha256), owner,
        toolCallId: String(r.sequence), commitOrder: r.sequence, at: at + (r.sequence - previous.sequence) / 1000 });
      byOwner.set(r.origin, rows);
    }
    try {
      for (const [ownerOrigin, records] of byOwner) {
        const target = provenancePathFor(root.path, ownerOrigin);
        await writeAtomicTemp(target, JSON.stringify({ version: 1, root: root.path, owner: createHash('sha1').update(ownerOrigin).digest('hex').slice(0, 16), records }), 128_000);
        await this.scratch!.captureFile(target);
        result.paths.push(target);
      }
    } catch {
      await this.removeScratchFiles(result.paths);
      result.paths = []; result.gap = true;
    }
    return result;
  }
  private cleanText(text: string): string {
    return text.replace(/full list saved to retained:[a-z]+/g, 'full list retained in result');
  }
  private async clearRootStore(root: RootState): Promise<void> {
    const timers = root.store.get('build.ts:persistDebounce');
    if (timers instanceof Map) for (const timer of timers.values()) clearTimeout(timer as NodeJS.Timeout);
    const maintenance = root.store.get('maintenance') as { value?: { pending?: Promise<void> } } | undefined;
    await maintenance?.value?.pending;
    root.store.clear();
  }
  private async removeScratchTree(directory: string): Promise<void> {
    try {
      if (!this.scratch) throw new Error('Navigator scratch ownership unavailable; preserve evidence');
      await this.scratch.removeTree(directory);
    } catch (error) { this.cleanupFailure ??= error; throw error; }
  }
  private async removeScratchFiles(files: string[]): Promise<void> {
    const failures: unknown[] = [];
    for (const file of files) try {
      if (!this.scratch) throw new Error('Navigator temporary ownership unavailable');
      await this.scratch.removeFile(file);
    } catch (error) { failures.push(error); }
    if (failures.length) { this.cleanupFailure ??= failures[0]; throw new AggregateError(failures, 'Navigator temporary cleanup failed'); }
  }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closed = true;
    this.closeTask = Promise.resolve().then(async () => {
      const failures: unknown[] = this.cleanupFailure === undefined ? [] : [this.cleanupFailure];
      try { await this.tail; } catch (error) { failures.push(error); }
      for (const key of [...this.roots.keys()]) try { await this.retireRoot(key, true); } catch (error) { failures.push(error); }
      this.conversations.clear(); this.preparedSync.clear();
      try {
        if (this.scratch) await this.scratch.close();
        else if (this.directory) throw new Error('Navigator scratch ownership unavailable; preserve evidence');
      } catch (error) { failures.push(error); }
      if (this.cleanupFailure !== undefined && !failures.includes(this.cleanupFailure)) failures.unshift(this.cleanupFailure);
      if (failures.length) throw new AggregateError(failures, 'Navigator scratch cleanup failed; retained evidence', { cause: failures[0] });
    });
    this.lifetime.abort(new Error('Navigator engine closed'));
    return this.closeTask;
  }
}
