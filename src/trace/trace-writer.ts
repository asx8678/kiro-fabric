import fs from "node:fs";
import path from "node:path";

export interface TraceWriterOptions {
  /** Absolute path for the JSONL trace file. Created private (0600); the
   * parent directory is created with 0700 and must stay under the Fabric data root. */
  file: string;
  /** Ring capacity in lines; oldest lines drop with a counter when full. */
  maxBufferLines?: number;
  /** Ring capacity in bytes; oldest lines drop with a counter when full. */
  maxBufferBytes?: number;
  /** Auto-flush interval. The timer is unref'd so it never holds the process. */
  flushIntervalMs?: number;
  /** Hard file cap; the writer emits a truncation marker and disables itself. */
  maxFileBytes?: number;
  /** Per-line cap; longer lines are truncated. */
  maxLineBytes?: number;
}

export interface TraceWriter {
  readonly file: string;
  readonly dropped: number;
  readonly disabled: boolean;
  write(line: string): void;
  flush(): void;
  close(): void;
}

const DEFAULT_MAX_BUFFER_LINES = 4_096;
const DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const DEFAULT_FLUSH_INTERVAL_MS = 250;
const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_LINE_BYTES = 8 * 1024;
/** Smallest cap that can still hold one well-formed JSON object without a newline. */
const MIN_MAX_LINE_BYTES = 2;

const boundedOption = (name: string, value: number | undefined, fallback: number, minimum: number): number => {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`trace writer ${name} must be an integer of at least ${minimum}`);
  }
  return value;
};

class LineRing {
  readonly #slots: (string | undefined)[];
  #start = 0;
  #size = 0;
  #bytes = 0;
  constructor(
    readonly capacity: number,
    readonly maxBytes: number,
  ) {
    this.#slots = new Array<string | undefined>(capacity);
  }
  /** Returns how many lines were discarded: evicted oldest lines plus, when the
   * line cannot fit the byte budget at all, the rejected line itself. */
  push(line: string): number {
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > this.maxBytes) return 1;
    let dropped = 0;
    while (this.#size > 0 && (this.#size >= this.capacity || this.#bytes + lineBytes > this.maxBytes)) {
      const index = this.#start;
      this.#bytes -= Buffer.byteLength(this.#slots[index]!, "utf8");
      this.#slots[index] = undefined;
      this.#start = (this.#start + 1) % this.capacity;
      this.#size -= 1;
      dropped += 1;
    }
    this.#slots[(this.#start + this.#size) % this.capacity] = line;
    this.#size += 1;
    this.#bytes += lineBytes;
    return dropped;
  }
  drain(): string[] {
    const out: string[] = [];
    for (let index = 0; index < this.#size; index += 1) {
      out.push(this.#slots[(this.#start + index) % this.capacity]!);
    }
    this.#slots.fill(undefined);
    this.#start = 0;
    this.#size = 0;
    this.#bytes = 0;
    return out;
  }
  get size(): number {
    return this.#size;
  }
}

class BufferedTraceWriter implements TraceWriter {
  readonly file: string;
  readonly #fd: number;
  readonly #ring: LineRing;
  readonly #maxFileBytes: number;
  readonly #maxLineBytes: number;
  readonly #timer: NodeJS.Timeout;
  readonly #onExit = (): void => {
    this.#flushSync(true);
  };
  #writtenBytes = 0;
  #dropped = 0;
  #disabled = false;
  #closed = false;

  constructor(options: TraceWriterOptions) {
    if (!path.isAbsolute(options.file)) throw new Error("trace file must be an absolute path");
    // Validate every bound before touching the filesystem so a rejected writer
    // cannot leave an empty trace file or an orphaned parent directory behind.
    const maxBufferLines = boundedOption("maxBufferLines", options.maxBufferLines, DEFAULT_MAX_BUFFER_LINES, 1);
    const maxBufferBytes = boundedOption("maxBufferBytes", options.maxBufferBytes, DEFAULT_MAX_BUFFER_BYTES, 1);
    const maxFileBytes = boundedOption("maxFileBytes", options.maxFileBytes, DEFAULT_MAX_FILE_BYTES, 1);
    const maxLineBytes = boundedOption("maxLineBytes", options.maxLineBytes, DEFAULT_MAX_LINE_BYTES, MIN_MAX_LINE_BYTES);
    const flushIntervalMs = boundedOption("flushIntervalMs", options.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS, 1);
    this.file = options.file;
    fs.mkdirSync(path.dirname(options.file), { recursive: true, mode: 0o700 });
    this.#fd = fs.openSync(options.file, "wx", 0o600);
    this.#ring = new LineRing(maxBufferLines, maxBufferBytes);
    this.#maxFileBytes = maxFileBytes;
    this.#maxLineBytes = maxLineBytes;
    this.#timer = setInterval(() => {
      this.#flushSync(true);
    }, flushIntervalMs);
    this.#timer.unref();
    process.once("exit", this.#onExit);
  }

  get dropped(): number {
    return this.#dropped;
  }
  get disabled(): boolean {
    return this.#disabled;
  }

  write(line: string): void {
    if (this.#disabled || this.#closed) return;
    const raw = `${line}\n`;
    // Slicing a serialized line at a byte offset can split a UTF-8 sequence and
    // always truncates JSON mid-token. Replace an over-cap line with the
    // largest well-formed marker that fits, so every written line stays valid
    // JSONL and the byte bound holds.
    const bounded = Buffer.byteLength(raw, "utf8") <= this.#maxLineBytes ? raw : this.#truncatedLine(raw);
    this.#dropped += this.#ring.push(bounded);
  }

  #truncatedLine(raw: string): string {
    const bytes = Buffer.byteLength(raw, "utf8");
    const candidates = [
      JSON.stringify({ v: 1, ev: "line.truncated", bytes }),
      '{"line.truncated":true}',
      '{"t":1}',
      "{}",
    ];
    for (const candidate of candidates) {
      if (Buffer.byteLength(`${candidate}\n`, "utf8") <= this.#maxLineBytes) return `${candidate}\n`;
      if (Buffer.byteLength(candidate, "utf8") <= this.#maxLineBytes) return candidate;
    }
    return "{}";
  }

  #flushSync(fsync: boolean): void {
    if (this.#closed || this.#ring.size === 0) return;
    const chunk = this.#ring.drain().join("");
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    try {
      if (this.#writtenBytes + chunkBytes > this.#maxFileBytes) {
        const marker = JSON.stringify({ v: 1, cat: "teardown", ev: "trace.truncated", data: { maxFileBytes: this.#maxFileBytes } });
        const room = this.#maxFileBytes - this.#writtenBytes;
        if (room > Buffer.byteLength(marker, "utf8") + 1) fs.writeSync(this.#fd, `${marker}\n`);
        this.#disabled = true;
        return;
      }
      fs.writeSync(this.#fd, chunk);
      this.#writtenBytes += chunkBytes;
      if (fsync) fs.fsyncSync(this.#fd);
    } catch {
      // Tracing must never take down Fabric. Disable on any I/O failure.
      this.#disabled = true;
    }
  }

  flush(): void {
    this.#flushSync(true);
  }

  close(): void {
    if (this.#closed) return;
    this.#flushSync(true);
    this.#closed = true;
    clearInterval(this.#timer);
    process.removeListener("exit", this.#onExit);
    try {
      fs.closeSync(this.#fd);
    } catch {
      // Already closed or unwritable; nothing further tracing can do.
    }
  }
}

export const createTraceWriter = (options: TraceWriterOptions): TraceWriter => new BufferedTraceWriter(options);
