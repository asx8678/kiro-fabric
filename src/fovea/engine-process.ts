import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeResponse, encodeFrame, type FoveaEngineInitialization, type FoveaMessage, type FoveaQuery } from './protocol.js';
import { localProcessGroupAlive } from '../providers/local-process-group.js';

const CRASH_BUDGET_UNAVAILABLE = 'Navigator crash budget exceeded; same-generation reload required';
const CLEANUP_MS = 1_500, GRACE_MS = 500;
const deferred = (): { promise: Promise<void>; resolve(): void; reject(error: unknown): void } => {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const groupAliveWithin = async (pid: number, end: number): Promise<boolean> => {
  const remaining = end - performance.now();
  if (remaining <= 0) throw new Error('Navigator process-group cleanup deadline exceeded');
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([localProcessGroupAlive(pid, end), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Navigator process-group census deadline exceeded')), remaining);
    })]);
  } finally { clearTimeout(timer); }
};
interface Pending { child: ChildProcess; resolve(value: Record<string, unknown>): void; reject(error: Error): void }
interface Cleanup { generation: number; mode: 'graceful' | 'forced' | 'uncertain'; processGroup: 'confirmed' | 'uncertain'; scratch: 'removed' | 'retained' }
export interface FoveaEngineProcessOptions extends FoveaEngineInitialization { entrypoint?: string }
/** Host-owned lazy child. Admission and cleanup ownership are separate: a
 * stopping/failed child remains owned, but can never accept another request. */
export class FoveaEngineProcess {
  readonly #pending = new Map<string, Pending>();
  #child: ChildProcess | undefined;
  #start: Promise<void> | undefined;
  #stopping: Promise<void> | undefined;
  #closeTask: Promise<void> | undefined;
  #failure: Error | undefined;
  #closed = false;
  #failures: number[] = [];
  #cleanup: Cleanup | undefined;
  generation = 0;
  starts = 0;
  retainedScratchGenerations = 0;
  unavailable: string | undefined;
  constructor(readonly options: FoveaEngineProcessOptions) {}
  get active(): boolean { return !this.#stopping && !this.#failure && !!this.#child && this.#child.exitCode === null && this.#child.signalCode === null; }
  get cleanup(): Cleanup | undefined { return this.#cleanup ? { ...this.#cleanup } : undefined; }
  #available(): void {
    if (this.#failure) throw this.#failure;
    if (this.#closed || this.unavailable) throw new Error(this.unavailable ?? 'Navigator host closed');
  }
  async query(request: FoveaQuery, signal: AbortSignal, remainingMs: number): Promise<Record<string, unknown>> {
    signal.throwIfAborted(); this.#available();
    const end = performance.now() + Math.min(900_000, remainingMs);
    if (!(end > performance.now())) throw new Error('Navigator request deadline expired before startup');
    let id: string | undefined, child: ChildProcess | undefined, cancelled: Error | undefined, primary: unknown;
    let killTimer: NodeJS.Timeout | undefined, cancellation: Promise<void> | undefined;
    const stop = (): void => {
      if (child && this.#child !== child) return; // A retired request never owns a newer child.
      cancellation ??= this.#terminate(cancelled ?? new Error('Navigator request expired'));
      void cancellation.catch(() => {});
    };
    const cancel = (): void => {
      cancelled ??= new Error(id ? 'Navigator query cancelled or timed out (lazy parser/query phase)' : 'Navigator cancelled or timed out during IPC initialization');
      if (!id) { stop(); return; }
      try { this.#send({ version: 1, type: 'cancel', id }); } catch { /* stop still owns cleanup */ }
      killTimer ??= setTimeout(stop, 250);
    };
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, Math.max(1, Math.floor(end - performance.now())));
    try {
      await this.#ensure(signal, end);
      signal.throwIfAborted(); this.#available();
      if (cancelled || performance.now() >= end) throw cancelled ?? new Error('Navigator request deadline expired during IPC initialization');
      child = this.#child;
      id = `q_${randomBytes(16).toString('hex')}`;
      const result = await this.#request({ version: 1, type: 'query', id, remainingMs: Math.max(1, Math.floor(end - performance.now())), request });
      if (cancelled || signal.aborted || performance.now() >= end) { cancel(); stop(); await cancellation; throw cancelled!; }
      this.#available();
      if (this.#child !== child) throw new Error('Navigator generation retired before publication');
      return result;
    } catch (error) { primary = error; throw error; }
    finally {
      clearTimeout(timer); clearTimeout(killTimer); signal.removeEventListener('abort', cancel);
      if (cancelled) {
        stop();
        try { await cancellation; } catch (cleanup) { throw new AggregateError([primary ?? cancelled, cleanup], 'Navigator cancellation and cleanup failed', { cause: primary ?? cancelled }); }
      }
    }
  }
  /** Idle owner retirement never starts the parser or another child. */
  async retireConversation(conversationId: string, conversationEpoch: number): Promise<void> {
    if (this.#closed) throw new Error('Navigator host closed');
    if (this.#stopping) await this.#stopping;
    if (this.#closed) throw new Error('Navigator host closed');
    if (this.#failure) throw this.#failure;
    if (this.unavailable && this.unavailable !== CRASH_BUDGET_UNAVAILABLE) throw new Error(this.unavailable);
    if (!this.active) return;
    const child = this.#child, id = `retire_${randomBytes(16).toString('hex')}`;
    const timer = setTimeout(() => { if (this.#child === child) void this.#terminate(new Error('Navigator retirement timed out')).catch(() => {}); }, 2_000);
    try {
      const response = await this.#request({ version: 1, type: 'retireConversation', id, conversationId, conversationEpoch });
      if (response.retired !== true) throw new Error('Navigator retirement not confirmed');
      if (this.#closed || this.#child !== child) throw new Error('Navigator retirement interrupted by close');
    } catch (error) {
      try { if (this.#child === child) await this.#terminate(new Error('Navigator retirement failed')); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Navigator retirement and cleanup failed', { cause: error }); }
      throw error;
    } finally { clearTimeout(timer); }
  }
  async restart(): Promise<void> {
    if (this.#closed) throw new Error('Navigator host closed');
    await this.#terminate(new Error('Navigator engine restart'), false, true);
    if (this.#closed) throw new Error('Navigator host closed during restart');
    if (this.#failure) throw this.#failure;
    if (this.unavailable && this.unavailable !== CRASH_BUDGET_UNAVAILABLE) throw new Error(this.unavailable);
    this.#failures = []; this.unavailable = undefined;
  }
  close(): Promise<void> {
    if (this.#closeTask) return this.#closeTask;
    const close = deferred(); this.#closeTask = close.promise;
    this.#closed = true;
    this.#terminate(new Error('Navigator host shutdown'), false, true).then(close.resolve, close.reject);
    return close.promise;
  }
  async #ensure(signal: AbortSignal, end: number): Promise<void> {
    this.#available(); signal.throwIfAborted();
    if (this.#stopping) await this.#stopping;
    this.#available(); signal.throwIfAborted();
    if (performance.now() >= end) throw new Error('Navigator request deadline expired before spawn');
    if (!this.#start) {
      // Install before invoking fork/send or any reentrant host boundary.
      const start = Promise.resolve().then(() => this.#spawn(signal, end));
      this.#start = start;
      void start.catch(() => { if (this.#start === start) this.#start = undefined; });
    }
    await this.#start;
    this.#available(); signal.throwIfAborted();
  }
  async #spawn(signal: AbortSignal, end: number): Promise<void> {
    this.#available(); signal.throwIfAborted();
    if (this.#stopping || performance.now() >= end) throw new Error('Navigator spawn admission revoked');
    const now = Date.now(); this.#failures = this.#failures.filter(t => now - t < 60_000);
    if (this.#failures.length >= 3) { this.unavailable = CRASH_BUDGET_UNAVAILABLE; throw new Error(this.unavailable); }
    const entrypoint = this.options.entrypoint ?? fileURLToPath(new URL('./engine-entry.js', import.meta.url));
    const stat = fs.lstatSync(entrypoint);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || fs.realpathSync(entrypoint) !== entrypoint) throw new Error('Navigator engine entrypoint identity invalid');
    this.#available(); signal.throwIfAborted();
    if (this.#stopping) throw new Error('Navigator spawn admission revoked');
    const child = fork(entrypoint, [], { execPath: process.execPath, execArgv: [], cwd: this.options.storageRoot, env: { LANG: 'C.UTF-8', LC_ALL: 'C', TMPDIR: this.options.storageRoot }, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json' });
    this.#child = child; const generation = ++this.generation; this.starts++;
    const current = (): boolean => this.#child === child && this.generation === generation && !this.#stopping;
    const fail = (message: string): void => { if (current()) void this.#terminate(new Error(message), true).catch(() => {}); };
    child.on('message', raw => {
      if (!current()) return;
      try {
        const response = decodeResponse(raw), pending = this.#pending.get(response.id);
        if (!pending || pending.child !== child) { fail('Navigator unsolicited/replayed response'); return; }
        this.#pending.delete(response.id);
        if (response.ok) pending.resolve(response.value); else pending.reject(new Error(response.error));
      } catch { fail('Navigator malformed response'); }
    });
    child.once('error', () => fail('Navigator engine process failed'));
    child.once('exit', () => fail('Navigator engine exited'));
    const timeout = setTimeout(() => fail('Navigator initialization timed out'), 5_000);
    const { parser, storageRoot, gitPath } = this.options;
    try {
      this.#available(); signal.throwIfAborted();
      if (this.#stopping) throw new Error('Navigator initialization admission revoked');
      await this.#request({ version: 1, type: 'initialize', id: `init_${randomBytes(8).toString('hex')}`, options: { parser: { ...parser }, storageRoot, ...(gitPath ? { gitPath } : {}) } });
    } catch (error) {
      try { if (this.#child === child) await this.#terminate(new Error('Navigator initialization failed'), true); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Navigator initialization and cleanup failed', { cause: error }); }
      throw error;
    } finally { clearTimeout(timeout); }
  }
  #send(message: FoveaMessage): void {
    const child = this.#child, generation = this.generation;
    if (!child?.connected || this.#stopping) throw new Error('Navigator engine disconnected/stopping');
    child.send(encodeFrame(message), error => { if (error && this.#child === child && this.generation === generation && !this.#stopping) void this.#terminate(new Error('Navigator engine send failed'), true).catch(() => {}); });
  }
  #request(message: FoveaMessage): Promise<Record<string, unknown>> {
    if (!this.#child || this.#stopping || this.#pending.size >= 4) return Promise.reject(new Error('Navigator IPC unavailable/backpressure'));
    const child = this.#child;
    return new Promise((resolve, reject) => { this.#pending.set(message.id, { child, resolve, reject }); try { this.#send(message); } catch (error) { this.#pending.delete(message.id); reject(error); } });
  }
  #terminate(reason: Error, unexpected = false, graceful = false): Promise<void> {
    if (this.#stopping) return this.#stopping;
    if (this.#failure) return Promise.reject(this.#failure);
    const operation = deferred(); this.#stopping = operation.promise;
    const end = performance.now() + CLEANUP_MS;
    const pending = [...this.#pending.values()]; this.#pending.clear(); this.#start = undefined;
    // Defer resource capture one microtask so a reentrant close during fork owns
    // the returned child instead of prematurely declaring an empty shutdown.
    void (async () => {
      await Promise.resolve();
      const child = this.#child, generation = this.generation;
      if (unexpected && child) this.#failures.push(Date.now());
      let acknowledged = false, mode: Cleanup['mode'] = 'forced', cleanupError: Error | undefined;
      try {
        child?.removeAllListeners('message'); child?.removeAllListeners('exit'); child?.removeAllListeners('error'); child?.on('error', () => {});
        if (child?.pid) {
          const exited = (): boolean => child.exitCode !== null || child.signalCode !== null;
          if (graceful && pending.length === 0 && child.connected && !exited()) {
            const id = `shutdown_${randomBytes(16).toString('hex')}`;
            await new Promise<void>(resolve => {
              let finished = false;
              const finish = (): void => { if (finished) return; finished = true; clearTimeout(timer); child.removeListener('message', response); child.removeListener('exit', exit); resolve(); };
              const exit = (): void => { if (acknowledged || cleanupError) finish(); };
              const response = (raw: unknown): void => {
                if (finished || this.#child !== child || this.generation !== generation) return;
                try {
                  const value = decodeResponse(raw);
                  if (value.id !== id) return;
                  if (!value.ok) { cleanupError = new Error(`Navigator graceful cleanup failed: ${value.error}`); finish(); return; }
                  const cleanup = value.value.cleanup as Record<string, unknown> | undefined;
                  if (value.value.shutdown !== true || value.value.closed !== true || cleanup?.scratch !== 'removed') { cleanupError = new Error('Navigator graceful cleanup acknowledgement invalid'); finish(); return; }
                  acknowledged = true; if (exited()) finish();
                } catch { cleanupError = new Error('Navigator malformed shutdown acknowledgement'); finish(); }
              };
              const timer = setTimeout(finish, Math.max(0, Math.min(GRACE_MS, end - performance.now())));
              child.on('message', response); child.once('exit', exit);
              try { child.send(encodeFrame({ version: 1, type: 'shutdown', id }), error => { if (error) finish(); }); } catch { finish(); }
            });
          }
          if (acknowledged && exited() && !cleanupError) mode = 'graceful';
          else {
            try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
          }
          if (!exited()) await new Promise<void>((resolve, reject) => {
            const exit = (): void => { clearTimeout(timer); resolve(); };
            const timer = setTimeout(() => { child.removeListener('exit', exit); reject(new Error('Navigator leader reaping deadline exceeded')); }, Math.max(0, end - performance.now()));
            child.once('exit', exit);
            if (exited()) { child.removeListener('exit', exit); clearTimeout(timer); resolve(); }
          });
          while (await groupAliveWithin(child.pid, end)) {
            if (performance.now() >= end) throw new Error('Navigator process-group cleanup uncertain');
            // A graceful leader exit does not prove its descendants exited.
            if (mode === 'graceful') { mode = 'forced'; try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
            await new Promise(resolve => setTimeout(resolve, Math.min(10, Math.max(0, end - performance.now()))));
          }
          if (child.connected) child.disconnect();
        }
        this.#cleanup = { generation, mode, processGroup: 'confirmed', scratch: mode === 'graceful' && !cleanupError ? 'removed' : 'retained' };
        if (child && mode !== 'graceful') this.retainedScratchGenerations++;
        if (cleanupError) throw cleanupError;
        if (this.#child === child) this.#child = undefined;
        for (const p of pending) p.reject(reason);
        this.#stopping = undefined; operation.resolve();
      } catch (error) {
        const failure = error instanceof Error ? error : new Error('Navigator cleanup failed', { cause: error });
        this.#failure = failure; this.unavailable = 'Navigator cleanup uncertain; owning host restart required';
        this.#cleanup = { generation, mode: 'uncertain', processGroup: cleanupError === error ? 'confirmed' : 'uncertain', scratch: 'retained' };
        for (const p of pending) p.reject(new AggregateError([reason, failure], 'Navigator request and cleanup failed', { cause: reason }));
        this.#stopping = undefined; operation.reject(failure); // Child/failure ownership stays retained.
      }
    })();
    return operation.promise;
  }
}
