import { Worker } from "node:worker_threads";
import { throwIfAborted } from "../async-settlement.js";

export interface RegexLimits {
  maxPatternBytes: number;
  timeoutMs: number;
}

export interface RegexExecutionError {
  code: "invalid_regex" | "regex_pattern_too_large" | "regex_timeout" | "regex_worker_error";
  message: string;
}

export type RegexExecutionResult =
  | { complete: true; matched: number[] }
  | { complete: false; matched: []; error: RegexExecutionError };

const WORKER_SOURCE = String.raw`
const { parentPort } = require("node:worker_threads");
parentPort.on("message", ({ pattern, flags, haystacks }) => {
  try {
    const regex = new RegExp(pattern, flags);
    const matched = [];
    for (let index = 0; index < haystacks.length; index += 1) {
      if (regex.test(haystacks[index])) matched.push(index);
    }
    parentPort.postMessage({ matched });
  } catch (error) {
    parentPort.postMessage({
      error: {
        code: "invalid_regex",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
`;

const workerError = (error: unknown): RegexExecutionResult => ({
  complete: false,
  matched: [],
  error: {
    code: "regex_worker_error",
    message: error instanceof Error ? error.message : String(error),
  },
});

/**
 * One disposable worker with one aggregate deadline. Callers that scan several
 * batches can reuse it without multiplying worker startup cost or timeout.
 */
export class BoundedRegexWorkerSession {
  readonly #worker: Worker;
  readonly #pattern: string;
  readonly #flags: string;
  readonly #timeoutMs: number;
  readonly #deadline: number;
  #closed = false;
  #workerFailure: unknown;

  constructor(pattern: string, limits: RegexLimits, flags = "iu") {
    const patternBytes = Buffer.byteLength(pattern, "utf8");
    if (patternBytes > limits.maxPatternBytes) {
      throw new RangeError(`Regex pattern is ${patternBytes} bytes; limit is ${limits.maxPatternBytes}.`);
    }
    this.#pattern = pattern;
    this.#flags = flags;
    this.#timeoutMs = limits.timeoutMs;
    this.#deadline = performance.now() + limits.timeoutMs;
    this.#worker = new Worker(WORKER_SOURCE, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4 },
    });
    // Keep an error listener installed even between batches so a worker failure
    // can never become an uncaught process-level event.
    this.#worker.on("error", (error: unknown) => { this.#workerFailure = error; });
  }

  async execute(haystacks: string[], signal?: AbortSignal): Promise<RegexExecutionResult> {
    throwIfAborted(signal);
    if (this.#closed) return workerError(new Error("Regex worker session is closed."));
    if (this.#workerFailure) return workerError(this.#workerFailure);
    const remaining = this.#deadline - performance.now();
    if (remaining <= 0) return this.#timeoutResult();

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (result: RegexExecutionResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.#worker.removeListener("message", onMessage);
        this.#worker.removeListener("error", onError);
        resolve(result);
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.#worker.removeListener("message", onMessage);
        this.#worker.removeListener("error", onError);
        reject(signal?.reason instanceof Error ? signal.reason : new Error("Operation aborted"));
      };
      const onMessage = (message: unknown): void => {
        const record = message as { matched?: unknown; error?: RegexExecutionError };
        if (record.error) {
          finish({ complete: false, matched: [], error: record.error });
        } else if (Array.isArray(record.matched) && record.matched.every((value) => Number.isInteger(value))) {
          finish({ complete: true, matched: record.matched as number[] });
        } else {
          finish(workerError(new Error("Regex worker returned an invalid result.")));
        }
      };
      const onError = (error: unknown): void => finish(workerError(error));
      const timer = setTimeout(() => finish(this.#timeoutResult()), remaining);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#worker.once("message", onMessage);
      this.#worker.once("error", onError);
      this.#worker.postMessage({ pattern: this.#pattern, flags: this.#flags, haystacks });
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#worker.terminate();
  }

  #timeoutResult(): RegexExecutionResult {
    return {
      complete: false,
      matched: [],
      error: {
        code: "regex_timeout",
        message: `Regex execution exceeded ${this.#timeoutMs} ms.`,
      },
    };
  }
}

/** Execute untrusted regex in a disposable worker that can be forcibly terminated. */
export const executeBoundedRegex = async (
  pattern: string,
  haystacks: string[],
  limits: RegexLimits,
  flags = "iu",
): Promise<RegexExecutionResult> => {
  const patternBytes = Buffer.byteLength(pattern, "utf8");
  if (patternBytes > limits.maxPatternBytes) {
    return {
      complete: false,
      matched: [],
      error: {
        code: "regex_pattern_too_large",
        message: `Regex pattern is ${patternBytes} bytes; limit is ${limits.maxPatternBytes}.`,
      },
    };
  }

  let session: BoundedRegexWorkerSession;
  try {
    session = new BoundedRegexWorkerSession(pattern, limits, flags);
  } catch (error) {
    return workerError(error);
  }
  try {
    return await session.execute(haystacks);
  } finally {
    await session.close();
  }
};
