import { db } from "./db";
import type {
  EffortConstants,
  ResourceInput,
} from "../core/effort";
import { DEFAULT_EFFORT_CONSTANTS, estimateModule, estimateResource } from "../core/effort";
import type { TopicEstimate } from "../core/allocation";
import { allocate, weightImpliedMinutes } from "../core/allocation";
import type { Strategy } from "../core/ordering";
import type { SequencableGroup } from "../core/sequence";
import { sequenceUnits } from "../core/sequence";
import type {
  PackableGroup,
  Calendar,
  PlannedDay,
  PlannedTask,
} from "../core/packing";
import { packDays } from "../core/packing";
import type { FactorKey, FactorTree } from "../core/calibration";
import { factorFor, updateFactor } from "../core/calibration";
import { parseTuning } from "../core/tuning";
import type { MasteryObservation } from "../core/mastery";
import { isEligibleToJump, masteryOfUnit } from "../core/mastery";
import type { UnderPractised, WriteOff } from "../core/pairing";
import {
  packFirstPass,
  questionMinutesOf,
  readingMinutesOf,
  reconcile,
  solveQuestionMultiple,
} from "../core/pairing";
import { packReview, projectCoverageDate, reviewPhaseStart, reviewQueue } from "../core/review";

const HORIZON_DAYS = 14;

// The resource kinds effort.ts's estimator actually knows how to price.
// The catalogue also carries administrative kinds (e.g. "update" changelog
// notes, "orientation" welcome videos) that are not study content at all;
// estimateResource throws on anything outside this set by design (it is a
// pure function with no business silently guessing at an unknown kind), so
// this composition layer must filter them out before they ever reach it.
const KNOWN_EFFORT_KINDS = new Set([
  "lecture",
  "eocq",
  "review",
  "seminar",
  "notes",
  "question_set",
  "answer_set",
]);

// The resource kinds that count as reading and as questions, for working out
// what a candidate has already done. Mirrors readingMinutesOf and
// questionMinutesOf in core/pairing.ts, which own the split; these are the
// TASK kinds the packers emit rather than the resource kinds the estimator
// prices. "review" is absent from both on purpose: it belongs to the review
// phase and settles no first-pass debt.
const READING_TASK_KINDS = new Set(["content-notes", "content-video", "seminar"]);
const QUESTION_TASK_KINDS = new Set(["questions", "eocq"]);

/**
 * Minutes of reading and of questions already completed, per unit.
 *
 * Uses actualMinutes where the candidate recorded one and the estimate
 * otherwise, because a debt should be settled by the time really spent, not by
 * what the plan guessed it would take.
 */
async function loadWorkDone(planId: string): Promise<{
  readingDoneByRef: Map<string, number>;
  questionsDoneByRef: Map<string, number>;
}> {
  const done = await db.planTask.findMany({
    where: { planId, status: "done" },
    select: { kind: true, readingIds: true, estimatedMinutes: true, actualMinutes: true },
  });

  const readingDoneByRef = new Map<string, number>();
  const questionsDoneByRef = new Map<string, number>();

  for (const task of done) {
    const minutes = task.actualMinutes ?? task.estimatedMinutes;
    if (minutes <= 0) continue;
    const target = READING_TASK_KINDS.has(task.kind)
      ? readingDoneByRef
      : QUESTION_TASK_KINDS.has(task.kind)
        ? questionsDoneByRef
        : null;
    if (!target) continue;

    // A task can span several readings (an ethics task covers seven modules),
    // so split its minutes evenly rather than crediting each in full.
    const refs = task.readingIds.length > 0 ? task.readingIds : [];
    const share = refs.length > 0 ? minutes / refs.length : 0;
    for (const ref of refs) {
      target.set(ref, (target.get(ref) ?? 0) + share);
    }
  }

  return { readingDoneByRef, questionsDoneByRef };
}

/**
 * Logged work as mastery observations, grouped by unit.
 *
 * `available` has to be a question COUNT, since `answered` is one, but the
 * catalogue records question minutes per resource. Inverting the effort model
 * recovers the count exactly: estimateResource prices a set at
 * count * (Q_BASE + (Q_CALC - Q_BASE) * calcShare), so dividing by that same
 * per-question figure gives the count back, using the candidate's own
 * calibrated constants rather than a second guess at them.
 *
 * Question stock is recorded per unit, not per outcome, so each outcome gets
 * its unit's stock divided pro rata. That is an approximation and it is the
 * honest one available: the provider does not tag questions by outcome.
 */
async function loadMasteryObservations(
  planId: string,
  readings: Array<{ id: string; los: Array<{ id: string }> }>,
  packable: PackableGroup[],
  effortConstants: EffortConstants,
): Promise<Map<string, MasteryObservation[]>> {
  const logs = await db.studyLogEntry.findMany({
    where: { planId },
    select: {
      losId: true,
      confidence: true,
      questionsAnswered: true,
      questionsCorrect: true,
      date: true,
    },
    orderBy: { date: "asc" },
  });

  // Latest row per outcome wins for confidence and date; counts accumulate.
  type Agg = { answered: number; correct: number; confidence: number | null; lastTouch: Date | null };
  const byLos = new Map<string, Agg>();
  for (const row of logs) {
    const prev = byLos.get(row.losId) ?? { answered: 0, correct: 0, confidence: null, lastTouch: null };
    byLos.set(row.losId, {
      answered: prev.answered + row.questionsAnswered,
      correct: prev.correct + row.questionsCorrect,
      confidence: row.confidence,
      lastTouch: row.date,
    });
  }

  const losByReading = new Map(readings.map((r) => [r.id, r.los.map((l) => l.id)]));
  const result = new Map<string, MasteryObservation[]>();

  for (const g of packable) {
    const losIds = losByReading.get(g.ref) ?? [];
    if (losIds.length === 0) continue;

    const questionMinutes = questionMinutesOf(g);
    const perQuestion =
      effortConstants.Q_BASE +
      (effortConstants.Q_CALC - effortConstants.Q_BASE) * g.calculationShare;
    const unitQuestions = perQuestion > 0 ? questionMinutes / perQuestion : 0;

    result.set(
      g.ref,
      losIds.map((losId) => {
        const agg = byLos.get(losId);
        return {
          losId,
          answered: agg?.answered ?? 0,
          correct: agg?.correct ?? 0,
          available: unitQuestions / losIds.length,
          confidence: agg?.confidence ?? null,
          lastTouch: agg?.lastTouch ?? null,
          questionMinutes: questionMinutes / losIds.length,
        };
      }),
    );
  }

  return result;
}

/**
 * Minutes of real study per study day, measured rather than estimated: the
 * minutes the candidate actually recorded, over the number of distinct days
 * they recorded anything on.
 *
 * Per STUDY day, not per calendar day, because the coverage projection then
 * walks only the days the calendar says are available, and dividing by
 * calendar days here would discount the rest days twice.
 *
 * Zero when nothing is logged yet, which the review throttle reads as "no
 * projection possible" rather than "stopped".
 */
function realisedPace(
  completed: Array<{ date: Date; estimatedMinutes: number; actualMinutes: number | null }>,
): number {
  if (completed.length === 0) return 0;

  let minutes = 0;
  const days = new Set<string>();
  for (const task of completed) {
    minutes += task.actualMinutes ?? task.estimatedMinutes;
    days.add(task.date.toISOString().slice(0, 10));
  }

  return days.size > 0 ? minutes / days.size : 0;
}

/** A calendar with every day's minutes scaled, for splitting a day between phases. */
function scaleCalendar(cal: Calendar, share: number): Calendar {
  return {
    ...cal,
    weeklyAvailability: Object.fromEntries(
      Object.entries(cal.weeklyAvailability).map(([day, minutes]) => [
        day,
        Math.max(0, Math.floor(minutes * share)),
      ]),
    ),
  };
}

/** Merge two phases' days by date, first pass before review on any given day. */
function mergeDays(first: PlannedDay[], review: PlannedDay[]): PlannedDay[] {
  const byDate = new Map<string, PlannedDay>();
  for (const day of first) {
    byDate.set(day.date, { date: day.date, tasks: [...day.tasks] });
  }
  for (const day of review) {
    const existing = byDate.get(day.date);
    if (existing) {
      existing.tasks.push(...day.tasks);
    } else {
      byDate.set(day.date, { date: day.date, tasks: [...day.tasks] });
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Derive the calibration factor tree from completed PlanTask rows in date order.
 */
function deriveFactorTree(completedTasks: Array<{
  estimatedMinutes: number;
  actualMinutes: number | null;
}>): FactorTree {
  const tree: FactorTree = {
    global: { kObs: 1.0, n: 0 },
    byProviderKind: {},
    byProviderKindTopic: {},
  };

  for (const task of completedTasks) {
    if (task.actualMinutes !== null && task.actualMinutes > 0) {
      tree.global = updateFactor(tree.global, {
        estimated: task.estimatedMinutes,
        actual: task.actualMinutes,
      });
    }
  }

  return tree;
}

/** Per-reading question-practice shape, read straight from its question_set
 * resources (not the answer_set mirror, which duplicates the same counts). */
type ReadingQuestionProfile = {
  vignetteCount: number;
  calculationShare: number;
};

/** Raw (pre-trim) eocq/seminar minutes for a topic, carried separately from
 * the single "otherMinutes" bucket allocate() trims, so the two can be
 * split back out honestly once trimming is done. */
type TopicOtherRaw = {
  eocqRaw: number;
  seminarRaw: number;
};

/** Raw (pre-trim) lecture(video)/review minutes for a topic. Both share
 * allocate()'s "reviewMinutes" trim tier (2nd priority), so they need the
 * same post-trim proportional split as eocq/seminar above. */
type TopicReviewRaw = {
  lectureRaw: number;
  reviewRaw: number;
};

/**
 * Build TopicEstimate by estimating effort from catalogue resources linked to readings.
 * Also returns, per reading, its question-practice shape (vignetteCount,
 * calculationShare) and, per topic, the raw eocq/seminar split that
 * "otherMinutes" otherwise flattens.
 */
async function buildTopicEstimates(
  levelId: string,
  totalPlanMinutes: number,
  tree: FactorTree,
  constants: EffortConstants = DEFAULT_EFFORT_CONSTANTS,
): Promise<{
  estimates: TopicEstimate[];
  readingProfiles: Map<string, ReadingQuestionProfile>;
  topicOtherRaw: Map<string, TopicOtherRaw>;
  topicReviewRaw: Map<string, TopicReviewRaw>;
}> {
  const topics = await db.topic.findMany({ where: { levelId } });
  const estimates: TopicEstimate[] = [];
  const readingProfiles = new Map<string, ReadingQuestionProfile>();
  const topicOtherRaw = new Map<string, TopicOtherRaw>();
  const topicReviewRaw = new Map<string, TopicReviewRaw>();

  for (const topic of topics) {
    const readings = await db.reading.findMany({
      where: { topicId: topic.id },
    });

    const weightMid = (topic.examWeightMin + topic.examWeightMax) / 2;
    const topicCap = weightImpliedMinutes(weightMid, totalPlanMinutes);

    let totalTopicMinutes = 0;
    let noteMinutes = 0;
    let reviewMinutes = 0;
    let questionMinutes = 0;
    let otherMinutes = 0;
    let eocqRaw = 0;
    let seminarRaw = 0;
    let lectureRaw = 0;
    let reviewRaw = 0;

    // For each reading, estimate effort from its linked resources
    for (const reading of readings) {
      const unitReadings = await db.packageUnitReading.findMany({
        where: { readingId: reading.id },
        include: {
          unit: {
            include: {
              resources: true,
              edition: { include: { package: true } },
            },
          },
        },
      });

      const resourceInputs: ResourceInput[] = [];
      const resourceKeys: FactorKey[] = [];

      let readingQuestionCount = 0;
      let readingCalcCount = 0;
      let readingVignetteCount = 0;

      for (const ur of unitReadings) {
        const provider = ur.unit.edition.package.slug ?? ur.unit.edition.package.id;

        // Notes pages live on the UNIT (notesPageCount), not the resource -
        // the provider inventory records one page range per lecture unit,
        // shared by every resource in it. Reading it off the resource row
        // (which never carries it) silently zeroed every real lecture.
        const unitNotesPages = ur.unit.notesPageCount ?? undefined;

        // eocq and review also need "how long is the lecture", and the
        // inventory never records actual video duration (measured by hand,
        // kept out of the reseedable file - see seed-packages.ts). The
        // lecture's own computed minutes (from notesPages, the same
        // formula effort.ts's "lecture" case uses) is the best proxy for
        // that: it's a measurement of the same lecture, just in pages
        // instead of seconds. Computed at k=1 - this is an input to other
        // resources' estimates, not a final estimate of its own.
        const unitLectureMinutes =
          unitNotesPages !== undefined
            ? estimateResource({ kind: "lecture", notesPages: unitNotesPages }, constants, 1)
            : undefined;

        // Reading the notes is its own task, and nothing in the catalogue
        // represents it. The provider ships one notes PDF per topic, so there is
        // no per-unit `notes` RESOURCE to find; what the inventory does record,
        // per unit, is which pages of those notes cover it. That page range is
        // exactly the input the effort model's "notes" case wants.
        //
        // Without this the notes layer could never produce a task: noteMinutes
        // only ever summed `byKind["notes"]`, no resource had that kind, so it
        // was always zero and `content-notes` was unreachable. The spec gives
        // notes pre-reads 27.1 of 349.4 hours, and that whole layer had nothing
        // behind it.
        //
        // Using the same pages for both a video task and a reading task is not
        // double counting: the model rates them differently on purpose
        // (PAGE_RATE 6.0 min/page to watch the lecture covering those pages,
        // NOTES_RATE 2.5 to read them yourself) because they are two distinct
        // activities over the same material.
        //
        // Pushed as an ordinary input so it goes through the same exam-weight
        // factor and the same module cap as everything else. It is added once
        // per unit rather than once per resource, since the page range belongs
        // to the unit.
        if (unitNotesPages !== undefined) {
          resourceInputs.push({ kind: "notes", notesPages: unitNotesPages });
          resourceKeys.push({ provider, kind: "notes", topic: topic.id });
        }

        for (const res of ur.unit.resources) {
          if (!KNOWN_EFFORT_KINDS.has(res.kind)) continue;

          const input: ResourceInput = { kind: res.kind };

          if (res.kind === "lecture" && unitNotesPages !== undefined) {
            input.notesPages = unitNotesPages;
          }

          if (
            (res.kind === "eocq" || res.kind === "review") &&
            unitLectureMinutes !== undefined
          ) {
            input.lectureMinutes = unitLectureMinutes;
          }

          // A directly measured duration, if one ever exists, overrides the
          // notes-pages proxy above - it's the real number, not a stand-in.
          if (
            (res.kind === "lecture" || res.kind === "eocq" || res.kind === "review") &&
            res.durationSeconds
          ) {
            input.lectureMinutes = Math.round(res.durationSeconds / 60);
          }

          if (res.questionCount) {
            input.questionCount = res.questionCount;
            input.calcCount = res.calcCount ?? 0;
          }

          if (res.wordCount) {
            input.answerWords = res.wordCount;
            input.exhibitCount = res.exhibitCount ?? 0;
            input.calcCount = res.calcCount ?? 0;
          }

          resourceInputs.push(input);
          resourceKeys.push({ provider, kind: res.kind, topic: topic.id });

          // question_set only: answer_set mirrors the same vignette/calc
          // counts for its explanations, so counting both would double them.
          if (res.kind === "question_set") {
            readingQuestionCount += res.questionCount ?? 0;
            readingCalcCount += res.calcCount ?? 0;
            readingVignetteCount += res.vignetteCount ?? 0;
          }
        }
      }

      readingProfiles.set(reading.id, {
        vignetteCount: readingVignetteCount,
        calculationShare:
          readingQuestionCount > 0 ? readingCalcCount / readingQuestionCount : 0.5,
      });

      // Weight-implied cap for this reading is its share of the topic cap
      const readingCap = topicCap / Math.max(1, readings.length);

      const est = estimateModule(
        {
          ref: reading.id,
          resources: resourceInputs,
          weightImpliedMinutes: readingCap,
        },
        constants,
        (_r, i) => factorFor(tree, resourceKeys[i]),
      );

      totalTopicMinutes += est.total;
      // "lecture" is video (content-video), not notes. The "notes" kind is
      // synthesised per unit from its notes page range just above, since the
      // provider ships notes per topic rather than per unit.
      noteMinutes += est.byKind["notes"] ?? 0;
      lectureRaw += est.byKind["lecture"] ?? 0;
      reviewRaw += est.byKind["review"] ?? 0;
      reviewMinutes += (est.byKind["lecture"] ?? 0) + (est.byKind["review"] ?? 0);
      questionMinutes += est.byKind["question_set"] ?? 0;
      questionMinutes += est.byKind["answer_set"] ?? 0;
      eocqRaw += est.byKind["eocq"] ?? 0;
      seminarRaw += est.byKind["seminar"] ?? 0;
      otherMinutes += (est.byKind["eocq"] ?? 0) + (est.byKind["seminar"] ?? 0);
    }

    estimates.push({
      key: topic.id,
      weightMid,
      estimateMinutes: totalTopicMinutes,
      noteMinutes,
      reviewMinutes,
      questionMinutes,
      otherMinutes,
      moduleCount: readings.length,
    });
    topicOtherRaw.set(topic.id, { eocqRaw, seminarRaw });
    topicReviewRaw.set(topic.id, { lectureRaw, reviewRaw });
  }

  return { estimates, readingProfiles, topicOtherRaw, topicReviewRaw };
}

/** A task represents real work the candidate already did, so regeneration
 * must never delete or silently overwrite it: a logged study entry, a
 * status that moved off "pending", recorded actual minutes, or a timer
 * that's currently running. logEntryId alone used to be the only guard. */
function isProtectedWork(task: {
  logEntryId: string | null;
  status: string;
  actualMinutes: number | null;
  timerStartedAt: Date | null;
}): boolean {
  return (
    task.logEntryId !== null ||
    task.status !== "pending" ||
    task.actualMinutes !== null ||
    task.timerStartedAt !== null
  );
}

function readingIdsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** Whether an existing row already reflects the freshly planned task for
 * its slot, so an occupied (date, order) slot is "stable" only when its
 * CONTENT matches - not merely because a row of any kind sits there. */
function taskMatchesPlan(
  existing: {
    kind: string;
    resourceId: string | null;
    readingIds: string[];
    estimatedMinutes: number;
    requiresConfidence: boolean;
    questionTarget: number | null;
    vignetteFrom: number | null;
    vignetteTo: number | null;
    mode: string | null;
    splitOf: string | null;
    splitIndex: number | null;
    splitCount: number | null;
  },
  planned: PlannedTask,
): boolean {
  return (
    existing.kind === planned.kind &&
    (existing.resourceId ?? null) === (planned.resourceId ?? null) &&
    readingIdsEqual(existing.readingIds, planned.readingIds ?? []) &&
    existing.estimatedMinutes === planned.estimatedMinutes &&
    existing.requiresConfidence === planned.requiresConfidence &&
    (existing.questionTarget ?? null) === (planned.questionTarget ?? null) &&
    (existing.vignetteFrom ?? null) === (planned.vignetteFrom ?? null) &&
    (existing.vignetteTo ?? null) === (planned.vignetteTo ?? null) &&
    (existing.mode ?? null) === (planned.mode ?? null) &&
    (existing.splitOf ?? null) === (planned.splitOf ?? null) &&
    (existing.splitIndex ?? null) === (planned.splitIndex ?? null) &&
    (existing.splitCount ?? null) === (planned.splitCount ?? null)
  );
}

/**
 * Main function: generate a 14-day horizon of tasks for a plan.
 * Freezes yesterday's tasks, regenerates the unfrozen window (preserving
 * protected rows), and writes new PlanTask rows. The freeze/delete/write
 * sequence runs inside one transaction so a crash mid-regeneration can
 * never leave a plan half-deleted.
 */
export async function generateHorizon(
  planId: string,
  today: string,
  opts: {
    /** Days to plan. Defaults to the rolling horizon the app writes. */
    horizonDays?: number;
    /**
     * Plan without writing. Nothing is frozen, deleted or created, and the
     * dated days come back on `days` for a caller that wants to read the shape
     * of a plan rather than install it. The campaign projection uses this so
     * there is exactly one pipeline, and a long-range view cannot contradict
     * the horizon it sits above.
     */
    dryRun?: boolean;
  } = {},
): Promise<{
  created: number;
  frozen: number;
  kept: number;
  deleted: number;
  planMode: string;
  reviewPolicy: string;
  requestedQuestionMultiple: number;
  effectiveQuestionMultiple: number;
  calendarTooShort: boolean;
  writeOffs: WriteOff[];
  underPractised: UnderPractised[];
  injectionCap: number;
  reviewReason: string;
  coverageProjection: { date: string; slackDays: number } | null;
  rejectedTuning: Array<{ field: string; reason: string }>;
  days: PlannedDay[];
}> {
  const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });

  // Every constant the engine reads, with the candidate's overrides clamped
  // into range. The columns hold the two choices; the json column holds the
  // numbers. Nothing below reads plan.tuning directly.
  const parsed = parseTuning({
    ...(plan.tuning && typeof plan.tuning === "object" && !Array.isArray(plan.tuning)
      ? (plan.tuning as Record<string, unknown>)
      : {}),
    planMode: plan.planMode,
    reviewPolicy: plan.reviewPolicy,
    reviewStartDate: plan.reviewStartDate
      ? plan.reviewStartDate.toISOString().slice(0, 10)
      : null,
  });
  const tuning = parsed.tuning;

  const horizonDays = Math.max(1, Math.floor(opts.horizonDays ?? HORIZON_DAYS));
  const todayDate = new Date(today + "T00:00:00Z");
  const horizonEnd = new Date(todayDate);
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + horizonDays - 1);

  // Derive calibration factor from completed tasks, and actually use it:
  // every estimate below is scaled by the candidate's own observed pace
  // instead of staying frozen at seed values forever.
  const completedTasks = await db.planTask.findMany({
    where: { planId, status: "done" },
    orderBy: { date: "asc" },
    select: { date: true, estimatedMinutes: true, actualMinutes: true },
  });

  const factorTree = deriveFactorTree(completedTasks);

  // Calculate total plan minutes from weekly availability and exam date
  const weeklyAvailability = plan.weeklyAvailability as Record<string, number>;
  const weekTotal = Object.values(weeklyAvailability).reduce(
    (sum, val) => sum + val,
    0,
  );
  const weeksUntilExam = Math.ceil(
    (plan.examDate.getTime() - todayDate.getTime()) / (7 * 24 * 60 * 60 * 1000),
  );
  // weeklyAvailability is in HOURS (the onboarding question is "how many hours
  // a week?"), and every estimate downstream of this is in minutes. Without
  // the conversion the whole plan was budgeted at 560 minutes instead of
  // 33,600 for a 20 hour week, so allocation trimmed every topic to a few
  // minutes, the packer found nothing that fit a day, and generateHorizon
  // returned "created: 0". That is why no plan had a single task and the
  // Today screen had nothing but outcome text to show.
  const totalPlanMinutes = Math.max(1, weekTotal * 60 * weeksUntilExam);

  // Build effort estimates and allocate by topic
  const { estimates: topicEstimates, readingProfiles, topicOtherRaw, topicReviewRaw } =
    await buildTopicEstimates(plan.levelId, totalPlanMinutes, factorTree);
  const allocationResult = allocate(topicEstimates, totalPlanMinutes);

  // Get all readings and build SchedulableGroup objects
  const readings = await db.reading.findMany({
    where: { topic: { levelId: plan.levelId } },
    include: { topic: true, los: { select: { id: true } } },
  });

  const groups: SequencableGroup[] = [];
  for (const reading of readings) {
    const budget = allocationResult.byTopic.get(reading.topicId);
    if (!budget || budget.minutes <= 0) continue;

    const readingCountForTopic = readings.filter(
      (r) => r.topicId === reading.topicId,
    ).length;

    const weightMid = (reading.topic.examWeightMin + reading.topic.examWeightMax) / 2;

    groups.push({
      ref: reading.id,
      readingRefs: [reading.id],
      prereqRefs: reading.prereqRefs ?? [],
      phaseBand: reading.phaseBand ?? 1,
      moduleOrder: reading.order,
      // The ordinal ordering.ts never had. Taken from the Topic row rather
      // than parsed out of the ref, because parsing a curriculum position out
      // of a string identifier is how a planner comes to read Ethics before
      // Quantitative Methods.
      topicOrder: reading.topic.order,
      priorityRank: reading.priorityRank ?? 0,
      weight: weightMid,
      estimatedMinutes: Math.max(1, budget.minutes / readingCountForTopic),
      weightImpliedMinutes: Math.max(
        1,
        (weightMid / 100) * totalPlanMinutes / readingCountForTopic,
      ),
    });
  }

  // Sequence by plan mode. effort-return delegates to the old engine, so
  // switching back to it really does reproduce the old behaviour; the two
  // curriculum modes run whole topic areas in curriculum order.
  const ordered =
    groups.length > 0
      ? sequenceUnits(groups, tuning.planMode, (plan.orderingStrategy ?? "curriculum") as Strategy)
      : [];

  // Convert SchedulableGroup to PackableGroup with per-kind breakdown
  const packable: Array<PackableGroup & { topicOrder: number }> = [];
  for (const group of ordered) {
    const reading = readings.find((r) => r.id === group.ref);
    if (!reading) continue;

    const budget = allocationResult.byTopic.get(reading.topicId);
    if (!budget) continue;

    const readingCountForTopic = readings.filter(
      (r) => r.topicId === reading.topicId,
    ).length;

    // otherMinutes is eocq+seminar folded together for allocation's
    // trimming purposes; split it back out here, scaled by whatever
    // fraction of the raw total survived trimming, so eocqMinutes +
    // seminarMinutes always sums to budget.otherMinutes exactly.
    const otherRaw = topicOtherRaw.get(reading.topicId) ?? { eocqRaw: 0, seminarRaw: 0 };
    const otherRawTotal = otherRaw.eocqRaw + otherRaw.seminarRaw;
    const otherScale = otherRawTotal > 0 ? budget.otherMinutes / otherRawTotal : 0;
    const eocqShare = otherRaw.eocqRaw * otherScale;
    const seminarShare = otherRaw.seminarRaw * otherScale;

    // reviewMinutes is lecture(video)+review folded together for
    // allocation's trimming purposes (same reason/technique as otherMinutes
    // above); split it back out scaled by whatever fraction survived
    // trimming, so videoMinutes + reviewMinutes always sums to
    // budget.reviewMinutes exactly.
    const reviewRaw = topicReviewRaw.get(reading.topicId) ?? { lectureRaw: 0, reviewRaw: 0 };
    const reviewRawTotal = reviewRaw.lectureRaw + reviewRaw.reviewRaw;
    const reviewScale = reviewRawTotal > 0 ? budget.reviewMinutes / reviewRawTotal : 0;
    const videoShare = reviewRaw.lectureRaw * reviewScale;
    const reviewShare = reviewRaw.reviewRaw * reviewScale;

    const profile = readingProfiles.get(reading.id) ?? {
      vignetteCount: 0,
      calculationShare: 0.5,
    };

    packable.push({
      ...group,
      noteMinutes: Math.max(0, budget.noteMinutes / readingCountForTopic),
      videoMinutes: Math.max(0, videoShare / readingCountForTopic),
      eocqMinutes: Math.max(0, eocqShare / readingCountForTopic),
      seminarMinutes: Math.max(0, seminarShare / readingCountForTopic),
      reviewMinutes: Math.max(0, reviewShare / readingCountForTopic),
      questionMinutes: Math.max(0, budget.questionMinutes / readingCountForTopic),
      vignetteCount: profile.vignetteCount,
      calculationShare: profile.calculationShare,
    });
  }

  // Pack into days
  // packDays budgets a day in MINUTES; StudyPlan.weeklyAvailability is in
  // hours, which is what onboarding asks for. Passed through unconverted, a
  // two hour Tuesday became a two minute Tuesday, nothing cleared the 15
  // minute floor for a task, and every day in the horizon came back empty.
  const calendar: Calendar = {
    weeklyAvailability: Object.fromEntries(
      Object.entries(weeklyAvailability).map(([day, hours]) => [day, hours * 60]),
    ),
    startDate: today,
    horizonDays,
    holidays: [],
  };

  // -------------------------------------------------------------------------
  // Pack. effort-return keeps the original packer untouched, so its output
  // cannot drift. The curriculum modes run the paired first pass and the
  // review phase, composed below.
  // -------------------------------------------------------------------------
  let plannedDays: PlannedDay[];
  let solved = { pacing: tuning.firstPassQuestionMultiple, budget: tuning.firstPassQuestionMultiple, requested: tuning.firstPassQuestionMultiple, calendarTooShort: false };
  let writeOffs: WriteOff[] = [];
  let underPractised: UnderPractised[] = [];
  let reviewPhase = { active: false, cap: 0, reason: "not applicable to this plan mode" };
  let coverageProjection: { date: string; slackDays: number } | null = null;

  if (packable.length === 0) {
    plannedDays = [];
  } else if (tuning.planMode === "effort-return") {
    plannedDays = packDays(packable, calendar, {});
  } else {
    const asOf = todayDate;

    // What the candidate has actually done, on plan or off it. Reading and
    // question minutes come from completed tasks; mastery comes from the log.
    const { readingDoneByRef, questionsDoneByRef } = await loadWorkDone(planId);
    const logsByRef = await loadMasteryObservations(planId, readings, packable, DEFAULT_EFFORT_CONSTANTS);

    const totalReadingMinutes = packable.reduce((sum, g) => sum + readingMinutesOf(g), 0);
    solved = solveQuestionMultiple(totalReadingMinutes, totalPlanMinutes, tuning);

    const reconciled = reconcile(
      packable,
      logsByRef,
      readingDoneByRef,
      questionsDoneByRef,
      solved.budget,
      asOf,
      tuning,
    );
    writeOffs = reconciled.writeOffs;
    underPractised = reconciled.underPractised;

    const unreadMinutes = reconciled.units.reduce((sum, u) => sum + u.readingDebt, 0);
    const allCovered = unreadMinutes <= 0;
    const realisedPacePerDay = realisedPace(completedTasks);

    reviewPhase = reviewPhaseStart(
      calendar,
      { unreadMinutes, realisedPacePerDay, allCovered },
      plan.examDate.toISOString().slice(0, 10),
      asOf,
      tuning,
    );
    if (realisedPacePerDay > 0 && !allCovered) {
      coverageProjection = projectCoverageDate(
        unreadMinutes,
        realisedPacePerDay,
        asOf,
        calendar,
        plan.examDate.toISOString().slice(0, 10),
        tuning,
      );
    }

    // Only units already read once are eligible for review. Unread material
    // belongs to the first pass, whatever its mastery says.
    const covered = new Set(
      packable
        .filter((g) => (readingDoneByRef.get(g.ref) ?? 0) >= readingMinutesOf(g) && readingMinutesOf(g) > 0)
        .map((g) => g.ref),
    );
    const queue = reviewQueue(
      packable
        .filter((g) => covered.has(g.ref))
        .map((g) => {
          const obs = logsByRef.get(g.ref) ?? [];
          return {
            ref: g.ref,
            readingRefs: g.readingRefs,
            topicOrder: g.topicOrder,
            moduleOrder: g.moduleOrder,
            reviewReadMinutes: g.reviewMinutes ?? 0,
            questionMinutes: questionMinutesOf(g),
            mastery: masteryOfUnit(obs, asOf, tuning),
            eligible: isEligibleToJump(obs, asOf, tuning),
            vignetteCount: g.vignetteCount,
            calculationShare: g.calculationShare,
          };
        }),
      tuning.planMode,
    );

    // Compose the two phases by splitting each day's availability rather than
    // interleaving inside one packer. The review cap is a share of the day, so
    // scaling the calendar is exactly what it means, and each phase keeps its
    // own weekly budget and its own floors.
    // Reserving the review share when there is nothing to review would simply
    // lose it. On a brand new plan nothing is covered yet, so a 35% cap turned
    // every 60 minute day into 39 for the first pass, floor(39/3) fell under
    // the 15 minute reading floor, and the day came back empty. An empty queue
    // means no cap.
    const requestedCap = reviewPhase.active ? Math.min(1, Math.max(0, reviewPhase.cap)) : 0;
    const cap = queue.length === 0 ? 0 : requestedCap;

    const firstPassDays =
      cap >= 1
        ? []
        : packFirstPass(reconciled.units, scaleCalendar(calendar, 1 - cap), solved.pacing, tuning);
    const reviewDays = cap <= 0 ? [] : packReview(queue, scaleCalendar(calendar, cap), tuning);
    reviewPhase = { ...reviewPhase, cap };

    plannedDays = mergeDays(firstPassDays, reviewDays);
  }

  // Build set of (date, order) tuples that are in the new plan.
  const newPlanSlots = new Set<string>();
  for (const day of plannedDays) {
    const dayDate = new Date(day.date + "T00:00:00Z");
    for (let order = 0; order < day.tasks.length; order++) {
      const key = `${dayDate.getTime()}|${order}`;
      newPlanSlots.add(key);
    }
  }

  // Freeze, delete and write all happen in one transaction: a crash
  // between any of these steps must never leave the plan half-regenerated
  // (rows deleted with their replacements never written, or vice versa).
  const reported = {
    planMode: tuning.planMode,
    reviewPolicy: tuning.reviewPolicy,
    requestedQuestionMultiple: solved.requested,
    effectiveQuestionMultiple: solved.budget,
    calendarTooShort: solved.calendarTooShort,
    writeOffs,
    underPractised,
    injectionCap: reviewPhase.cap,
    reviewReason: reviewPhase.reason,
    coverageProjection,
    rejectedTuning: parsed.rejected.map((r) => ({ field: r.field, reason: r.reason })),
    days: plannedDays,
  };

  if (opts.dryRun) {
    return { created: 0, frozen: 0, kept: 0, deleted: 0, ...reported };
  }

  const result = await db.$transaction(async (tx) => {
    // Freeze tasks before today.
    let frozenCount = 0;
    const tasksBeforeToday = await tx.planTask.findMany({
      where: {
        planId,
        date: { lt: todayDate },
      },
    });

    for (const task of tasksBeforeToday) {
      if (!task.frozen) {
        await tx.planTask.update({
          where: { id: task.id },
          data: { frozen: true },
        });
        frozenCount++;
      }
    }

    // Get existing tasks in window for comparison.
    const tasksInWindow = await tx.planTask.findMany({
      where: {
        planId,
        date: { gte: todayDate, lte: horizonEnd },
        frozen: false,
      },
    });

    // Delete tasks that are NOT in the new plan, unless they represent
    // real work (logEntryId, a non-pending status, recorded actual
    // minutes, or a running timer) - any of those survives regeneration.
    let deletedCount = 0;
    for (const task of tasksInWindow) {
      const key = `${task.date.getTime()}|${task.order}`;
      if (!newPlanSlots.has(key) && !isProtectedWork(task)) {
        await tx.planTask.delete({ where: { id: task.id } });
        deletedCount++;
      }
    }

    // Write new tasks, and bring any occupied-but-stale slot's content
    // in line with the fresh plan (an ordering-strategy change, for
    // instance, reassigns which module lands at a given date/order - an
    // occupied slot is only "stable" when its content still matches).
    let createdCount = 0;
    for (const day of plannedDays) {
      const dayDate = new Date(day.date + "T00:00:00Z");

      for (let order = 0; order < day.tasks.length; order++) {
        const plannedTask = day.tasks[order];
        const key = `${dayDate.getTime()}|${order}`;
        const existingInWindow = tasksInWindow.find(
          (t) => `${t.date.getTime()}|${t.order}` === key,
        );

        if (existingInWindow) {
          // Never overwrite real work, even if the plan reassigned this slot.
          if (isProtectedWork(existingInWindow)) continue;
          if (taskMatchesPlan(existingInWindow, plannedTask)) continue;

          await tx.planTask.update({
            where: { id: existingInWindow.id },
            data: {
              kind: plannedTask.kind,
              resourceId: plannedTask.resourceId,
              readingIds: plannedTask.readingIds ?? [],
              estimatedMinutes: plannedTask.estimatedMinutes,
              requiresConfidence: plannedTask.requiresConfidence,
              questionTarget: plannedTask.questionTarget,
              vignetteFrom: plannedTask.vignetteFrom,
              vignetteTo: plannedTask.vignetteTo,
              mode: plannedTask.mode,
              splitOf: plannedTask.splitOf,
              splitIndex: plannedTask.splitIndex,
              splitCount: plannedTask.splitCount,
            },
          });
          continue;
        }

        await tx.planTask.create({
          data: {
            planId,
            date: dayDate,
            order,
            kind: plannedTask.kind,
            resourceId: plannedTask.resourceId,
            readingIds: plannedTask.readingIds ?? [],
            estimatedMinutes: plannedTask.estimatedMinutes,
            requiresConfidence: plannedTask.requiresConfidence,
            questionTarget: plannedTask.questionTarget,
            vignetteFrom: plannedTask.vignetteFrom,
            vignetteTo: plannedTask.vignetteTo,
            mode: plannedTask.mode,
            splitOf: plannedTask.splitOf,
            splitIndex: plannedTask.splitIndex,
            splitCount: plannedTask.splitCount,
            status: "pending",
            frozen: false,
          },
        });
        createdCount++;
      }
    }

    // Count kept tasks: ones that exist in the window and match the new plan's slots.
    let keptCount = 0;
    for (const task of tasksInWindow) {
      const key = `${task.date.getTime()}|${task.order}`;
      if (newPlanSlots.has(key)) {
        keptCount++;
      }
    }

    return {
      created: createdCount,
      frozen: frozenCount,
      kept: keptCount,
      deleted: deletedCount,
    };
  }, { timeout: 30000 });

  return { ...result, ...reported };
}
