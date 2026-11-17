// Pure message ladder: how many coach messages today and when. No DB, no clock.
import type { AnchorSlot, DaySlot } from "./slots";

export type CoachStage = "steps-1-2" | "steps-3-4" | "mock-window";

type Schedule = Record<AnchorSlot, { hour: number; minute: number }>;

const MAX_PER_DAY = 12;
const MAX_EXTRAS = 9;
const MIN_GAP = 45;
const PASSED_SHARE = 0.9;
const MOCK_WINDOW_DAYS = 30;

/**
 * The earliest step that fewer than 90% of modules have passed. Steps 1-2 and
 * 3-4 share a message count but not a tone, so only the pair is returned.
 */
export function coachStage(
  moduleSteps: Array<{ s1: boolean; s2: boolean; s3: boolean; s4: boolean }>,
  daysToExam: number,
): CoachStage {
  if (daysToExam <= MOCK_WINDOW_DAYS) return "mock-window";
  if (moduleSteps.length === 0) return "steps-1-2";
  const keys = ["s1", "s2", "s3", "s4"] as const;
  for (let i = 0; i < keys.length; i++) {
    const passed = moduleSteps.filter((m) => m[keys[i]!]).length;
    if (passed / moduleSteps.length < PASSED_SHARE) return i < 2 ? "steps-1-2" : "steps-3-4";
  }
  return "steps-3-4";
}

export function messagesFor(i: {
  stage: CoachStage;
  daysBehind: number;
  belowPass: boolean;
  restDay: boolean;
  pastExam: boolean;
}): number {
  if (i.pastExam) return 0;
  // A rest day cannot carry extra pressure, so the anchors behave as today.
  if (i.restDay) return 3;
  if (i.belowPass) return MAX_PER_DAY;
  const floor = i.stage === "mock-window" ? 4 : 3;
  return Math.min(MAX_PER_DAY, Math.max(floor, 3 + Math.max(0, Math.floor(i.daysBehind))));
}

// FNV-1a: stable string to uint32, so a retry on the same plan and date reseeds identically.
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The day's sends in time order. Anchors always go out; midday sits at the
 * midpoint of morning and evening; extras are drawn one at a time uniformly
 * from the minutes still 45 or more from every send, strictly between morning
 * and night. Extra k depends only on extras 1..k-1, so raising the count never
 * moves an extra that may already have been sent. Overflow is dropped.
 *
 * `midday` defaults to count === 4 (the mock window row); pass false when four
 * messages are a one-day-behind ladder, whose fourth is a random extra.
 */
export function daySlots(i: {
  planId: string;
  localDate: string;
  schedule: Schedule;
  count: number;
  midday?: boolean;
}): DaySlot[] {
  if (i.count <= 0) return [];
  const count = Math.min(i.count, MAX_PER_DAY);
  const at = (s: AnchorSlot) => i.schedule[s].hour * 60 + i.schedule[s].minute;
  const morning = at("prescription");
  const night = at("debrief");

  const out: DaySlot[] = (["prescription", "nudge", "debrief"] as const).map((slot) => ({
    slot,
    ...i.schedule[slot],
  }));
  const taken = out.map((s) => s.hour * 60 + s.minute);

  let remaining = count - 3;
  if (remaining > 0 && (i.midday ?? count === 4)) {
    const m = Math.floor((morning + at("nudge")) / 2);
    out.push({ slot: "midday", hour: Math.floor(m / 60), minute: m % 60 });
    taken.push(m);
    remaining--;
  }

  const rng = mulberry32(fnv1a(`${i.planId}|${i.localDate}`));
  for (let k = 1; k <= Math.min(remaining, MAX_EXTRAS); k++) {
    const free: number[] = [];
    for (let m = morning + 1; m < night; m++) {
      if (taken.every((t) => Math.abs(m - t) >= MIN_GAP)) free.push(m);
    }
    if (free.length === 0) break;
    const m = free[Math.floor(rng() * free.length)]!;
    taken.push(m);
    out.push({ slot: `extra-${k}`, hour: Math.floor(m / 60), minute: m % 60 });
  }

  return out.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
}
