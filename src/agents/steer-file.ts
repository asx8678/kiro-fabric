import fs from "node:fs";

/** Maximum encoded JSONL command accepted by every agent steering worker. */
export const MAX_AGENT_STEER_LINE_BYTES = 64 * 1024;
export const MAX_STEER_COMMANDS_PER_POLL = 256;
export const STEER_READ_CHUNK_BYTES = 256 * 1024;

export interface SteerReadState {
  offset: number;
  remainder: Buffer;
  skippingOversizedLine: boolean;
}

export const createSteerReadState = (): SteerReadState => ({
  offset: 0,
  remainder: Buffer.alloc(0),
  skippingOversizedLine: false,
});

/**
 * Read complete JSONL steer lines without dropping already-buffered commands
 * when the per-poll budget is hit. Oversized lines are skipped; the file
 * offset only advances when remainder has no pending newline.
 */
export const readSteerLines = (filePath: string, state: SteerReadState): string[] => {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, "r");
  } catch {
    return [];
  }
  try {
    const size = fs.fstatSync(descriptor).size;
    if (size < state.offset) {
      state.offset = 0;
      state.remainder = Buffer.alloc(0);
      state.skippingOversizedLine = false;
    }

    let combined = state.remainder;
    state.remainder = Buffer.alloc(0);
    const hasCompletePendingLine = combined.indexOf(0x0a) >= 0;
    if (!hasCompletePendingLine && size > state.offset) {
      const length = Math.min(size - state.offset, STEER_READ_CHUNK_BYTES);
      const buffer = Buffer.allocUnsafe(length);
      const bytesRead = fs.readSync(descriptor, buffer, 0, length, state.offset);
      state.offset += bytesRead;
      combined = Buffer.concat([combined, buffer.subarray(0, bytesRead)]);
    }

    if (state.skippingOversizedLine) {
      const skippedLineEnd = combined.indexOf(0x0a);
      if (skippedLineEnd < 0) return [];
      combined = combined.subarray(skippedLineEnd + 1);
      state.skippingOversizedLine = false;
    }

    const lines: string[] = [];
    let cursor = 0;
    while (lines.length < MAX_STEER_COMMANDS_PER_POLL) {
      const newline = combined.indexOf(0x0a, cursor);
      if (newline < 0) break;
      const raw = combined.subarray(cursor, newline);
      cursor = newline + 1;
      if (raw.length > MAX_AGENT_STEER_LINE_BYTES) continue;
      const line = raw.toString("utf8").trim();
      if (line) lines.push(line);
    }

    const pending = combined.subarray(cursor);
    if (lines.length >= MAX_STEER_COMMANDS_PER_POLL) {
      state.remainder = Buffer.from(pending);
    } else if (pending.length > MAX_AGENT_STEER_LINE_BYTES) {
      state.skippingOversizedLine = true;
    } else {
      state.remainder = Buffer.from(pending);
    }
    return lines;
  } finally {
    fs.closeSync(descriptor);
  }
};
