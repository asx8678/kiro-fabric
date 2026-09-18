import type { ResolvedFabricAction } from "../protocol.js";

type Match = { action: ResolvedFabricAction; score: number };
const compare = (left: Match, right: Match): number => right.score - left.score ||
  (left.action.ref < right.action.ref ? -1 : left.action.ref > right.action.ref ? 1 : 0);

/** Refs are unique in the discovery indexes. Keep the worst retained match at
 * the root, using the same score/ref total order as the full search. Limited
 * searches retain O(k) matches and sort only that final selection. */
export function rankedActions(matches: Iterable<Match>, limit: number | undefined): ResolvedFabricAction[] {
  if (limit === undefined) return [...matches].sort(compare).map(match => match.action);
  // Preserve search(NaN)'s empty slice without bypassing discovery admission.
  if (!(limit > 0)) return [];
  const heap: Match[] = [];
  for (const match of matches) {
    if (heap.length < limit) {
      let index = heap.length;
      heap.push(match);
      while (index > 0) {
        const parent = (index - 1) >>> 1;
        if (compare(heap[parent]!, match) >= 0) break;
        heap[index] = heap[parent]!; index = parent;
      }
      heap[index] = match;
    } else if (compare(match, heap[0]!) < 0) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && compare(heap[child + 1]!, heap[child]!) > 0) child++;
        if (compare(match, heap[child]!) >= 0) break;
        heap[index] = heap[child]!; index = child;
      }
      heap[index] = match;
    }
  }
  return heap.sort(compare).map(match => match.action);
}
