export interface LocalTextEdit { oldText: string; newText: string; all?: boolean }
/** One resolved anchor/replacement in before/after UTF-16 coordinates. */
export interface LocalEditRegion { beforeStart: number; beforeEnd: number; afterStart: number; afterEnd: number }
/** Resolve every anchor against the original, then apply disjoint ranges once.
 * Retain each occurrence's coordinates for an exact multi-hunk approval. */
export function applyLocalEditsWithRegions(original: string, edits: readonly LocalTextEdit[]): { text: string; regions: LocalEditRegion[] } {
  const ranges: { start: number; end: number; text: string }[] = [];
  for (const edit of edits) {
    if (!edit.oldText) throw new Error("local.edit anchor must be nonempty");
    const first = original.indexOf(edit.oldText);
    if (first < 0) throw new Error("local.edit exact anchor was not found");
    if (!edit.all && original.indexOf(edit.oldText, first + 1) >= 0) throw new Error("local.edit anchor is not unique; use all=true for all nonoverlapping occurrences");
    for (let start = first; start >= 0; start = edit.all ? original.indexOf(edit.oldText, start + edit.oldText.length) : -1) {
      ranges.push({ start, end: start + edit.oldText.length, text: edit.newText });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  let end = 0, written = 0;
  const pieces: string[] = [];
  const regions: LocalEditRegion[] = [];
  for (const range of ranges) {
    if (range.start < end) throw new Error("local.edit original snapshot anchors overlap");
    const unchanged = original.slice(end, range.start);
    pieces.push(unchanged, range.text);
    written += unchanged.length;
    const afterStart = written;
    written += range.text.length;
    regions.push({ beforeStart: range.start, beforeEnd: range.end, afterStart, afterEnd: written });
    end = range.end;
  }
  pieces.push(original.slice(end));
  return { text: pieces.join(""), regions };
}
