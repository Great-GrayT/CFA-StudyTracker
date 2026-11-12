// Long-range projection of a plan: the whole span to the exam, bucketed into
// periods, with each period's minutes split by stage of studying.
//
// Writes nothing. It runs generateHorizon in dry-run mode over the full span
// rather than reimplementing the pipeline, because a long-range view computed
// independently would eventually contradict the fourteen day horizon it sits
// above, and the contradiction would be invisible until a candidate noticed
// their chart disagreed with their Monday.

import { db } from "./db";
import { generateHorizon } from "./FUNC-schedule";

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
  coverageProjection: { date: string; slackDays: number } | null;
  requestedQuestionMultiple: number;
  budgetQuestionMultiple: number;
  calendarTooShort: boolean;
  planMode: string;
  reviewPolicy: string;
};

// Task kinds the first pass emits for reading. The review phase emits "review"
// and nothing else for its reading, which is what makes the two separable from
// the task rows alone.
const FIRST_PASS_READING = new Set(["content-notes", "content-video", "seminar"]);
const QUESTION_KINDS = new Set(["questions", "eocq"]);

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

  for (const day of projection.days) {
    const index = indexFor(day.date);
    if (index < 0) continue;
    const bucket = periods[index].minutes;

    for (const task of day.tasks) {
      const minutes = task.estimatedMinutes;
      if (task.kind === "review") {
        bucket.reviewReading += minutes;
      } else if (FIRST_PASS_READING.has(task.kind)) {
        bucket.firstPassReading += minutes;
      } else if (QUESTION_KINDS.has(task.kind)) {
        // Question tasks carry no phase marker of their own. A day that holds
        // review reading is a day the review phase was active on, so its
        // questions belong to review. This is an attribution at the day level
        // rather than the task level, which is the resolution the chart shows
        // anyway.
        const dayHasReview = day.tasks.some((t) => t.kind === "review");
        if (dayHasReview) bucket.reviewQuestions += minutes;
        else bucket.firstPassQuestions += minutes;
      }
    }
  }

  for (const [date, minutes] of mockMinutesByDate) {
    const index = indexFor(date);
    if (index >= 0) periods[index].minutes.mocks += minutes;
  }

  return {
    periods,
    examDate,
    coverageProjection: projection.coverageProjection,
    requestedQuestionMultiple: projection.requestedQuestionMultiple,
    budgetQuestionMultiple: projection.effectiveQuestionMultiple,
    calendarTooShort: projection.calendarTooShort,
    planMode: projection.planMode,
    reviewPolicy: projection.reviewPolicy,
  };
}
