import type { LocalReadManyResult, LocalReadResult, LocalReadWindow, LocalSourceWindow } from "./local-contract.js";

import { largestFittingInteger } from "../bounded-search.js";

export class LocalReadFailure extends Error {}

function summarizeWindows(files: LocalSourceWindow[], remaining: LocalReadWindow[]): LocalReadManyResult {
  // Summarize each snapshot once, even when its windows arrive out of order.
  // This describes suffixes only; it is not a persistent inspection ledger.
  const last = new Map<string, LocalSourceWindow>();
  for (const file of files) {
    if (file.endLine === null) continue;
    const key = `${file.path}\0${file.sha256}`;
    if ((last.get(key)?.endLine ?? 0) < file.endLine) last.set(key, file);
  }
  const unreadTails: LocalReadWindow[] = [];
  for (const file of last.values()) {
    const offset = file.endLine! + 1;
    if (offset <= file.totalLines) unreadTails.push({
      path: file.path, offset, limit: Math.min(2000, file.totalLines - offset + 1), expectedSha256: file.sha256,
    });
  }
  return { complete: remaining.length === 0, unreadTails, files, remaining };
}

/** Compose bounded source windows, retaining every undelivered requested line.
 * Retrieval is evidence availability, never proof that a model inspected it. */
export function readManyWindows(
  windows: LocalReadWindow[], budget: number,
  read: (window: LocalReadWindow) => LocalReadResult,
  partial = false,
  // Pure serialization only: budget the actual returned value, never re-read or replay.
  delivery: { serialize?: (result: LocalReadManyResult) => string; operation?: string } = {},
): LocalReadManyResult {
  const files: LocalSourceWindow[] = [];
  const failures: { index: number; path: string; code: "read" | "stale-hash"; message: string }[] = [];
  const failed: LocalReadWindow[] = [];
  const summarize = (delivered: LocalSourceWindow[], pending: LocalReadWindow[]): LocalReadManyResult => {
    const result = summarizeWindows(delivered, [...failed, ...pending]);
    return partial ? { ...result, failures: [...failures] } : result;
  };
  const fits = (value: LocalReadManyResult) => JSON.stringify(delivery.serialize ? delivery.serialize(value) : value).length <= budget;
  const operation = delivery.operation ?? "local.readMany";
  const pending = (index: number): LocalReadManyResult => summarize([...files], windows.slice(index));
  if (!fits(pending(0))) throw new Error(`${operation} metadata exceeds budget; narrow the batch`);
  for (let index = 0; index < windows.length; index++) {
    const window = windows[index]!;
    let raw: LocalReadResult;
    let stale = false;
    try {
      raw = read(window);
      stale = window.expectedSha256 !== undefined && raw.sha256 !== window.expectedSha256;
      if (stale) throw new LocalReadFailure(`${operation} source changed; restart this file instead of joining different snapshots`);
    } catch (error) {
      if (!partial || !(error instanceof LocalReadFailure)) throw error;
      failures.push({ index, path: window.path, code: stale ? "stale-hash" : "read", message: error.message.slice(0, 200) });
      failed.push(window);
      if (!fits(pending(index + 1))) throw new Error(`${operation} failure metadata exceeds budget; narrow the batch`);
      continue;
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
      return summarize([...files, file], remainder);
    };
    const high = lines.length;
    let result = page(high);
    if (!fits(result)) {
      const low = largestFittingInteger(0, high, count => fits(page(count)));
      if (!low) {
        if (files.length) return pending(index);
        throw new Error(`${operation} single line or metadata exceeds budget; increase maxChars or narrow the batch`);
      }
      result = page(low);
    }
    files.push(result.files.at(-1)!);
    // Finish this range in the next call before starting more files. remaining
    // carries the hash only for continuations, leaving new windows independent.
    if ((result.files.at(-1)!.endLine ?? start - 1) < end) return result;
    if (index === windows.length - 1) return result;
  }
  return summarize(files, []);
}
