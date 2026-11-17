// Long-range projection of a plan: the whole span to the exam, bucketed into
// periods, with each period's minutes split by stage of studying.
//
// Writes nothing. It reads the whole-schedule result of generateHorizon in dry-run mode
// rather than reimplementing the pipeline, because a long-range view computed
// independently would eventually contradict the fourteen day horizon it sits
// above, and the contradiction would be invisible until a candidate noticed
// their chart disagreed with their Monday.

import { db } from "./db";
import { generateHorizon } from "./FUNC-schedule";
import type { FitReport } from "../core/steps";

/**
 * The five stages a minute of study can belong to.
 *
 * Taken from the engine's phases rather than from task kinds, because the same
 * resource kind means different things in the two phases. Notes read for the
 * first time are first-pass reading; a review video watched in the review
 * phase is review reading. Collapsing them into one "content" bucket would
 * hide the first-pass-to-review transition, which is the most interesting
 * thing a long-range chart has to show.
 */
export type StageMinutes = {
  firstPassReading: number;
  firstPassQuestions: number;
  reviewReading: number;
  reviewQuestions: number;
  mocks: number;
};

export type CampaignPeriod = {
  start: string; // ISO date, inclusive
  end: string; // ISO date, inclusive
  minutes: StageMinutes;
};

export type Campaign = {
  periods: CampaignPeriod[];
  examDate: string;
  fit: FitReport;
  planMode: string;
  reviewPolicy: string;
};

// Stage by engine step: steps 1 and 3 are reading, 2 and 4 are questions.

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function emptyStages(): StageMinutes {
  return {
    firstPassReading: 0,
    firstPassQuestions: 0,
    reviewReading: 0,
    reviewQuestions: 0,
    mocks: 0,
  };
}

/**
 * Project a plan over its whole remaining span, bucketed into periods of
 * `periodDays` (default 7, giving ISO-style weeks from today).
 *
 * Period boundaries are NOT phase boundaries. Under the default review policy
 * the first pass and the review phase genuinely share days, so a mid-plan
 * period can legitimately carry four non-mock stages at once. That is the
 * engine working, not a rounding artefact.
 */
export async function projectCampaign(
  planId: string,
  opts: { periodDays?: number; today?: string } = {},
): Promise<Campaign> {
  const periodDays = Math.max(1, Math.floor(opts.periodDays ?? 7));
  const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });

  const today = opts.today ?? toISODate(new Date());
  const todayDate = new Date(today + "T00:00:00Z");
  const examDate = toISODate(plan.examDate);

  // One day past the exam, so an exam-day period is included rather than
  // clipped, and at least one period always exists for a plan whose exam has
  // already passed.
  const spanDays = Math.max(
    1,
    Math.ceil((plan.examDate.getTime() - todayDate.getTime()) / 86_400_000) + 1,
  );

  const projection = await generateHorizon(planId, today, {
    horizonDays: spanDays,
    dryRun: true,
  });

  // Mock exams are logged, not planned, so they come from their own table.
  const mocks = await db.mockExam.findMany({
    where: { planId },
    select: { date: true },
  });
  const mockMinutesByDate = new Map<string, number>();
  for (const mock of mocks) {
    const key = toISODate(mock.date);
    // A Level II mock is three hours of paper plus the debrief that makes it
    // worth sitting. Recorded as one figure because the table stores a score
    // and a date, not a duration.
    mockMinutesByDate.set(key, (mockMinutesByDate.get(key) ?? 0) + 180);
  }

  const periods: CampaignPeriod[] = [];
  for (let offset = 0; offset < spanDays; offset += periodDays) {
    const start = addDays(todayDate, offset);
    const end = addDays(todayDate, Math.min(offset + periodDays - 1, spanDays - 1));
    periods.push({ start: toISODate(start), end: toISODate(end), minutes: emptyStages() });
  }

  const indexFor = (date: string): number => {
    const offset = Math.floor(
      (new Date(date + "T00:00:00Z").getTime() - todayDate.getTime()) / 86_400_000,
    );
    if (offset < 0) return -1;
    const index = Math.floor(offset / periodDays);
    return index < periods.length ? index : -1;
  };

  for (const task of projection.tasks) {
    const index = indexFor(task.date);
    if (index < 0) continue;
    const bucket = periods[index].minutes;
    const minutes = Math.round(task.minutes);
    const { step, kind } = task.item;
    if (kind === "mock" || kind === "mock-review") {
      // Planned mocks; logged ones are added below from their own table.
      bucket.mocks += minutes;
    } else if (step === 1 && kind === "read") bucket.firstPassReading += minutes;
    else if (step === 3) bucket.reviewReading += minutes;
    else if (step === 2) bucket.firstPassQuestions += minutes;
    else if (step === 4) bucket.reviewQuestions += minutes;
  }

  for (const [date, minutes] of mockMinutesByDate) {
    const index = indexFor(date);
    if (index >= 0) periods[index].minutes.mocks += minutes;
  }

  return {
    periods,
    examDate,
    fit: projection.fit,
    planMode: projection.planMode,
    reviewPolicy: projection.reviewPolicy,
  };
}
