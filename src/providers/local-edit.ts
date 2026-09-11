export interface LocalTextEdit { oldText: string; newText: string; all?: boolean }
/** Resolve every anchor against the original, then apply disjoint ranges once. */
export function applyLocalEdits(original: string, edits: readonly LocalTextEdit[]): string {
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
  let end = 0;
  const pieces: string[] = [];
  for (const range of ranges) {
    if (range.start < end) throw new Error("local.edit original snapshot anchors overlap");
    pieces.push(original.slice(end, range.start), range.text);
    end = range.end;
  }
  pieces.push(original.slice(end));
  return pieces.join("");
}
