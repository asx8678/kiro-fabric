// Production ACP JSON-RPC process: detached process group, bounded NDJSON
// frames, request/notification/response classification, and SIGTERM→SIGKILL
// shutdown that rejects every pending call exactly once.

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { createProcessTreeController } from "../worker/process-tree.js";
import { formatJsonRpcError, parseJsonRpcFrame } from "./json-rpc-frame.js";

const NODE_SCRIPT_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"]);
const DEFAULT_MAX_FRAME_BYTES = 4 * 1024 * 1024;

export class AcpProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcpProcessError";
  }
}

export interface AcpJsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params: unknown;
}

export interface AcpJsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: unknown;
}

export interface AcpProcessOptions {
  argv: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Optional hard lifetime; on expiry the process group is killed. */
  timeoutMs?: number;
  maxFrameBytes?: number;
  onRequest?: (request: AcpJsonRpcRequest) => void;
  onNotification?: (notification: AcpJsonRpcNotification) => void;
  /** Called synchronously before a correlated outbound response settles. */
  onResponse?: (method: string) => void;
  onStderr?: (chunk: string) => void;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  method: string;
}

const spawnCommand = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
): ChildProcess =>
  NODE_SCRIPT_EXTENSIONS.has(path.extname(command).toLowerCase())
    ? spawn(process.execPath, [command, ...args], {
        cwd: options.cwd,
        env: options.env,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      })
    : spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });

export const spawnAcpProcess = (options: AcpProcessOptions) => {
  if (options.argv.length === 0) {
    throw new AcpProcessError("ACP process argv is empty");
  }
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  const child = spawnCommand(options.argv[0]!, options.argv.slice(1), {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
  });
  // Node emits an asynchronous ENOENT for a missing binary even though
  // `child.pid` is already undefined. Capture it before inspecting `pid` so
  // the throw below cannot race an uncaught "error" event on the ChildProcess.
  let earlySpawnError: Error | undefined;
  child.on("error", (error) => {
    earlySpawnError = error;
  });
  const pid = child.pid;
  if (pid === undefined) {
    throw new AcpProcessError(
      earlySpawnError
        ? `failed to spawn ${options.argv[0]}: ${earlySpawnError.message}`
        : `failed to spawn ${options.argv[0]}`,
    );
  }
  const processTree = createProcessTreeController(pid);

  const outboundMethods: string[] = [];
  const pending = new Map<number, PendingCall>();
  let buffer = "";
  let stderrBytes = 0;
  let nextId = 1;
  let closed = false;
  let closeError: Error | null = null;
  let lastEscalated = false;
  let fatal = false;
  let terminatePromise: Promise<{ escalated: boolean }> | undefined;

  const rejectAll = (error: Error): void => {
    closeError = error;
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  };

  const fail = (error: Error): void => {
    if (fatal) return;
    fatal = true;
    rejectAll(error);
    void terminate();
  };

  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          fail(
            new AcpProcessError(
              `ACP process timed out after ${options.timeoutMs}ms: ${options.argv.join(" ")}`,
            ),
          );
        }, options.timeoutMs);
  timer?.unref?.();

  const dispatchFrame = (parsed: Record<string, unknown>): void => {
    if (typeof parsed.method === "string") {
      const params = parsed.params === undefined ? {} : parsed.params;
      if (parsed.id !== undefined && parsed.id !== null) {
        options.onRequest?.({
          jsonrpc: "2.0",
          id: parsed.id as number | string,
          method: parsed.method,
          params,
        });
        return;
      }
      options.onNotification?.({
        jsonrpc: "2.0",
        method: parsed.method,
        params,
      });
      return;
    }
    const id = parsed.id as number;
    const call = pending.get(id);
    if (!call) {
      fail(new AcpProcessError(`ACP response for unknown id ${id}`));
      return;
    }
    pending.delete(id);
    options.onResponse?.(call.method);
    if (parsed.error !== undefined) {
      call.reject(new AcpProcessError(formatJsonRpcError(call.method, parsed.error)));
      return;
    }
    call.resolve(parsed.result);
  };

  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    if (closed || fatal) return;
    buffer += chunk;
    const frames: Record<string, unknown>[] = [];
    let index: number;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (Buffer.byteLength(raw, "utf8") > maxFrameBytes) {
        fail(new AcpProcessError("oversized stdout frame from ACP child"));
        return;
      }
      const line = raw.trim();
      if (!line) continue;
      if (Buffer.byteLength(line, "utf8") > maxFrameBytes) {
        fail(new AcpProcessError("oversized stdout frame from ACP child"));
        return;
      }
      const parsed = parseJsonRpcFrame(line);
      if (!parsed.ok) {
        fail(new AcpProcessError(parsed.message));
        return;
      }
      frames.push(parsed.frame);
    }
    if (Buffer.byteLength(buffer, "utf8") > maxFrameBytes) {
      fail(new AcpProcessError("oversized stdout frame from ACP child"));
      return;
    }
    for (const frame of frames) {
      if (closed || fatal) return;
      dispatchFrame(frame);
    }
  });
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    stderrBytes += Buffer.byteLength(chunk, "utf8");
    options.onStderr?.(chunk);
  });
  // `exit` may fire before stdout has drained. Wait for `close`, which is
  // emitted after the stdio streams close, so a final malformed/oversized
  // frame remains the authoritative failure instead of a generic exit race.
  child.on("close", () => {
    if (closed || fatal) return;
    if (pending.size > 0) {
      fail(new AcpProcessError("ACP process exited while requests were pending"));
    }
  });

  async function terminate(graceMs = 3_000, killMs = 2_000): Promise<{ escalated: boolean }> {
    if (terminatePromise) return terminatePromise;
    terminatePromise = terminateOnce(graceMs, killMs);
    return terminatePromise;
  }

  async function terminateOnce(graceMs: number, killMs: number): Promise<{ escalated: boolean }> {
    if (closed) return { escalated: lastEscalated };
    closed = true;
    if (timer) clearTimeout(timer);
    const error = closeError ?? new AcpProcessError("ACP process closed");
    rejectAll(error);
    try {
      child.stdin?.end();
    } catch {
      // already closed
    }
    const result = await processTree.terminate(graceMs, killMs);
    lastEscalated = result.escalated;
    return result;
  }

  const writeFrame = (frame: Record<string, unknown>): void => {
    if (closed || fatal) {
      throw closeError ?? new AcpProcessError("ACP process is closed");
    }
    child.stdin!.write(`${JSON.stringify(frame)}\n`, (error) => {
      if (error) {
        fail(new AcpProcessError(`failed writing ACP frame: ${error.message}`));
      }
    });
  };

  const call = <T>(method: string, params: unknown): Promise<T> => {
    if (closed || fatal) {
      return Promise.reject(closeError ?? new AcpProcessError("ACP process is closed"));
    }
    const id = nextId++;
    outboundMethods.push(method);
    return new Promise<T>((resolvePromise, rejectPromise) => {
      pending.set(id, {
        resolve: resolvePromise as (value: unknown) => void,
        reject: rejectPromise,
        method,
      });
      try {
        writeFrame({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        pending.delete(id);
        rejectPromise(error instanceof Error ? error : new AcpProcessError(String(error)));
      }
    });
  };

  const notify = (method: string, params: unknown): void => {
    if (closed || fatal) return;
    outboundMethods.push(method);
    try {
      writeFrame({ jsonrpc: "2.0", method, params });
    } catch {
      // shutdown already in progress
    }
  };

  const respond = (id: number | string, result: unknown): void => {
    if (closed || fatal) return;
    try {
      writeFrame({ jsonrpc: "2.0", id, result });
    } catch {
      // shutdown already in progress
    }
  };

  const respondError = (id: number | string, code: number, message: string): void => {
    if (closed || fatal) return;
    try {
      writeFrame({ jsonrpc: "2.0", id, error: { code, message } });
    } catch {
      // shutdown already in progress
    }
  };

  return {
    pid,
    outboundMethods,
    call,
    notify,
    respond,
    respondError,
    terminate,
    get closed() {
      return closed;
    },
    get stderrTail() {
      return stderrBytes > 0
        ? `ACP child stderr redacted (${stderrBytes} bytes)`
        : "";
    },
  };
};

export type AcpProcess = ReturnType<typeof spawnAcpProcess>;
