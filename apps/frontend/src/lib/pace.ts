import type { LogEntry, WeeklyAvailability, Holiday, Plan } from "./types";
import { WEEKDAYS } from "./types";

// Pace maths computed on the client.
//
// Why not just render the API's numbers: /api/progress returns
// `today.actualCumulative` as a count of LOG ROWS (its splitProgress increments
// once per row) while `today.targetCumulative` is clamped to DISTINCT outcomes.
// Subtracting one from the other is a unit error, and logging the same outcome
// twice inflates the result. The backend already has the right primitive
// (coverageCount, distinct losId) and does not use it here.
//
// So the client derives its own figure from the log history it already holds.
// When the backend bug is fixed this module stays correct, because distinct
// coverage is the honest definition either way.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** UTC calendar day, matching the backend's own startOfUTCDay exactly. */
export function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addUTCDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

/** Outcomes covered at least once. Re-logging one never counts twice. */
export function distinctCovered(logs: LogEntry[]): number {
  return new Set(logs.map((l) => l.losId)).size;
}

/**
 * New coverage and review work, kept apart.
 *
 * The product spec forbids blending these, so that re-drilling familiar
 * material can never stand in for stalled breadth. New coverage counts
 * outcomes seen for the first time; review work counts every later session.
 */
export function splitWork(logs: LogEntry[]): { newCoverage: number; reviewWork: number } {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  let newCoverage = 0;
  let reviewWork = 0;
  for (const log of sorted) {
    if (seen.has(log.losId)) {
      reviewWork += 1;
    } else {
      seen.add(log.losId);
      newCoverage += 1;
    }
  }
  return { newCoverage, reviewWork };
}

function isWithin(day: Date, ranges: Array<{ start: Date; end: Date }>): boolean {
  const t = day.getTime();
  return ranges.some((r) => t >= r.start.getTime() && t <= r.end.getTime());
}

/**
 * Study hours available between two dates, excluding holidays.
 *
 * Inclusive of both ends, matching the backend's remainingHours, so the two
 * never disagree about whether the exam day itself is available.
 */
export function hoursBetween(
  availability: WeeklyAvailability,
  from: Date,
  to: Date,
  holidays: Array<{ start: Date; end: Date }> = [],
): number {
  let total = 0;
  let cursor = startOfUTCDay(from);
  const end = startOfUTCDay(to);
  while (cursor.getTime() <= end.getTime()) {
    if (!isWithin(cursor, holidays)) {
      // getUTCDay is 0 = Sunday; WEEKDAYS starts at Monday.
      const key = WEEKDAYS[(cursor.getUTCDay() + 6) % 7];
      total += availability[key] ?? 0;
    }
    cursor = addUTCDays(cursor, 1);
  }
  return total;
}

export type PaceReading = {
  covered: number;
  target: number;
  /** Negative means behind. */
  delta: number;
  /** Hours of work the gap represents, at the plan's own historic rate. */
  hoursBehind: number;
  totalOutcomes: number;
  hoursRemaining: number;
  requiredDailyHours: number;
  realistic: boolean;
};

/**
 * Where the candidate actually stands today.
 *
 * The target rate is fixed from the plan's whole start-to-exam span rather than
 * recomputed from today's remaining backlog. Recomputing would make the target
 * chase the actual, so falling behind could never be detected: the same
 * reasoning the backend's snapshot uses.
 */
export function readPace(opts: {
  plan: Plan;
  logs: LogEntry[];
  totalOutcomes: number;
  holidays: Holiday[];
  today?: Date;
  paceCeilingHours?: number;
}): PaceReading {
  const { plan, logs, totalOutcomes } = opts;
  const today = startOfUTCDay(opts.today ?? new Date());
  const ceiling = opts.paceCeilingHours ?? 6;

  const holidays = opts.holidays.map((h) => ({
    start: startOfUTCDay(new Date(h.startDate)),
    end: startOfUTCDay(new Date(h.endDate)),
  }));

  const start = startOfUTCDay(new Date(plan.startDate));
  const exam = startOfUTCDay(new Date(plan.examDate));
  const availability = plan.weeklyAvailability;

  const totalHours = hoursBetween(availability, start, exam, holidays);
  const ratePerHour = totalHours > 0 ? totalOutcomes / totalHours : 0;

  // Hours elapsed up to and including yesterday: today is still in progress, so
  // crediting its hours would report the candidate behind every morning.
  const elapsedHours =
    today.getTime() > start.getTime()
      ? hoursBetween(availability, start, addUTCDays(today, -1), holidays)
      : 0;

  const target = Math.max(0, Math.min(totalOutcomes, Math.round(ratePerHour * elapsedHours)));
  const covered = distinctCovered(logs);
  const delta = covered - target;

  const hoursRemaining = hoursBetween(availability, today, exam, holidays);
  const remaining = Math.max(0, totalOutcomes - covered);
  const hoursNeeded = ratePerHour > 0 ? remaining / ratePerHour : remaining > 0 ? Infinity : 0;
  const daysRemaining = Math.max(0, Math.round((exam.getTime() - today.getTime()) / MS_PER_DAY) + 1);
  const requiredDailyHours =
    daysRemaining > 0 ? hoursNeeded / daysRemaining : hoursNeeded > 0 ? Infinity : 0;

  return {
    covered,
    target,
    delta,
    // Priced in hours because "12 outcomes behind" means nothing to a
    // candidate until it is expressed as time they have to find.
    hoursBehind: ratePerHour > 0 ? Math.abs(delta) / ratePerHour : 0,
    totalOutcomes,
    hoursRemaining,
    requiredDailyHours,
    realistic: Number.isFinite(requiredDailyHours) && requiredDailyHours <= ceiling,
  };
}

/**
 * Days in the window that were planned as study days but carry no log.
 *
 * Derived here rather than read from /api/progress, which only reports the
 * trailing six days. The pace chart needs the whole axis.
 */
export function missedDays(opts: {
  plan: Plan;
  logs: LogEntry[];
  holidays: Holiday[];
  from: Date;
  to: Date;
}): string[] {
  const { plan, logs } = opts;
  const holidays = opts.holidays.map((h) => ({
    start: startOfUTCDay(new Date(h.startDate)),
    end: startOfUTCDay(new Date(h.endDate)),
  }));
  const logged = new Set(logs.map((l) => toISODate(new Date(l.date))));

  const start = startOfUTCDay(new Date(plan.startDate));
  // Never flag today: it is still in progress. Never flag before the plan
  // existed, and never after the exam.
  const exam = startOfUTCDay(new Date(plan.examDate));
  const yesterday = addUTCDays(startOfUTCDay(new Date()), -1);

  let cursor = startOfUTCDay(opts.from);
  const hardEnd = Math.min(startOfUTCDay(opts.to).getTime(), yesterday.getTime(), exam.getTime());
  const out: string[] = [];

  while (cursor.getTime() <= hardEnd) {
    if (cursor.getTime() >= start.getTime() && !isWithin(cursor, holidays)) {
      const key = WEEKDAYS[(cursor.getUTCDay() + 6) % 7];
      if ((plan.weeklyAvailability[key] ?? 0) > 0 && !logged.has(toISODate(cursor))) {
        out.push(toISODate(cursor));
      }
    }
    cursor = addUTCDays(cursor, 1);
  }
  return out;
}

/**
 * The content/practice split for what is LEFT of this week.
 *
 * The API's recommendedSplit is the whole weekly sum and never changes, so
 * overlaying this week's logged split on it reads as failure by construction on
 * any day but Sunday. Measuring the remaining days is what makes the advice
 * actionable on a Wednesday.
 */
export function remainingWeekSplit(
  availability: WeeklyAvailability,
  today: Date = new Date(),
  contentRatio = 1 / 3,
): { contentHours: number; practiceHours: number; totalHours: number } {
  const todayIndex = (startOfUTCDay(today).getUTCDay() + 6) % 7;
  let total = 0;
  for (let i = todayIndex; i < WEEKDAYS.length; i++) {
    total += availability[WEEKDAYS[i]] ?? 0;
  }
  return {
    totalHours: total,
    contentHours: total * contentRatio,
    practiceHours: total * (1 - contentRatio),
  };
}
