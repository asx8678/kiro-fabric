import fs from "node:fs";
import path from "node:path";
import { validateTraceDirectory } from "./trace-directory.js";

export interface TraceWriterOptions {
  /** Absolute path for the JSONL trace file. Created private (0600); the
   * parent directory is created with 0700 and must stay under the Fabric data root. */
  file: string;
  dataRoot?: string;
  /** Ring capacity in lines (1..1_048_576); oldest lines drop with a counter when full. */
  maxBufferLines?: number;
  /** Ring capacity in bytes (1..268_435_456); oldest lines drop with a counter when full. */
  maxBufferBytes?: number;
  /** Auto-flush interval in ms (1..60_000). The timer is unref'd so it never holds the process. */
  flushIntervalMs?: number;
  /** Hard file cap in bytes (1..1_073_741_824); the writer emits a truncation marker and disables itself. */
  maxFileBytes?: number;
  /** Per-line cap in bytes (2..1_048_576); longer lines are truncated. */
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
/** Practical maxima. Every bound above is caller-supplied, so each is capped
 * to keep worst-case ring allocation and file growth finite; the defaults sit
 * comfortably inside them. Values outside the range are rejected before the
 * writer touches the filesystem. */
const MAX_BUFFER_LINES = 1_048_576;
const MAX_BUFFER_BYTES = 256 * 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_FLUSH_INTERVAL_MS = 60_000;
/** Smallest accepted cap. Caps below 3 cannot hold even `{}` plus its newline,
 * so oversized lines are dropped and counted instead of being written without a
 * terminator (which would merge two markers into one malformed JSONL record). */
const MIN_MAX_LINE_BYTES = 2;

const boundedOption = (name: string, value: number | undefined, fallback: number, minimum: number, maximum: number): number => {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`trace writer ${name} must be an integer between ${minimum} and ${maximum}`);
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
  readonly #truncationMarker: Buffer;
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
    const maxBufferLines = boundedOption("maxBufferLines", options.maxBufferLines, DEFAULT_MAX_BUFFER_LINES, 1, MAX_BUFFER_LINES);
    const maxBufferBytes = boundedOption("maxBufferBytes", options.maxBufferBytes, DEFAULT_MAX_BUFFER_BYTES, 1, MAX_BUFFER_BYTES);
    const maxFileBytes = boundedOption("maxFileBytes", options.maxFileBytes, DEFAULT_MAX_FILE_BYTES, 1, MAX_FILE_BYTES);
    const truncationMarker = Buffer.from(`${JSON.stringify({ v: 1, cat: "teardown", ev: "trace.truncated", data: { maxFileBytes } })}\n`, "utf8");
    if (maxFileBytes < truncationMarker.length) throw new Error(`trace writer maxFileBytes must be at least ${truncationMarker.length} to hold the truncation marker`);
    const maxLineBytes = boundedOption("maxLineBytes", options.maxLineBytes, DEFAULT_MAX_LINE_BYTES, MIN_MAX_LINE_BYTES, MAX_LINE_BYTES);
    const flushIntervalMs = boundedOption("flushIntervalMs", options.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS, 1, MAX_FLUSH_INTERVAL_MS);
    this.file = path.resolve(options.file);
    // Build the ring before touching the filesystem. A capacity past the
    // engine's array bounds throws RangeError, and opening first would leak the
    // descriptor and leave an empty trace file behind on that rejection.
    const ring = new LineRing(maxBufferLines, maxBufferBytes);
    this.#maxFileBytes = maxFileBytes;
    this.#maxLineBytes = maxLineBytes;
    this.#truncationMarker = truncationMarker;
    validateTraceDirectory(path.dirname(this.file), options.dataRoot, true);
    const descriptor = fs.openSync(this.file, "wx", 0o600);
    try {
      this.#fd = descriptor;
      this.#ring = ring;
      this.#timer = setInterval(() => {
        this.#flushSync(true);
      }, flushIntervalMs);
      this.#timer.unref();
      process.once("exit", this.#onExit);
    } catch (error) {
      // The exclusive create means this file is ours, so releasing both the
      // descriptor and the partial artifact cannot touch foreign data.
      try { fs.closeSync(descriptor); } catch { /* descriptor already released */ }
      try { fs.rmSync(this.file, { force: true }); } catch { /* best effort */ }
      throw error;
    }
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
    // Every written byte run must be a complete line. When the cap cannot hold
    // even `{}\n`, drop the line and count it rather than emitting an
    // unterminated marker that would merge with the next one.
    if (bounded === null) {
      this.#dropped += 1;
      return;
    }
    this.#dropped += this.#ring.push(bounded);
  }

  /** Largest well-formed replacement that fits the per-line cap, newline
   * included; null when no candidate fits at all. */
  #truncatedLine(raw: string): string | null {
    const bytes = Buffer.byteLength(raw, "utf8");
    // Canonical shape matches the tracer event schema (`data` payload) and the
    // sibling `trace.truncated` marker. Shorter well-formed objects keep the
    // byte bound when the cap cannot hold the canonical marker.
    const candidates = [
      JSON.stringify({ v: 1, ev: "line.truncated", data: { bytes } }),
      '{"line.truncated":true}',
      '{"t":1}',
      "{}",
    ];
    for (const candidate of candidates) {
      const line = `${candidate}\n`;
      if (Buffer.byteLength(line, "utf8") <= this.#maxLineBytes) return line;
    }
    return null;
  }

  #writeBuffer(buffer: Buffer): void {
    let offset = 0;
    while (offset < buffer.length) {
      const written = fs.writeSync(this.#fd, buffer, offset, buffer.length - offset);
      if (!Number.isSafeInteger(written) || written <= 0 || written > buffer.length - offset) throw new Error("trace write made no valid progress");
      offset += written;
      this.#writtenBytes += written;
    }
  }

  #flushSync(fsync: boolean): void {
    if (this.#closed || this.#ring.size === 0) return;
    const lines = this.#ring.drain();
    const chunk = Buffer.from(lines.join(""), "utf8");
    try {
      if (this.#writtenBytes + chunk.length + this.#truncationMarker.length > this.#maxFileBytes) {
        const room = this.#maxFileBytes - this.#writtenBytes;
        this.#dropped += lines.length;
        this.#disabled = true;
        if (room >= this.#truncationMarker.length) this.#writeBuffer(this.#truncationMarker);
      } else this.#writeBuffer(chunk);
      if (fsync) fs.fsyncSync(this.#fd);
    } catch {
      // Tracing must never take down Fabric. Disable on any I/O failure.
      if (!this.#disabled) this.#dropped += lines.length;
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
