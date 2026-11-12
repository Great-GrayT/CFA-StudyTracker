// Pure review engine. No DB, no HTTP, no framework.
// Owns the second phase: which units get revisited, in what order, when the
// phase starts at all, and how a week's minutes split between re-reading and
// practice.
//
// The first phase pairs reading with its questions in one sitting. This phase
// deliberately does not. Once material has been read once, the two streams are
// independent: the candidate may be re-watching Equity while answering
// Financial Statement Analysis, and the ratio is a WEEKLY budget rather than a
// per-sitting rule, so a single day may be nothing but questions.

import type { Calendar, PlannedDay, PlannedTask } from "./packing";
import { MIN_TASK_MINUTES } from "./packing";
import type { PlanMode, Tuning } from "./tuning";

export type ReviewUnit = {
  ref: string;
  readingRefs: string[];
  topicOrder: number;
  moduleOrder: number;
  /**
   * Review video minutes. NOT the original notes: the first pass holds this
   * layer back precisely so the review phase has reading of its own, which is
   * what makes a 1 to 4 ratio reachable without re-reading everything.
   */
  reviewReadMinutes: number;
  questionMinutes: number;
  mastery: number;
  /** Whether the evidence lets this unit depart from curriculum order. */
  eligible: boolean;
  vignetteCount: number;
  calculationShare: number;
};

export type CoverageState = {
  unreadMinutes: number;
  realisedPacePerDay: number;
  allCovered: boolean;
};

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const MS_PER_DAY = 86_400_000;

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fromISODate(s: string): Date {
  return new Date(s + "T00:00:00Z");
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function availableMinutesOn(cal: Calendar, date: string): number {
  if (cal.holidays.includes(date)) return 0;
  return cal.weeklyAvailability[WEEKDAY_KEYS[fromISODate(date).getUTCDay()]] ?? 0;
}

/**
 * Order the review queue.
 *
 * `curriculum-strict` promises a sequence the candidate could print, so nothing
 * reorders it, however badly one unit is going.
 *
 * The other two modes serve eligible units weakest first, then everything else
 * in curriculum order. Eligibility is the gate rather than mastery alone,
 * because on a first read almost every unit sits below the bar and sorting on
 * that would discard the candidate's stated ordering in favour of noise.
 */
export function reviewQueue(units: ReviewUnit[], mode: PlanMode): ReviewUnit[] {
  const byCurriculum = (a: ReviewUnit, b: ReviewUnit): number => {
    if (a.topicOrder !== b.topicOrder) return a.topicOrder - b.topicOrder;
    if (a.moduleOrder !== b.moduleOrder) return a.moduleOrder - b.moduleOrder;
    return a.ref.localeCompare(b.ref);
  };

  if (mode === "curriculum-strict") {
    return [...units].sort(byCurriculum);
  }

  const eligible = units
    .filter((u) => u.eligible)
    .sort((a, b) => (a.mastery !== b.mastery ? a.mastery - b.mastery : byCurriculum(a, b)));
  const rest = units.filter((u) => !u.eligible).sort(byCurriculum);
  return [...eligible, ...rest];
}

/**
 * When the first pass is projected to finish, and how many days of slack that
 * leaves against its deadline.
 *
 * Throws on a non-positive pace rather than returning an infinite date. A pace
 * of zero is not a slow candidate, it is an absence of data, and the caller has
 * to decide what to do about that: substituting the estimated pace is right,
 * silently projecting the end of time is not.
 */
export function projectCoverageDate(
  unreadMinutes: number,
  realisedPacePerDay: number,
  asOf: Date,
  cal: Calendar,
  examDate: string,
  t: Tuning,
): { date: string; slackDays: number } {
  if (!(realisedPacePerDay > 0)) {
    throw new Error(
      "projectCoverageDate: pace must be positive. A pace of zero is missing data, not a slow candidate, and the caller must substitute an estimate.",
    );
  }

  const deadline = addDays(fromISODate(examDate), -t.coverageDeadlineWeeks * 7);
  const studyDaysNeeded = Math.max(1, Math.ceil(unreadMinutes / realisedPacePerDay));

  // Walk only the days the candidate actually studies, so holidays and zero
  // days push the projection out rather than being counted as progress.
  // Capped a year past the deadline: a calendar with no study days at all
  // would otherwise walk forever.
  const walkLimit = Math.max(
    730,
    Math.ceil((deadline.getTime() - asOf.getTime()) / MS_PER_DAY) + 365,
  );

  let studyDays = 0;
  let current = asOf;
  let landed = asOf;
  for (let i = 0; i < walkLimit; i++) {
    const date = toISODate(current);
    if (availableMinutesOn(cal, date) > 0) {
      studyDays++;
      landed = current;
      if (studyDays >= studyDaysNeeded) break;
    }
    current = addDays(current, 1);
  }
  if (studyDays < studyDaysNeeded) landed = current;

  return {
    date: toISODate(landed),
    slackDays: Math.round((deadline.getTime() - landed.getTime()) / MS_PER_DAY),
  };
}

/**
 * How much of a day the decay-triggered policy may spend on review, given the
 * slack the first pass has left.
 *
 * Coverage wins until coverage is at risk. A candidate scoring badly early
 * would otherwise earn so many injections that the first pass never finishes,
 * which is the one outcome worse than reviewing too little.
 *
 * A linear ramp rather than a cliff, so the plan does not lurch between two
 * behaviours on a single bad week.
 */
export function injectionCap(slackDays: number, t: Tuning): number {
  const window = t.coverageDeadlineWeeks * 7;
  if (slackDays <= 0) return 0;
  if (slackDays >= window) return t.reviewInjectionCapShare;
  return t.reviewInjectionCapShare * (slackDays / window);
}

/**
 * Whether the review phase is running today, and what share of the day it may
 * take. A cap of 1 means review owns the calendar outright.
 */
export function reviewPhaseStart(
  cal: Calendar,
  coverage: CoverageState,
  examDate: string,
  asOf: Date,
  t: Tuning,
): { active: boolean; cap: number; reason: string } {
  // Whatever the policy, once every unit has been read once there is no first
  // pass left to protect and review takes the rest of the calendar.
  if (coverage.allCovered) {
    return { active: true, cap: 1, reason: "the whole curriculum has been read once" };
  }

  switch (t.reviewPolicy) {
    case "after-coverage":
      return {
        active: false,
        cap: 0,
        reason: "waiting for the first pass to cover every unit",
      };

    case "weekly-interleave":
      return {
        active: true,
        cap: t.weeklyInterleaveShare,
        reason: `a fixed ${Math.round(t.weeklyInterleaveShare * 100)}% of every week goes to review`,
      };

    case "fixed-date": {
      if (t.reviewStartDate === null) {
        throw new Error(
          "reviewPhaseStart: the fixed-date policy needs reviewStartDate. parseTuning falls back when it is missing; a hand-built Tuning must set it.",
        );
      }
      const start = fromISODate(t.reviewStartDate);
      const active = asOf.getTime() >= start.getTime();
      return {
        active,
        cap: active ? 1 : 0,
        reason: active
          ? `review has owned the calendar since ${t.reviewStartDate}`
          : `review starts on ${t.reviewStartDate}`,
      };
    }

    case "decay-triggered": {
      if (!(coverage.realisedPacePerDay > 0)) {
        // No logged work yet, so there is nothing to project from. Running at
        // the full cap is the right default: the first week cannot be behind.
        return {
          active: true,
          cap: t.reviewInjectionCapShare,
          reason: "no realised pace yet, so coverage cannot be projected",
        };
      }

      const projection = projectCoverageDate(
        coverage.unreadMinutes,
        coverage.realisedPacePerDay,
        asOf,
        cal,
        examDate,
        t,
      );
      const cap = injectionCap(projection.slackDays, t);

      if (cap <= 0) {
        return {
          active: false,
          cap: 0,
          reason: `coverage is projected to finish ${projection.date}, past its deadline, so injections are off and the day is coverage only`,
        };
      }
      if (cap < t.reviewInjectionCapShare) {
        return {
          active: true,
          cap,
          reason: `coverage is projected to finish ${projection.date}, with ${projection.slackDays} days of slack, so injections are throttled`,
        };
      }
      return {
        active: true,
        cap,
        reason: `coverage is projected to finish ${projection.date}, comfortably inside its deadline`,
      };
    }
  }
}

type ReviewCursor = {
  index: number;
  readingLeft: number;
  questionsLeft: number;
  questionsDone: number;
};

function makeCursor(queue: ReviewUnit[]): ReviewCursor {
  const first = queue[0];
  return {
    index: 0,
    readingLeft: first ? first.reviewReadMinutes : 0,
    questionsLeft: first ? first.questionMinutes : 0,
    questionsDone: 0,
  };
}

/**
 * Pack the review phase. One part re-reading to `reviewQuestionMultiple` parts
 * practice, held as a WEEKLY budget: any single day may be entirely questions.
 *
 * Questions come first each day, because that is where the learning is, until
 * two study days of the week remain and the reading budget is still underspent.
 * Then reading is forced in. Without that, a deep question bank would eat every
 * week and the review videos would never be watched at all. The alternative,
 * rolling the shortfall into the next week, just defers the same problem with
 * interest.
 *
 * Reading and questions walk INDEPENDENT cursors over the queue, so the
 * candidate may be re-watching one topic while answering another. That is the
 * whole difference between this phase and the first pass.
 */
export function packReview(
  queue: ReviewUnit[],
  cal: Calendar,
  t: Tuning,
): PlannedDay[] {
  const readCursor = makeCursor(queue);
  const questionCursor = makeCursor(queue);
  const days: PlannedDay[] = [];

  const startDate = fromISODate(cal.startDate);
  const endDate = addDays(startDate, cal.horizonDays - 1);

  // Study days per week, precomputed so "two days remain" counts days the
  // candidate can actually use rather than calendar days.
  let current = startDate;
  let dayIndex = 0;
  let weekReadBudget = 0;
  let weekQuestionBudget = 0;
  let weekReadSpent = 0;
  let weekQuestionSpent = 0;
  let studyDaysLeftInWeek = 0;

  const weekBoundsFrom = (offset: number) => {
    let available = 0;
    let studyDays = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(startDate, offset + i);
      if (d > endDate) break;
      const minutes = availableMinutesOn(cal, toISODate(d));
      if (minutes > 0) {
        available += minutes;
        studyDays++;
      }
    }
    return { available, studyDays };
  };

  const drawReading = (want: number): PlannedTask[] => {
    const tasks: PlannedTask[] = [];
    let left = want;
    while (left >= MIN_TASK_MINUTES && readCursor.index < queue.length) {
      const unit = queue[readCursor.index];
      if (readCursor.readingLeft <= 0) {
        readCursor.index++;
        const next = queue[readCursor.index];
        readCursor.readingLeft = next ? next.reviewReadMinutes : 0;
        continue;
      }
      const take = Math.min(readCursor.readingLeft, left);
      if (take < MIN_TASK_MINUTES && take < readCursor.readingLeft) break;
      const minutes = Math.round(take);
      if (minutes <= 0) break;
      tasks.push({
        kind: "review",
        readingIds: unit.readingRefs,
        estimatedMinutes: minutes,
        requiresConfidence: false,
      });
      readCursor.readingLeft -= take;
      left -= take;
    }
    return tasks;
  };

  const drawQuestions = (want: number): PlannedTask[] => {
    const tasks: PlannedTask[] = [];
    let left = want;
    while (left >= MIN_TASK_MINUTES && questionCursor.index < queue.length) {
      const unit = queue[questionCursor.index];
      if (questionCursor.questionsLeft <= 0) {
        questionCursor.index++;
        const next = queue[questionCursor.index];
        questionCursor.questionsLeft = next ? next.questionMinutes : 0;
        questionCursor.questionsDone = 0;
        continue;
      }
      const take = Math.min(questionCursor.questionsLeft, left);
      if (take < MIN_TASK_MINUTES && take < questionCursor.questionsLeft) break;
      const minutes = Math.round(take);
      if (minutes <= 0) break;

      const count = Math.max(1, unit.vignetteCount);
      const perVignette = unit.questionMinutes / count;
      const from = perVignette > 0
        ? Math.min(count - 1, Math.floor(questionCursor.questionsDone / perVignette))
        : 0;
      const to = perVignette > 0
        ? Math.min(
            count - 1,
            Math.max(
              from,
              Math.ceil((questionCursor.questionsDone + take) / perVignette) - 1,
            ),
          )
        : count - 1;

      tasks.push({
        kind: "questions",
        readingIds: unit.readingRefs,
        estimatedMinutes: minutes,
        requiresConfidence: take >= questionCursor.questionsLeft,
        mode: unit.calculationShare >= 0.35 ? "timed-drill" : "untimed-review",
        vignetteFrom: from,
        vignetteTo: to,
      });
      questionCursor.questionsDone += take;
      questionCursor.questionsLeft -= take;
      left -= take;
    }
    return tasks;
  };

  while (current <= endDate) {
    const date = toISODate(current);
    const available = availableMinutesOn(cal, date);

    if (dayIndex % 7 === 0) {
      const bounds = weekBoundsFrom(dayIndex);
      weekReadBudget = bounds.available / (1 + t.reviewQuestionMultiple);
      weekQuestionBudget = bounds.available - weekReadBudget;
      weekReadSpent = 0;
      weekQuestionSpent = 0;
      studyDaysLeftInWeek = bounds.studyDays;
    }
    dayIndex++;

    if (available <= 0) {
      days.push({ date, tasks: [] });
      current = addDays(current, 1);
      continue;
    }

    const tasks: PlannedTask[] = [];
    let remaining = available;

    const readingOwed = weekReadBudget - weekReadSpent;
    const forceReading = studyDaysLeftInWeek <= 2 && readingOwed >= MIN_TASK_MINUTES;

    const spendQuestions = () => {
      const want = Math.min(remaining, weekQuestionBudget - weekQuestionSpent);
      for (const task of drawQuestions(want)) {
        tasks.push(task);
        remaining -= task.estimatedMinutes;
        weekQuestionSpent += task.estimatedMinutes;
      }
    };
    const spendReading = () => {
      const want = Math.min(remaining, weekReadBudget - weekReadSpent);
      for (const task of drawReading(want)) {
        tasks.push(task);
        remaining -= task.estimatedMinutes;
        weekReadSpent += task.estimatedMinutes;
      }
    };

    if (forceReading) {
      spendReading();
      spendQuestions();
    } else {
      spendQuestions();
      spendReading();
    }

    studyDaysLeftInWeek--;
    days.push({ date, tasks });
    current = addDays(current, 1);
  }

  return days;
}
