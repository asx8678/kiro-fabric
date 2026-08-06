/**
 * Deterministic, LLM-free context compression (pi-vcc style): when an
 * assembled AI-call context exceeds the character budget, shrink it by
 * extraction and formatting instead of failing the call. Every step is a
 * pure function of the input — same context, same compressed output.
 */

const LONG_LINE = 240;
/** Lines longer than this absolute ceiling are left intact for the final head+tail truncation. */
const LINE_KEEP_FRACTION = 8;

const isCommentLine = (line: string): boolean => /^\s*(\/\/|\/\*|\*\/|\*|#|<!--)/.test(line);

/** Preserve head and tail with an explicit omission marker; output <= maxChars. */
export function middleTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars < 32) return text.slice(0, Math.max(0, maxChars - 1)) + "…";
  const marker = `\n… [${text.length - maxChars} chars omitted] …\n`;
  const budget = Math.max(1, maxChars - marker.length);
  const head = Math.ceil(budget / 2);
  const tail = Math.floor(budget / 2);
  return `${text.slice(0, head)}${marker}${text.slice(text.length - tail)}`;
}

/**
 * Compress a context string to at most maxChars, in deterministic stages:
 * normalize newlines, truncate over-long (e.g. minified) lines, collapse
 * blank runs and consecutive duplicate lines, drop comment-only lines, then
 * middle-truncate with an omission marker as the guaranteed final bound.
 */
export function compressContextText(text: string, maxChars: number): string {
  if (maxChars < 1) return "";
  if (text.length <= maxChars) return text;

  const normalized = text.replace(/\r\n?/g, "\n");
  // Over-long line truncation exists to shave minified/noise lines in
  // line-oriented text (code, logs). It must be budget-relative: a fixed cap
  // would guillotine a single-line JSON payload (e.g. compactJson output) to a
  // stub. Lines longer than the whole budget are left intact so the final
  // middle truncation preserves both their head and their tail instead.
  const longLineCap = Math.max(LONG_LINE, Math.floor(maxChars / LINE_KEEP_FRACTION));
  const lines = normalized
    .split("\n")
    .map((line) =>
      line.length > longLineCap && line.length <= maxChars
        ? `${line.slice(0, longLineCap - 1)}…`
        : line,
    );

  const deduped: string[] = [];
  for (const line of lines) {
    const previous = deduped[deduped.length - 1];
    if (
      line === previous ||
      (line.trim() === "" && previous !== undefined && previous.trim() === "")
    )
      continue;
    deduped.push(line);
  }

  let result = deduped.join("\n");
  if (result.length <= maxChars) return result;

  let droppedComments = 0;
  const kept = deduped.filter((line) => {
    if (isCommentLine(line)) {
      droppedComments++;
      return false;
    }
    return true;
  });
  if (droppedComments > 0) kept.push(`… [${droppedComments} comment lines dropped]`);
  result = kept.join("\n");
  if (result.length <= maxChars) return result;

  return middleTruncate(result, maxChars);
}
