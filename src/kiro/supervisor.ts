// Bounded child-process supervisor + newline-delimited JSON-RPC client for
// Kiro doctor probes. Children spawn detached (own process group) so a hard
// timeout or shutdown kills the whole tree: SIGTERM → grace → SIGKILL, then
// poll group disappearance. Protocol history and stderr are bounded.

import { spawn, type ChildProcess } from "node:child_process";
import { createProcessTreeController } from "../worker/process-tree.js";
import { formatJsonRpcError, parseJsonRpcFrame } from "./json-rpc-frame.js";

const STDERR_LIMIT = 4096;

export interface SupervisedProcessOptions {
  argv: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Hard lifetime; on expiry the process group is killed. */
  timeoutMs: number;
}

class ProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeError";
  }
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  method: string;
}

/**
 * Spawn a detached child speaking JSONL-RPC on stdio. Outbound methods are
 * recorded so callers can prove no billable method (session/prompt) was sent.
 */
export const spawnJsonRpcProcess = (options: SupervisedProcessOptions) => {
  const child: ChildProcess = spawn(options.argv[0]!, options.argv.slice(1), {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  // Attach an error handler before reading `pid`: a missing binary fails with
  // asynchronous ENOENT and `pid === undefined`, so the event must be captured
  // before it can escape as an uncaught ChildProcess "error".
  let earlySpawnError: Error | undefined;
  child.on("error", (error) => {
    earlySpawnError = error;
  });
  const pid = child.pid;
  if (pid === undefined) {
    throw new ProbeError(
      earlySpawnError
        ? `failed to spawn ${options.argv[0]}: ${earlySpawnError.message}`
        : `failed to spawn ${options.argv[0]}`,
    );
  }
  const processTree = createProcessTreeController(pid);

  const outboundMethods: string[] = [];
  const pending = new Map<number, PendingCall>();
  let buffer = "";
  let stderrTail = "";
  let nextId = 1;
  let closed = false;
  let fatal = false;
  let closeError: Error | null = null;
  let terminatePromise: Promise<{ escalated: boolean }> | undefined;

  const rejectAll = (error: Error): void => {
    closeError = error;
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  };
  const fail = (error: Error): void => {
    if (fatal || closed) return;
    fatal = true;
    // Reject first; process-tree cleanup is bounded but must never delay RPC
    // settlement after a fatal protocol violation.
    rejectAll(error);
    void terminate();
  };

  const timer = setTimeout(() => {
    fail(new ProbeError(
      `probe timed out after ${options.timeoutMs}ms: ${options.argv.join(" ")}`,
    ));
  }, options.timeoutMs);
  timer.unref?.();

  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    if (closed || fatal) return;
    buffer += chunk;
    if (Buffer.byteLength(buffer, "utf8") > 4 * 1024 * 1024) {
      fail(new ProbeError("oversized stdout frame from probe child"));
      return;
    }
    let index: number;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const parsed = parseJsonRpcFrame(line);
      if (!parsed.ok) {
        fail(new ProbeError(parsed.message));
        return;
      }
      if (parsed.kind !== "response") continue;
      const frame = parsed.frame;
      const id = frame.id as number;
      const call = pending.get(id);
      if (!call) {
        fail(new ProbeError(`probe response for unknown id ${id}`));
        return;
      }
      pending.delete(id);
      if (frame.error !== undefined) {
        call.reject(new ProbeError(formatJsonRpcError(call.method, frame.error)));
      } else {
        call.resolve(frame.result);
      }
    }
  });
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_LIMIT);
  });
  child.on("close", () => {
    if (!closed && !fatal && pending.size > 0) {
      fail(new ProbeError("probe child exited while requests were pending"));
    }
  });

  async function terminate(graceMs = 3_000, killMs = 2_000): Promise<{ escalated: boolean }> {
    if (terminatePromise) return terminatePromise;
    closed = true;
    clearTimeout(timer);
    rejectAll(closeError ?? new ProbeError("probe child is closed"));
    try {
      child.stdin?.end();
    } catch {
      // already closed
    }
    terminatePromise = processTree.terminate(graceMs, killMs);
    return terminatePromise;
  }

  const call = <T>(method: string, params: unknown): Promise<T> => {
    if (closed || fatal) {
      return Promise.reject(closeError ?? new ProbeError("probe child is closed"));
    }
    const id = nextId++;
    outboundMethods.push(method);
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<T>((resolvePromise, rejectPromise) => {
      pending.set(id, { resolve: resolvePromise as (value: unknown) => void, reject: rejectPromise, method });
      child.stdin!.write(frame + "\n", (error) => {
        if (error) {
          pending.delete(id);
          rejectPromise(new ProbeError(`failed writing ${method}: ${error.message}`));
        }
      });
    });
  };

  const notify = (method: string, params: unknown): void => {
    if (closed || fatal) return;
    outboundMethods.push(method);
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  };

  return {
    pid,
    call,
    notify,
    terminate,
    outboundMethods,
    get stderrTail() {
      return stderrTail;
    },
  };
};
