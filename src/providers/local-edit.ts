import { LOCAL_MAX_FILE_BYTES } from "./local-path.js";

export interface LocalTextEdit { oldText: string; newText: string; all?: boolean }
/** One resolved anchor/replacement in before/after UTF-16 coordinates. */
export interface LocalEditRegion { beforeStart: number; beforeEnd: number; afterStart: number; afterEnd: number }
/** Resolve every anchor against the original, then apply disjoint ranges once.
 * Retain each occurrence's coordinates for an exact multi-hunk approval. */
export function applyLocalEditsWithRegions(original: string, edits: readonly LocalTextEdit[]): { text: string; regions: LocalEditRegion[] } {
  if (Buffer.byteLength(original) > LOCAL_MAX_FILE_BYTES) throw new Error("local file exceeds 2MiB byte limit");
  const ranges: { start: number; end: number; text: string }[] = [];
  const occupied = new Uint8Array(original.length);
  let minimumReplacementBytes = 0;
  for (const edit of edits) {
    if (!edit.oldText) throw new Error("local.edit anchor must be nonempty");
    const first = original.indexOf(edit.oldText);
    if (first < 0) throw new Error("local.edit exact anchor was not found");
    if (!edit.all && original.indexOf(edit.oldText, first + 1) >= 0) throw new Error("local.edit anchor is not unique; use all=true for all nonoverlapping occurrences");
    const minimumBytes = Math.max(0, Buffer.byteLength(edit.newText) - 4);
    for (let start = first; start >= 0; start = edit.all ? original.indexOf(edit.oldText, start + edit.oldText.length) : -1) {
      const end = start + edit.oldText.length;
      if (occupied.subarray(start, end).some(Boolean)) throw new Error("local.edit original snapshot anchors overlap");
      if (ranges.length >= 10000) throw new Error("local.edit occurrence work limit; narrow the edit");
      minimumReplacementBytes += minimumBytes;
      if (minimumReplacementBytes > LOCAL_MAX_FILE_BYTES) throw new Error("local proposed content must be valid UTF-8 text <=2MiB without NUL");
      occupied.fill(1, start, end);
      ranges.push({ start, end, text: edit.newText });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  let end = 0, written = 0;
  const pieces: string[] = [];
  let bytes = 0, lastCode = 0;
  const append = (text: string): void => {
    if (!text.length) return;
    const firstCode = text.charCodeAt(0);
    bytes += Buffer.byteLength(text) - (lastCode >= 0xd800 && lastCode <= 0xdbff && firstCode >= 0xdc00 && firstCode <= 0xdfff ? 2 : 0);
    lastCode = text.charCodeAt(text.length - 1);
    if (bytes - (lastCode >= 0xd800 && lastCode <= 0xdbff ? 2 : 0) > LOCAL_MAX_FILE_BYTES) throw new Error("local proposed content must be valid UTF-8 text <=2MiB without NUL");
    pieces.push(text);
  };
  const regions: LocalEditRegion[] = [];
  for (const range of ranges) {
    if (range.start < end) throw new Error("local.edit original snapshot anchors overlap");
    const unchanged = original.slice(end, range.start);
    append(unchanged);
    append(range.text);
    written += unchanged.length;
    const afterStart = written;
    written += range.text.length;
    regions.push({ beforeStart: range.start, beforeEnd: range.end, afterStart, afterEnd: written });
    end = range.end;
  }
  append(original.slice(end));
  if (bytes > LOCAL_MAX_FILE_BYTES) throw new Error("local proposed content must be valid UTF-8 text <=2MiB without NUL");
  return { text: pieces.join(""), regions };
}
