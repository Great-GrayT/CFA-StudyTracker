// Pure half of the Plan calendar: grid, heat and missed-day rules.

type Day = { date: string; plannedMin: number; doneMin: number };

export const monthOf = (iso: string) => iso.slice(0, 7);

export function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** ISO dates of the month in Monday-first weeks; null pads the first and last week. */
export function monthCells(ym: string): (string | null)[] {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d++) cells.push(`${ym}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** 0 for a free day, then three shades by share of the busiest day. */
export function heatLevel(plannedMin: number, maxMin: number): 0 | 1 | 2 | 3 {
  if (plannedMin <= 0 || maxMin <= 0) return 0;
  const r = plannedMin / maxMin;
  return r <= 1 / 3 ? 1 : r <= 2 / 3 ? 2 : 3;
}

/** Past, planned, and not fully done. Today is still open, so never missed. */
export function isMissed(day: Day, today: string): boolean {
  return day.date < today && day.plannedMin > 0 && day.doneMin < day.plannedMin;
}

export function monthPlannedMin(days: Day[], ym: string): number {
  return days.filter((d) => monthOf(d.date) === ym).reduce((s, d) => s + d.plannedMin, 0);
}
