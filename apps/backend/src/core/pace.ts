// Pure pace/coverage/behind-ahead engine. No DB, no HTTP, no framework.
// Tasks 9-13 import these to compute plan progress; keep every function
// deterministic and side-effect free so the math is independently verifiable.

export type WeeklyAvailability = {
  mon: number;
  tue: number;
  wed: number;
  thu: number;
  fri: number;
  sat: number;
  sun: number;
};

export type LosWithStatus = {
  losId: string;
  status: "not-started" | "covered" | "flagged";
  lastRatedAt?: Date;
  order: number;
};

export type DateRange = { start: Date; end: Date };

export const DEFAULT_PACE_CEILING_HOURS = 6;
export const DEFAULT_CONTENT_RATIO = 1 / 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Date.UTC's getDay() ordering (0 = Sunday); indexes WeeklyAvailability keys.
const WEEKDAY_KEYS: Array<keyof WeeklyAvailability> = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

// All date math below runs in UTC calendar days, deliberately ignoring the
// host machine's timezone: these are plan dates ("2026-11-04"), not instants.
function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUTCDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

function toISODate(d: Date): string {
  return startOfUTCDay(d).toISOString().slice(0, 10);
}

function isWithinAnyRange(day: Date, ranges: DateRange[]): boolean {
  const t = startOfUTCDay(day).getTime();
  return ranges.some((r) => {
    const start = startOfUTCDay(r.start).getTime();
    const end = startOfUTCDay(r.end).getTime();
    return t >= start && t <= end;
  });
}

function plannedHoursFor(weeklyAvailability: WeeklyAvailability, day: Date): number {
  return weeklyAvailability[WEEKDAY_KEYS[day.getUTCDay()]];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sum of available study hours from `from` through `examDate`, both
 * inclusive, zeroing out any day that falls inside a holiday range
 * regardless of its weekday. Returns 0 (never negative) once examDate is
 * on or before the day before `from`.
 */
export function remainingHours(
  weeklyAvailability: WeeklyAvailability,
  from: Date,
  examDate: Date,
  holidays: DateRange[]
): number {
  const start = startOfUTCDay(from);
  const end = startOfUTCDay(examDate);
  if (end.getTime() < start.getTime()) return 0;

  let total = 0;
  for (let d = start; d.getTime() <= end.getTime(); d = addUTCDays(d, 1)) {
    if (isWithinAnyRange(d, holidays)) continue;
    total += plannedHoursFor(weeklyAvailability, d);
  }
  return total;
}

/**
 * LOS per available study hour, spread evenly across remaining hours.
 * `totalLosCount` is part of the interface for callers' bookkeeping
 * (e.g. Task 10 needs it alongside this value) but this formula only
 * needs the remaining count and remaining hours.
 */
export function targetDailyPace(
  totalLosCount: number,
  remainingLosCount: number,
  remainingHours: number
): number {
  if (remainingHours <= 0) return 0;
  return remainingLosCount / remainingHours;
}

/**
 * Flagged-for-review LOS first (oldest-rated first), then not-yet-studied
 * LOS in curriculum order. "Covered" LOS never need studying next, so
 * they're dropped from the result.
 */
export function studyNextList(losList: LosWithStatus[]): LosWithStatus[] {
  const flagged = losList
    .filter((l) => l.status === "flagged")
    .sort((a, b) => (a.lastRatedAt?.getTime() ?? 0) - (b.lastRatedAt?.getTime() ?? 0));
  const notStarted = losList
    .filter((l) => l.status === "not-started")
    .sort((a, b) => a.order - b.order);
  return [...flagged, ...notStarted];
}

/** Distinct losId count: re-logging the same LOS never counts twice. */
export function coverageCount(logs: { losId: string }[]): number {
  return new Set(logs.map((l) => l.losId)).size;
}

/**
 * Cumulative actual vs. cumulative target: a negative delta/percent-below-100
 * means behind pace. Guards the target=0 edge case (nothing was due yet) so
 * it never divides by zero.
 */
export function behindAhead(
  actualCumulative: number,
  targetCumulative: number
): { delta: number; percent: number } {
  const delta = actualCumulative - targetCumulative;
  const percent =
    targetCumulative <= 0
      ? actualCumulative > 0
        ? 100
        : 0
      : round2((actualCumulative / targetCumulative) * 100);
  return { delta, percent };
}

/**
 * ISO date strings (inclusive range) where that weekday's planned hours > 0,
 * the day isn't inside any holiday range, and no logged date falls on it.
 */
export function missedStudyDays(
  weeklyAvailability: WeeklyAvailability,
  loggedDates: Date[],
  { from, to }: { from: Date; to: Date },
  holidays: DateRange[]
): string[] {
  const loggedKeys = new Set(loggedDates.map((d) => toISODate(d)));
  const start = startOfUTCDay(from);
  const end = startOfUTCDay(to);

  const missed: string[] = [];
  for (let d = start; d.getTime() <= end.getTime(); d = addUTCDays(d, 1)) {
    if (plannedHoursFor(weeklyAvailability, d) <= 0) continue;
    if (isWithinAnyRange(d, holidays)) continue;
    const iso = toISODate(d);
    if (!loggedKeys.has(iso)) missed.push(iso);
  }
  return missed;
}

/**
 * Three independent threshold checks, any one alone is sufficient:
 * low confidence, poor accuracy (once enough questions exist to mean
 * anything), or staleness. No curve-fitting, no combined score.
 */
export function classifyLosFlag(
  input: {
    confidence: number;
    questionsAnswered: number;
    questionsCorrect: number;
    lastTouchedAt: Date;
  },
  now: Date
): boolean {
  const { confidence, questionsAnswered, questionsCorrect, lastTouchedAt } = input;

  if (confidence <= 2) return true;
  if (questionsAnswered >= 3 && questionsCorrect / questionsAnswered < 0.6) return true;

  const daysSinceTouch = (now.getTime() - lastTouchedAt.getTime()) / MS_PER_DAY;
  if (daysSinceTouch > 30) return true;

  return false;
}

/**
 * Coverage percentage weighted by each LOS's pre-divided slice of its
 * topic's exam weight, not a flat per-LOS count.
 */
export function weightedCoveragePercent(
  items: Array<{ covered: boolean; weightShare: number }>
): number {
  const total = items.reduce((sum, i) => sum + i.weightShare, 0);
  if (total <= 0) return 0;
  const coveredWeight = items.filter((i) => i.covered).reduce((sum, i) => sum + i.weightShare, 0);
  return round2((coveredWeight / total) * 100);
}

/**
 * Splits a period's logs into first-time coverage (new breadth) and
 * review-of-already-covered work, tracked separately so re-drilling
 * familiar material can't stand in for stalled breadth.
 */
export function splitProgress(
  logs: Array<{ isFirstEverLog: boolean }>
): { newCoverage: number; reviewWork: number } {
  let newCoverage = 0;
  let reviewWork = 0;
  for (const log of logs) {
    if (log.isFirstEverLog) newCoverage += 1;
    else reviewWork += 1;
  }
  return { newCoverage, reviewWork };
}

/**
 * False once the computed required daily pace exceeds a sane ceiling,
 * implying more study hours than plausible given the user's own template.
 */
export function isPaceRealistic(
  requiredDailyHours: number,
  ceilingHoursPerDay: number = DEFAULT_PACE_CEILING_HOURS
): boolean {
  return requiredDailyHours <= ceilingHoursPerDay;
}

/**
 * True only when ALL hold: questions answered against questions-role
 * packages sum to >= 20, exactly one package contributed any of them, and
 * confidence is still below 4. Informational nudge only, never a gate.
 */
export function shouldNudgeDiversity(
  questionsByPackageId: Record<string, number>,
  confidence: number
): boolean {
  const values = Object.values(questionsByPackageId);
  const sum = values.reduce((a, b) => a + b, 0);
  const nonZeroCount = values.filter((v) => v > 0).length;
  return sum >= 20 && nonZeroCount === 1 && confidence < 4;
}

/**
 * The "power set" method split: by default one-third of remaining weekly
 * hours to content, two-thirds to practice (practice gets the remainder,
 * so the two always sum back to the input exactly).
 */
export function recommendedSessionSplit(
  remainingWeeklyHours: number,
  contentRatio: number = DEFAULT_CONTENT_RATIO
): { contentHours: number; practiceHours: number } {
  const contentHours = round2(remainingWeeklyHours * contentRatio);
  const practiceHours = round2(remainingWeeklyHours - contentHours);
  return { contentHours, practiceHours };
}
