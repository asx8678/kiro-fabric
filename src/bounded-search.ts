/** Search integers in (lower, upper] with a monotone true-then-false predicate.
 * Returns lower when none fit; lower itself is not tested. Callers own bounds,
 * EOF shortcuts, Unicode adjustment and final progress/envelope validation. */
export function largestFittingInteger(lower: number, upper: number, fits: (value: number) => boolean): number {
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (fits(middle)) lower = middle;
    else upper = middle - 1;
  }
  return lower;
}
