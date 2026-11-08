import type { StudyPlan } from "@prisma/client";
import { db } from "./db";
import {
  targetDailyPace,
  remainingHours,
  splitProgress,
  type WeeklyAvailability,
} from "../core/pace";

// Freezing one plan's progress for the day.
//
// Extracted from the nightly tick so the user-triggered run reuses exactly the
// same maths. Two copies of this would drift, and a manual run that disagreed
// with the nightly one would be worse than no manual run at all.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addUTCDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

export type SnapshotOutcome = "written" | "skipped";

/**
 * What the snapshot run loaded, returned so a caller needing the same rows
 * (the nightly tick, for its missed-day push) does not query them twice.
 */
export type SnapshotResult = {
  outcome: SnapshotOutcome;
  weeklyAvailability: WeeklyAvailability;
  holidays: Array<{ start: Date; end: Date }>;
  logDates: Date[];
};

/**
 * Upserts today's ProgressSnapshot for one plan.
 *
 * Returns "skipped" once the exam date has passed: a finished plan gets no
 * further snapshots, which is also what stops a candidate receiving missed-day
 * pushes forever after sitting the exam.
 *
 * The upsert is on the [planId, date] unique constraint, so running this twice
 * in a day updates one row rather than creating two. That idempotence is what
 * makes a user-triggered run safe to expose.
 */
export async function writeSnapshotForPlan(plan: StudyPlan, today: Date): Promise<SnapshotResult> {
  const weeklyAvailability = plan.weeklyAvailability as unknown as WeeklyAvailability;
  if (startOfUTCDay(plan.examDate).getTime() < today.getTime()) {
    return { outcome: "skipped", weeklyAvailability, holidays: [], logDates: [] };
  }

  const [holidayRows, losRows, logs] = await Promise.all([
    db.planHoliday.findMany({ where: { planId: plan.id } }),
    db.lOS.findMany({ where: { reading: { topic: { levelId: plan.levelId } } }, select: { id: true } }),
    // Ascending so the first log per losId in this array is that outcome's
    // first-ever log, which is what separates new coverage from review work.
    db.studyLogEntry.findMany({
      where: { planId: plan.id },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
  ]);

  const holidays = holidayRows.map((h) => ({ start: h.startDate, end: h.endDate }));

  // The pace rate is fixed from the plan's whole start-to-exam span rather than
  // recomputed from today's remaining backlog. Recomputing would make the
  // target chase the actual, so falling behind could never be detected.
  const totalLosCount = losRows.length;
  const totalHoursWhole = remainingHours(weeklyAvailability, plan.startDate, plan.examDate, holidays);
  const basePaceRate = targetDailyPace(totalLosCount, totalLosCount, totalHoursWhole);
  const hoursElapsedBeforeToday = remainingHours(
    weeklyAvailability,
    plan.startDate,
    addUTCDays(today, -1),
    holidays,
  );
  const targetCumulative = Math.max(
    0,
    Math.min(totalLosCount, Math.round(basePaceRate * hoursElapsedBeforeToday)),
  );

  const seenLos = new Set<string>();
  const isFirstEverLogById = new Map<string, boolean>();
  for (const log of logs) {
    const first = !seenLos.has(log.losId);
    isFirstEverLogById.set(log.id, first);
    if (first) seenLos.add(log.losId);
  }
  const { newCoverage, reviewWork } = splitProgress(
    logs.map((l) => ({ isFirstEverLog: isFirstEverLogById.get(l.id) ?? false })),
  );
  const actualCumulative = newCoverage + reviewWork;

  await db.progressSnapshot.upsert({
    where: { planId_date: { planId: plan.id, date: today } },
    create: { planId: plan.id, date: today, targetCumulative, actualCumulative },
    update: { targetCumulative, actualCumulative },
  });

  return {
    outcome: "written",
    weeklyAvailability,
    holidays,
    logDates: logs.map((l) => l.date),
  };
}

export { MS_PER_DAY };
