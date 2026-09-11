/** Immutable UTF-16 line ends, including LF. One index per captured source,
 * not a full split/allocation for every requested window. CRLF/BOM stay intact. */
export class LocalLineIndex {
  readonly #ends: Uint32Array;
  constructor(readonly text: string) {
    let count = 0;
    for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) count++;
    if (text.length && !text.endsWith("\n")) count++;
    this.#ends = new Uint32Array(count);
    let index = 0;
    for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) this.#ends[index++] = at + 1;
    if (index < count) this.#ends[index] = text.length;
  }
  get totalLines(): number { return this.#ends.length; }
  slice(start: number, end: number): string {
    if (end <= start) return "";
    return this.text.slice(start ? this.#ends[start - 1]! : 0, this.#ends[end - 1]!);
  }
}
