// Per-step package order (spec "Package priority"). Slugs are the plan's own.

export type Priority = Record<string, string[]>;

export const DEFAULT_PRIORITY: Priority = {
  "1": ["mm-l2", "kaplan-l2", "cfa-les"],
  "2": ["uw-l2-2025", "kaplan-l2", "premium-l2", "cfa-les"],
  "3": ["mm-l2", "kaplan-l2", "cfa-les"],
  "4": ["premium-l2", "kaplan-l2", "uw-l2-2025", "cfa-les"],
  "5": ["premium-l2", "cfa-les", "kaplan-l2"],
};

export const PRIORITY_STEPS = [
  { step: "1", label: "Step 1, first read" },
  { step: "2", label: "Step 2, first questions" },
  { step: "3", label: "Step 3, review reading" },
  { step: "4", label: "Step 4, review questions" },
  { step: "5", label: "Step 5, mocks" },
] as const;

// Premium Pack is third-party material, never labelled as CFA Institute.
export const PACKAGE_NAMES: Record<string, string> = {
  "mm-l2": "Meldrum",
  "kaplan-l2": "Kaplan",
  "cfa-les": "CFA LES",
  "uw-l2-2025": "UWorld",
  "premium-l2": "Premium Pack",
};

export function movePackage(list: string[], index: number, by: -1 | 1): string[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** Saved priority, with any missing or empty step taken from the defaults. */
export function withDefaults(saved: Priority | null | undefined): Priority {
  const out: Priority = {};
  for (const k of Object.keys(DEFAULT_PRIORITY)) {
    const s = saved?.[k];
    out[k] = s && s.length > 0 ? [...s] : [...DEFAULT_PRIORITY[k]!];
  }
  return out;
}

export function priorityEqual(a: Priority, b: Priority): boolean {
  return Object.keys(DEFAULT_PRIORITY).every((k) => (a[k] ?? []).join() === (b[k] ?? []).join());
}

export function hoursError(raw: string): string | null {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isInteger(n) && n >= 50 && n <= 400 ? null : "Enter whole hours from 50 to 400.";
}
