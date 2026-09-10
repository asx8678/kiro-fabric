import type { LocalReadManyResult, LocalReadResult, LocalReadWindow, LocalSourceWindow } from "./local-contract.js";

/** Compose bounded source windows, retaining every undelivered requested line.
 * Retrieval is evidence availability, never proof that a model inspected it. */
export function readManyWindows(
  windows: LocalReadWindow[], budget: number,
  read: (window: LocalReadWindow) => LocalReadResult,
): LocalReadManyResult {
  const files: LocalSourceWindow[] = [];
  const fits = (value: LocalReadManyResult) => JSON.stringify(value).length <= budget;
  const pending = (index: number): LocalReadManyResult => ({ files: [...files], remaining: windows.slice(index), complete: false });
  if (!fits(pending(0))) throw new Error("local.readMany metadata exceeds budget; narrow the batch");
  for (let index = 0; index < windows.length; index++) {
    const window = windows[index]!;
    const raw = read(window);
    if (window.expectedSha256 !== undefined && raw.sha256 !== window.expectedSha256) {
      throw new Error("local.readMany source changed; restart this file instead of joining different snapshots");
    }
    const lines = raw.text === "" ? [] : raw.text.split(/\r?\n/u);
    if (raw.text.endsWith("\n")) lines.pop();
    const start = window.offset ?? 1;
    const end = Math.min(raw.totalLines, start + (window.limit ?? 200) - 1);
    const page = (count: number): LocalReadManyResult => {
      const next = start + count;
      const remainder: LocalReadWindow[] = next <= end
        ? [{ path: raw.path, offset: next, limit: end - next + 1, expectedSha256: raw.sha256 }, ...windows.slice(index + 1)]
        : windows.slice(index + 1);
      const file: LocalSourceWindow = {
        path: raw.path, startLine: start, endLine: count ? next - 1 : null,
        totalLines: raw.totalLines, sha256: raw.sha256,
        source: lines.slice(0, count).map((line, i) => `${start + i}: ${line}`).join("\n"),
        truncated: count > 0 && next <= raw.totalLines,
        ...(count > 0 && next <= raw.totalLines ? { nextOffset: next } : {}),
      };
      return { files: [...files, file], remaining: remainder, complete: remainder.length === 0 };
    };
    let high = lines.length;
    let result = page(high);
    if (!fits(result)) {
      let low = 0;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (fits(page(mid))) low = mid;
        else high = mid - 1;
      }
      if (!low) {
        if (files.length) return pending(index);
        throw new Error("local.readMany single line or metadata exceeds budget; increase maxChars or narrow the batch");
      }
      result = page(low);
    }
    files.push(result.files.at(-1)!);
    // Finish this range in the next call before starting more files. remaining
    // carries the hash only for continuations, leaving new windows independent.
    if ((result.files.at(-1)!.endLine ?? start - 1) < end) return result;
    if (index === windows.length - 1) return result;
  }
  return { files, remaining: [], complete: true };
}
