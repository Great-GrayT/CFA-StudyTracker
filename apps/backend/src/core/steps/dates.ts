// ISO YYYY-MM-DD strings, UTC day arithmetic only (no timezone drift).
const DAY = 86_400_000;
const cache = new Map<string, number>();

export function dayNum(d: string): number {
  let n = cache.get(d);
  if (n === undefined) { n = Math.round(Date.parse(`${d}T00:00:00Z`) / DAY); cache.set(d, n); }
  return n;
}
export function addDays(d: string, n: number): string {
  return new Date((dayNum(d) + n) * DAY).toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string): number {
  return dayNum(b) - dayNum(a);
}
// 0 = Monday .. 6 = Sunday.
export function weekday(d: string): number {
  return (((dayNum(d) + 3) % 7) + 7) % 7;
}
export function weekStart(d: string): string {
  return addDays(d, -weekday(d));
}
