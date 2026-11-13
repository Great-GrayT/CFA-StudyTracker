/**
 * Splits a whole-number total into n shares that add back up exactly, the
 * remainder on the first shares. Used wherever a count typed once is stored
 * against several outcomes.
 */
export function spread(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}
