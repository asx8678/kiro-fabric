import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeResponse, encodeFrame, type FoveaEngineInitialization, type FoveaMessage, type FoveaQuery } from "./protocol.js";
import { localProcessGroupAlive } from "../providers/local-process-group.js";

const CRASH_BUDGET_UNAVAILABLE = "Fovea crash budget exceeded; same-generation reload required";

interface Pending { resolve(value: Record<string, unknown>): void; reject(error: Error): void }
export interface FoveaEngineProcessOptions extends FoveaEngineInitialization { entrypoint?: string }
/** One lazily started child per owning host. Requests are serialized by the host,
 * but cancellation and shutdown are out-of-band. No guest lifecycle owns this. */
export class FoveaEngineProcess {
  readonly #pending = new Map<string, Pending>();
  #child: ChildProcess | undefined;
  #start: Promise<void> | undefined;
  #stopping: Promise<void> | undefined;
  #closed = false;
  #failures: number[] = [];
  generation = 0;
  starts = 0;
  unavailable: string | undefined;
  constructor(readonly options: FoveaEngineProcessOptions) {}
  get active(): boolean { return !!this.#child && this.#child.exitCode === null; }
  async query(request: FoveaQuery, signal: AbortSignal, remainingMs: number): Promise<Record<string, unknown>> {
    signal.throwIfAborted(); const end = performance.now() + Math.min(900_000, remainingMs);
    await this.#ensure(); signal.throwIfAborted();
    const budget = Math.floor(end - performance.now());
    if (budget <= 0) throw new Error("Fovea request deadline expired during startup");
    const id = `q_${randomBytes(16).toString("hex")}`;
    let cancelled: Error | undefined, timer: NodeJS.Timeout | undefined, killTimer: NodeJS.Timeout | undefined;
    const cancel = (): void => {
      cancelled ??= new Error("Fovea request cancelled or timed out");
      try { this.#send({ version: 1, type: "cancel", id }); } catch { /* child failure settles pending */ }
      killTimer ??= setTimeout(() => { void this.#terminate(cancelled!).catch(() => { this.unavailable = "engine cleanup uncertain"; }); }, 250);
    };
    signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(cancel, budget);
    try {
      const result = await this.#request({ version: 1, type: "query", id, remainingMs: budget, request });
      if (cancelled || signal.aborted || performance.now() >= end) { await this.#terminate(cancelled ?? new Error("Fovea deadline expired before publication")); throw cancelled ?? new Error("Fovea request expired"); }
      return result;
    } finally {
      clearTimeout(timer); clearTimeout(killTimer); signal.removeEventListener("abort", cancel);
      if (cancelled) await this.#terminate(cancelled);
    }
  }
  /** Host scheduler only. Retiring an idle owner must never start a parser. */
  async retireConversation(conversationId: string, conversationEpoch: number): Promise<void> {
    if (this.#closed) throw new Error("Fovea host closed");
    // Losing the child reference does not prove its process group is gone.
    // Join an in-progress stop and preserve its failure latch before declaring
    // idle retirement complete. Crash-budget exhaustion alone has no live state.
    if (this.#stopping) await this.#stopping;
    if (this.#closed) throw new Error("Fovea host closed");
    if (this.unavailable && this.unavailable !== CRASH_BUDGET_UNAVAILABLE) throw new Error(this.unavailable);
    if (!this.active) return;
    const id = `retire_${randomBytes(16).toString("hex")}`;
    const timer = setTimeout(() => { void this.#terminate(new Error("Fovea retirement timed out")).catch(() => { this.unavailable = "engine cleanup uncertain"; }); }, 2_000);
    try {
      const response = await this.#request({ version: 1, type: "retireConversation", id, conversationId, conversationEpoch });
      if (response.retired !== true) throw new Error("Fovea retirement not confirmed");
    } catch (error) { await this.#terminate(new Error("Fovea retirement failed")); throw error; }
    finally { clearTimeout(timer); }
  }
  async restart(): Promise<void> {
    if (this.#closed) throw new Error("Fovea host closed");
    await this.#terminate(new Error("Fovea engine restart"));
    // Explicit recovery clears crash exhaustion only after confirmed cleanup.
    // Uncertain cleanup and other unavailability must remain latched.
    if (this.unavailable && this.unavailable !== CRASH_BUDGET_UNAVAILABLE) throw new Error(this.unavailable);
    this.#failures = []; this.unavailable = undefined;
  }
  async close(): Promise<void> { this.#closed = true; await this.#terminate(new Error("Fovea host shutdown")); }
  async #ensure(): Promise<void> {
    if (this.#closed || this.unavailable) throw new Error(this.unavailable ?? "Fovea host closed");
    if (this.#stopping) await this.#stopping;
    if (this.#start) return this.#start;
    this.#start = this.#spawn().catch(async error => { await this.#terminate(new Error("Fovea initialization failed"), true); throw error; });
    return this.#start;
  }
  async #spawn(): Promise<void> {
    const now = Date.now(); this.#failures = this.#failures.filter(t => now - t < 60_000);
    if (this.#failures.length >= 3) { this.unavailable = CRASH_BUDGET_UNAVAILABLE; throw new Error(this.unavailable); }
    const entrypoint = this.options.entrypoint ?? fileURLToPath(new URL("./engine-entry.js", import.meta.url));
    const stat = fs.lstatSync(entrypoint);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || fs.realpathSync(entrypoint) !== entrypoint) throw new Error("Fovea engine entrypoint identity invalid");
    const child = fork(entrypoint, [], { execPath: process.execPath, execArgv: [], cwd: this.options.storageRoot, env: { LANG: "C.UTF-8", LC_ALL: "C", TMPDIR: this.options.storageRoot }, detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "json" });
    this.#child = child; this.generation++; this.starts++;
    child.on("message", raw => {
      try {
        const response = decodeResponse(raw), pending = this.#pending.get(response.id);
        if (!pending) { void this.#terminate(new Error("Fovea unsolicited/replayed response"), true).catch(() => { this.unavailable = "engine cleanup uncertain"; }); return; }
        this.#pending.delete(response.id);
        if (response.ok) pending.resolve(response.value); else pending.reject(new Error(response.error));
      } catch { void this.#terminate(new Error("Fovea malformed response"), true).catch(() => { this.unavailable = "engine cleanup uncertain"; }); }
    });
    child.once("error", () => { void this.#terminate(new Error("Fovea engine process failed"), true).catch(() => { this.unavailable = "engine cleanup uncertain"; }); });
    child.once("exit", () => { void this.#terminate(new Error("Fovea engine exited"), true).catch(() => { this.unavailable = "engine cleanup uncertain"; }); });
    const id = `init_${randomBytes(8).toString("hex")}`;
    const timeout = setTimeout(() => { void this.#terminate(new Error("Fovea initialization timed out"), true).catch(() => { this.unavailable = "engine cleanup uncertain"; }); }, 5_000);
    const { parser, storageRoot, gitPath } = this.options;
    try { await this.#request({ version: 1, type: "initialize", id, options: { parser: { ...parser }, storageRoot, ...(gitPath ? { gitPath } : {}) } }); }
    finally { clearTimeout(timeout); }
  }
  #send(message: FoveaMessage): void {
    const child = this.#child;
    if (!child?.connected) throw new Error("Fovea engine disconnected");
    const encoded = encodeFrame(message);
    child.send(encoded, error => { if (error && this.#child === child) { void this.#terminate(new Error("Fovea engine send failed"), true).catch(() => { this.unavailable = "engine cleanup uncertain"; }); } });
  }
  #request(message: FoveaMessage): Promise<Record<string, unknown>> {
    if (this.#pending.size >= 4) return Promise.reject(new Error("Fovea IPC backpressure"));
    return new Promise((resolve, reject) => { this.#pending.set(message.id, { resolve, reject }); try { this.#send(message); } catch (error) { this.#pending.delete(message.id); reject(error); } });
  }
  #terminate(reason: Error, unexpected = false): Promise<void> {
    if (this.#stopping) return this.#stopping;
    const child = this.#child;
    // Count each failing generation once, not every healthy start/reload.
    if (unexpected && (child || this.#start)) this.#failures.push(Date.now());
    this.#child = undefined; this.#start = undefined;
    // Old exit/error events must never terminate a replacement child.
    child?.removeAllListeners("message"); child?.removeAllListeners("exit");
    child?.removeAllListeners("error"); child?.on("error", () => {});
    // Capture pending now; reject only after bounded process-group cleanup so
    // callers never observe a settled cancellation while descendants still run.
    const pending = [...this.#pending.values()]; this.#pending.clear();
    this.#stopping = (async () => {
      try {
        if (child?.pid) {
          const pid = child.pid, end = performance.now() + 1_500;
          try { process.kill(-pid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
          // Reap our own leader before a host-wide descendant census. Probing
          // its transient zombie forced a /proc sweep even for an idle engine;
          // a busy process table could exhaust the 200ms probe bound. This wait
          // consumes the SAME 1500ms cleanup deadline, never extends it.
          if (child.exitCode === null && child.signalCode === null) {
            await new Promise<void>((resolve, reject) => {
              const exited = (): void => { clearTimeout(timer); resolve(); };
              const timer = setTimeout(() => { child.removeListener("exit", exited); reject(new Error("Fovea leader reaping deadline exceeded")); }, Math.max(1, end - performance.now()));
              child.once("exit", exited);
            });
          }
          while (await localProcessGroupAlive(pid, end)) { if (performance.now() >= end) throw new Error("Fovea process-group cleanup uncertain"); await new Promise(resolve => setTimeout(resolve, 10)); }
          if (child.connected) child.disconnect();
        }
      } catch (error) { this.unavailable = "Fovea process-group cleanup uncertain"; throw error; }
      finally { for (const p of pending) p.reject(reason); }
    })().finally(() => { this.#stopping = undefined; });
    return this.#stopping;
  }
}
