/** Share of `of` reached by `n`, clamped to 0..1; an empty total reads as 0. */
export function fraction(n: number, of: number): number {
  return of > 0 ? Math.min(1, Math.max(0, n / of)) : 0;
}

/** Whole-percent accuracy, or null before any answer. */
export function accuracyPct(correct: number, answered: number): number | null {
  return answered > 0 ? Math.round((correct / answered) * 100) : null;
}

export function pctLabel(p: number | null): string {
  return p === null ? "none yet" : `${p}%`;
}

/** Hours with one decimal under ten, whole above: "4.5 h", "32 h". */
export function hoursLabel(seconds: number): string {
  const h = Math.max(0, seconds) / 3600;
  return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)} h`;
}

/** Name with the year appended only when the name does not already carry it. */
export function packageLabel(name: string, year: string): string {
  return year && !name.includes(year) ? `${name} ${year}` : name;
}

/** Above this many questions a chip grid is noise; the text summary stands in. */
export const MAX_CHIPS = 300;

/** Numbers 1..total split into answered and left, given the numbered set. */
export function questionChips(total: number, numbered: number[]): { n: number; answered: boolean }[] {
  const done = new Set(numbered);
  return Array.from({ length: total }, (_, i) => ({ n: i + 1, answered: done.has(i + 1) }));
}
