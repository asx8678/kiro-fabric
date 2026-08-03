export function total(cents: number[]): number {
  return cents.reduce((sum, value) => sum + value, 0);
}

export function discounted(cents: number, percent: number): number {
  return Math.round(cents * (1 - percent / 100));
}