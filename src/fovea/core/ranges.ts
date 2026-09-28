import type { NodeKind, SourceRange, SymbolRec } from "./types.js";

type Position = SourceRange["start"];
const compare = (a: Position, b: Position): number => a.line - b.line || a.column - b.column;

export const symbolRanges = <T extends SymbolRec>(symbols: readonly T[]) => {
  const groups = new Map<string, T[]>();
  for (const symbol of symbols) {
    if (!symbol.range || compare(symbol.range.start, symbol.range.end) >= 0) continue;
    for (const key of [symbol.file, `${symbol.file}\0${symbol.kind}`]) {
      const group = groups.get(key) ?? [];
      group.push(symbol);
      groups.set(key, group);
    }
  }
  const indexes = new Map<string, { items: T[]; ends: Position[]; size: number }>();
  for (const [key, items] of groups) {
    items.sort((a, b) => compare(a.range!.start, b.range!.start) || compare(b.range!.end, a.range!.end));
    let size = 1;
    while (size < items.length) size *= 2;
    const ends = Array.from({ length: size * 2 }, () => ({ line: 0, column: 0 }));
    items.forEach((item, i) => { ends[size + i] = item.range!.end; });
    for (let i = size - 1; i > 0; i--) ends[i] = compare(ends[i * 2]!, ends[i * 2 + 1]!) >= 0 ? ends[i * 2]! : ends[i * 2 + 1]!;
    indexes.set(key, { items, ends, size });
  }
  return (file: string, line: number, column = 0, kind?: NodeKind): T | undefined => {
    const index = indexes.get(kind ? `${file}\0${kind}` : file);
    if (!index) return undefined;
    const point = { line, column };
    const { items, ends, size } = index;
    let lo = 0, hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compare(items[mid]!.range!.start, point) <= 0) lo = mid + 1;
      else hi = mid;
    }
    const find = (node: number, start: number, end: number): T | undefined => {
      if (start >= lo || compare(ends[node]!, point) <= 0) return undefined;
      if (end - start === 1) return items[start];
      const mid = (start + end) >>> 1;
      return find(node * 2 + 1, mid, end) ?? find(node * 2, start, mid);
    };
    return find(1, 0, size);
  };
};
