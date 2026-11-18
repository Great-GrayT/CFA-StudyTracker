import type { DeclarationItem, StepNo } from "./types";

// Pure state of the starting-point form: which module steps are already done.

const PREREQ: Partial<Record<StepNo, StepNo>> = { 3: 1, 4: 2 };

const has = (items: DeclarationItem[], readingId: string, step: StepNo) =>
  items.some((i) => i.readingId === readingId && i.step === step);

/** A later step can be stated only after its first pass (3 after 1, 4 after 2). */
export function canState(items: DeclarationItem[], readingId: string, step: StepNo): boolean {
  const need = PREREQ[step];
  return need === undefined || has(items, readingId, need);
}

export function setStep(
  items: DeclarationItem[],
  readingId: string,
  step: StepNo,
  on: boolean,
  date?: string,
): DeclarationItem[] {
  if (on) {
    if (has(items, readingId, step) || !canState(items, readingId, step)) return items;
    const d = date ? { date } : {};
    return [...items, step === 1 || step === 3 ? { readingId, step, confidence: 3, ...d } : { readingId, step, ...d }];
  }
  // Clearing a first pass clears what hangs on it.
  return items.filter((i) => !(i.readingId === readingId && (i.step === step || PREREQ[i.step] === step)));
}

export function patchItem(
  items: DeclarationItem[],
  readingId: string,
  step: StepNo,
  patch: Partial<Pick<DeclarationItem, "confidence" | "answered" | "correct" | "date">>,
): DeclarationItem[] {
  return items.map((i) => (i.readingId === readingId && i.step === step ? { ...i, ...patch } : i));
}

export function itemsError(items: DeclarationItem[]): string | null {
  for (const i of items) {
    if (i.correct !== undefined && i.answered === undefined) return "Enter questions answered before correct.";
    if (i.correct !== undefined && i.answered !== undefined && i.correct > i.answered) {
      return "Correct answers cannot exceed questions answered.";
    }
  }
  return null;
}

/** Today as YYYY-MM-DD in the plan's zone (the browser's when none), so "max today" matches the server's. */
export function todayIn(timeZone?: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA").format(now);
  }
}

/** The date a new self-state starts on: the plan's first day, but never after today. */
export function defaultDeclaredDate(startDate: string | undefined, today: string): string {
  const start = startDate?.slice(0, 10);
  return start && start <= today ? start : today;
}

/** Stamps one date on every item, for the "apply to all" shortcut. */
export function applyDateToAll(items: DeclarationItem[], date: string): DeclarationItem[] {
  return items.map((i) => ({ ...i, date }));
}

/**
 * The server's date rules, checked early for a clear message: not after today,
 * and a later step not before its first pass (3 vs 1, 4 vs 2). `stored` supplies
 * the first pass when it was saved earlier.
 */
export function dateError(items: DeclarationItem[], stored: DeclarationItem[], today: string): string | null {
  const all = [...stored, ...items];
  for (const i of items) {
    if (i.date && i.date > today) return "A date cannot be after today.";
    const need = PREREQ[i.step];
    const first = need === undefined ? undefined : all.find((x) => x.readingId === i.readingId && x.step === need);
    if (i.date && first?.date && i.date < first.date) {
      return need === 1 ? "Review reading cannot be dated before the first read." : "Review questions cannot be dated before the first questions.";
    }
  }
  return null;
}
