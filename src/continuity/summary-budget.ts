/** A rendered line measured once, both as UTF-8 text and inside a JSON string. */
export interface SummaryLine { text: string; bytes: number; jsonBytes: number }
export const summaryLine = (text: string): SummaryLine => ({
  text, bytes: Buffer.byteLength(text), jsonBytes: Buffer.byteLength(JSON.stringify(text)) - 2,
});

/** Incremental accounting for lines.join("\n"). Only the small metadata envelope
 * is serialized during selection; the complete summary is built once at the end.
 * Extra lines support changing coverage/omission footers without mutating totals. */
export class SummaryBudget {
  #bytes = 0;
  #jsonBytes = 0;
  #lines = 0;
  add(line: SummaryLine): void { this.#bytes += line.bytes; this.#jsonBytes += line.jsonBytes; this.#lines++; }
  remove(line: SummaryLine): void { this.#bytes -= line.bytes; this.#jsonBytes -= line.jsonBytes; this.#lines--; }
  fits(envelope: { summary: string }, maxSummaryBytes: number, maxResultBytes: number, extra: readonly SummaryLine[] = []): boolean {
    const separators = Math.max(0, this.#lines + extra.length - 1);
    let bytes = this.#bytes + separators, jsonBytes = this.#jsonBytes + separators * 2;
    for (const line of extra) { bytes += line.bytes; jsonBytes += line.jsonBytes; }
    return bytes <= maxSummaryBytes && jsonBytes + Buffer.byteLength(JSON.stringify({ ...envelope, summary: "" })) <= maxResultBytes;
  }
}
