import { db } from "./db";
import type {
  EffortConstants,
  ResourceInput,
} from "../core/effort";
import { DEFAULT_EFFORT_CONSTANTS, estimateModule, estimateResource } from "../core/effort";
import type { TopicEstimate } from "../core/allocation";
import { allocate, weightImpliedMinutes } from "../core/allocation";
import type {
  SchedulableGroup,
  Strategy,
} from "../core/ordering";
import { orderModules } from "../core/ordering";
import type {
  PackableGroup,
  Calendar,
  PlannedTask,
} from "../core/packing";
import { packDays } from "../core/packing";
import type { FactorKey, FactorTree } from "../core/calibration";
import { factorFor, updateFactor } from "../core/calibration";

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
      // "lecture" is video (content-video), not notes - only the (currently
      // nonexistent in this catalogue) "notes" kind belongs in noteMinutes.
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
): Promise<{ created: number; frozen: number; kept: number; deleted: number }> {
  const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });

  const todayDate = new Date(today + "T00:00:00Z");
  const horizonEnd = new Date(todayDate);
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + HORIZON_DAYS - 1);

  // Derive calibration factor from completed tasks, and actually use it:
  // every estimate below is scaled by the candidate's own observed pace
  // instead of staying frozen at seed values forever.
  const completedTasks = await db.planTask.findMany({
    where: { planId, status: "done" },
    orderBy: { date: "asc" },
    select: { estimatedMinutes: true, actualMinutes: true },
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
  const totalPlanMinutes = Math.max(1, weekTotal * weeksUntilExam);

  // Build effort estimates and allocate by topic
  const { estimates: topicEstimates, readingProfiles, topicOtherRaw, topicReviewRaw } =
    await buildTopicEstimates(plan.levelId, totalPlanMinutes, factorTree);
  const allocationResult = allocate(topicEstimates, totalPlanMinutes);

  // Get all readings and build SchedulableGroup objects
  const readings = await db.reading.findMany({
    where: { topic: { levelId: plan.levelId } },
    include: { topic: true },
  });

  const groups: SchedulableGroup[] = [];
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
      priorityRank: reading.priorityRank ?? 0,
      weight: weightMid,
      estimatedMinutes: Math.max(1, budget.minutes / readingCountForTopic),
      weightImpliedMinutes: Math.max(
        1,
        (weightMid / 100) * totalPlanMinutes / readingCountForTopic,
      ),
    });
  }

  // Order modules based on strategy
  const strategy = (plan.orderingStrategy ?? "curriculum") as Strategy;
  const ordered = groups.length > 0 ? orderModules(groups, strategy) : [];

  // Convert SchedulableGroup to PackableGroup with per-kind breakdown
  const packable: PackableGroup[] = [];
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
  const calendar: Calendar = {
    weeklyAvailability,
    startDate: today,
    horizonDays: HORIZON_DAYS,
    holidays: [],
  };

  const plannedDays = packable.length > 0 ? packDays(packable, calendar, {}) : [];

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

  return result;
}
