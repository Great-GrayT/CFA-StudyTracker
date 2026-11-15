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

export type PacePoint = {
  date: string;
  target: number;
  newCoverage: number;
  reviewWork: number;
};

/**
 * Daily series from the log history, plan start to today or the exam.
 *
 * Built client side rather than from ProgressSnapshot, which stores only two
 * integers per day and so cannot carry the new versus review split at all.
 */
export function buildSeries(opts: {
  plan: Plan;
  logs: LogEntry[];
  totalOutcomes: number;
  holidays: Holiday[];
  to?: Date;
}): PacePoint[] {
  const { plan, logs, totalOutcomes } = opts;
  const start = startOfUTCDay(new Date(plan.startDate));
  const exam = startOfUTCDay(new Date(plan.examDate));
  const end = startOfUTCDay(opts.to ?? new Date());
  const last = end.getTime() < exam.getTime() ? end : exam;

  const holidays = opts.holidays.map((h) => ({
    start: startOfUTCDay(new Date(h.startDate)),
    end: startOfUTCDay(new Date(h.endDate)),
  }));

  const totalHours = hoursBetween(plan.weeklyAvailability, start, exam, holidays);
  const rate = totalHours > 0 ? totalOutcomes / totalHours : 0;

  const byDate = new Map<string, LogEntry[]>();
  for (const l of logs) {
    const key = toISODate(new Date(l.date));
    const list = byDate.get(key);
    if (list) list.push(l);
    else byDate.set(key, [l]);
  }

  const out: PacePoint[] = [];
  let cursor = start;
  let runningNew = 0;
  let runningReview = 0;
  const seen = new Set<string>();

  while (cursor.getTime() <= last.getTime()) {
    const key = toISODate(cursor);
    for (const l of byDate.get(key) ?? []) {
      if (seen.has(l.losId)) runningReview += 1;
      else {
        seen.add(l.losId);
        runningNew += 1;
      }
    }
    const elapsedHours = hoursBetween(plan.weeklyAvailability, start, cursor, holidays);
    out.push({
      date: key,
      target: Math.max(0, Math.min(totalOutcomes, Math.round(rate * elapsedHours))),
      newCoverage: runningNew,
      reviewWork: runningReview,
    });
    cursor = addUTCDays(cursor, 1);
  }
  return out;
}

export type PaceRange = "30d" | "90d" | "all";

/** The trailing window of a daily series. */
export function sliceSeries(series: PacePoint[], range: PaceRange): PacePoint[] {
  if (range === "all") return series;
  const days = range === "30d" ? 30 : 90;
  return series.slice(Math.max(0, series.length - days));
}

export type PaceRollup = {
  /** Week: ISO date of its Monday. Month: YYYY-MM. */
  key: string;
  /** The period's last day in the series. */
  end: string;
  /** Distinct outcomes covered by the period's last day. */
  covered: number;
  target: number;
  delta: number;
  /** Outcomes first covered inside the period. */
  added: number;
};

/**
 * One row per week or month, read at the period's last day, newest first.
 *
 * Covered is new coverage only, the same figure as the pace sentence: counting
 * review here would let re-drilling hide a breadth shortfall.
 */
export function rollupSeries(series: PacePoint[], by: "week" | "month"): PaceRollup[] {
  const keyOf = (date: string) => {
    if (by === "month") return date.slice(0, 7);
    const d = new Date(`${date}T00:00:00Z`);
    return toISODate(addUTCDays(d, -((d.getUTCDay() + 6) % 7)));
  };
  const ends: PacePoint[] = [];
  const keys: string[] = [];
  for (const p of series) {
    const k = keyOf(p.date);
    if (keys[keys.length - 1] === k) ends[ends.length - 1] = p;
    else {
      keys.push(k);
      ends.push(p);
    }
  }
  // The series opens at zero coverage, so the first period's gain is its total.
  const rows = ends.map((p, i) => ({
    key: keys[i],
    end: p.date,
    covered: p.newCoverage,
    target: p.target,
    delta: p.newCoverage - p.target,
    added: p.newCoverage - (i > 0 ? ends[i - 1].newCoverage : 0),
  }));
  return rows.reverse();
}
