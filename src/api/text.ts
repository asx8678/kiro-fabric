import { createReadStream } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { FabricError } from "../errors.js";
import type { GrepMatch } from "../../types/fabric-lite.js";

export function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const marker = "\n[truncated]";
  // When the budget is smaller than the marker itself, return a plain crop
  // instead of emitting a marker longer than the requested maximum.
  if (max < marker.length) return { text: text.slice(0, Math.max(0, max)), truncated: true };
  // Truncate at the nearest line boundary to avoid breaking code structure.
  const effective = max - marker.length;
  const sliced = text.slice(0, Math.max(0, effective));
  const lastNewline = sliced.lastIndexOf("\n");
  // Cut at the nearest line boundary so truncation never breaks a statement.
  // Fall back to a mid-line crop only when there is no usable newline (i.e. the
  // whole slice is one unbroken line); lastIndexOf returns the latest newline,
  // so this keeps the maximum complete content.
  const boundary = lastNewline > 0 ? lastNewline : effective;
  return { text: sliced.slice(0, boundary) + marker, truncated: true };
}

export function textContent(buffer: Buffer, label: string): string {
  if (buffer.includes(0)) {
    throw new FabricError("POLICY_DENIED", `Binary file denied: ${label}`);
  }
  return buffer.toString("utf8");
}

export async function scanGrepFile(
  filePath: string,
  relativePath: string,
  regex: RegExp,
  contextLines: number,
  matches: GrepMatch[],
  maxMatches: number,
): Promise<boolean> {
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let lineNumber = 1;
  let sawLine = false;
  // Bound a single minified/huge line so it cannot accumulate unbounded memory.
  const MAX_LINE_CHARS = 1_000_000;
  const previous: string[] = [];
  const waiting: Array<{ match: GrepMatch; remaining: number }> = [];
  let foundMatches = 0;
  let limitHit = false;
  const consume = (line: string): void => {
    if (line.includes("\0"))
      throw new FabricError("POLICY_DENIED", `Binary file denied: ${relativePath}`);
    for (let index = waiting.length - 1; index >= 0; index--) {
      const item = waiting[index]!;
      item.match.after.push(line);
      item.remaining--;
      if (item.remaining === 0) {
        waiting.splice(index, 1);
        matches.push(item.match);
      }
    }
    if (regex.test(line)) {
      foundMatches++;
      if (foundMatches > maxMatches) {
        limitHit = true;
      } else {
        const match: GrepMatch = {
          path: relativePath,
          line: lineNumber,
          text: line,
          before: previous.slice(-contextLines),
          after: [],
        };
        if (contextLines === 0) matches.push(match);
        else waiting.push({ match, remaining: contextLines });
      }
    }
    if (contextLines > 0) previous.push(line);
    if (previous.length > contextLines) previous.shift();
    lineNumber++;
    sawLine = true;
  };
  try {
    for await (const chunk of stream) {
      const text = decoder.write(chunk as Buffer);
      if (text.includes("\0"))
        throw new FabricError("POLICY_DENIED", `Binary file denied: ${relativePath}`);
      pending += text;
      if (pending.length > MAX_LINE_CHARS)
        throw new FabricError(
          "BUDGET_EXCEEDED",
          `Grep line exceeds ${MAX_LINE_CHARS} chars: ${relativePath}`,
        );
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        consume(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        // Once the match cap is hit and no context lines are pending, stop
        // streaming the rest of the file.
        if (limitHit && waiting.length === 0) {
          stream.destroy();
          return limitHit;
        }
      }
    }
    pending += decoder.end();
    // Consume a trailing line only when real content remains or the file had
    // no newline at all; a file ending in "\n" must not synthesize an empty line.
    if (pending.length > 0 || !sawLine) consume(pending);
    for (const item of waiting) matches.push(item.match);
  } finally {
    stream.destroy();
  }
  return limitHit;
}
