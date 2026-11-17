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

export function setStep(items: DeclarationItem[], readingId: string, step: StepNo, on: boolean): DeclarationItem[] {
  if (on) {
    if (has(items, readingId, step) || !canState(items, readingId, step)) return items;
    return [...items, step === 1 || step === 3 ? { readingId, step, confidence: 3 } : { readingId, step }];
  }
  // Clearing a first pass clears what hangs on it.
  return items.filter((i) => !(i.readingId === readingId && (i.step === step || PREREQ[i.step] === step)));
}

export function patchItem(
  items: DeclarationItem[],
  readingId: string,
  step: StepNo,
  patch: Partial<Pick<DeclarationItem, "confidence" | "answered" | "correct">>,
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
