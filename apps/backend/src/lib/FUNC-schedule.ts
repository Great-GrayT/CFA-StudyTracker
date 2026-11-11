import { db } from "./db";
import type {
  EffortConstants,
  ResourceInput,
} from "../core/effort";
import { DEFAULT_EFFORT_CONSTANTS, estimateModule } from "../core/effort";
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
} from "../core/packing";
import { packDays } from "../core/packing";
import type { FactorTree } from "../core/calibration";
import { updateFactor } from "../core/calibration";

const HORIZON_DAYS = 14;

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

/**
 * Build TopicEstimate by estimating effort from catalogue resources linked to readings.
 */
async function buildTopicEstimates(
  levelId: string,
  totalPlanMinutes: number,
  constants: EffortConstants = DEFAULT_EFFORT_CONSTANTS,
): Promise<TopicEstimate[]> {
  const topics = await db.topic.findMany({ where: { levelId } });
  const estimates: TopicEstimate[] = [];

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

    // For each reading, estimate effort from its linked resources
    for (const reading of readings) {
      const unitReadings = await db.packageUnitReading.findMany({
        where: { readingId: reading.id },
        include: { unit: { include: { resources: true } } },
      });

      const resourceInputs: ResourceInput[] = [];
      for (const ur of unitReadings) {
        for (const res of ur.unit.resources) {
          const input: ResourceInput = { kind: res.kind };

          if (res.kind === "lecture") {
            if (res.pageCount) input.notesPages = res.pageCount;
            if (res.durationSeconds)
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
        }
      }

      // Weight-implied cap for this reading is its share of the topic cap
      const readingCap = topicCap / Math.max(1, readings.length);

      const est = estimateModule(
        {
          ref: reading.id,
          resources: resourceInputs,
          weightImpliedMinutes: readingCap,
        },
        constants,
      );

      totalTopicMinutes += est.total;
      noteMinutes += est.byKind["lecture"] ?? 0;
      noteMinutes += est.byKind["notes"] ?? 0;
      reviewMinutes += est.byKind["review"] ?? 0;
      questionMinutes += est.byKind["question_set"] ?? 0;
      questionMinutes += est.byKind["answer_set"] ?? 0;
      otherMinutes += est.byKind["eocq"] ?? 0;
      otherMinutes += est.byKind["seminar"] ?? 0;
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
  }

  return estimates;
}

/**
 * Main function: generate a 14-day horizon of tasks for a plan.
 * Freezes yesterday's tasks, regenerates the unfrozen window (preserving logEntryId rows),
 * and writes new PlanTask rows.
 */
export async function generateHorizon(
  planId: string,
  today: string,
): Promise<{ created: number; frozen: number; kept: number }> {
  const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });

  const todayDate = new Date(today + "T00:00:00Z");
  const horizonEnd = new Date(todayDate);
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + HORIZON_DAYS - 1);

  // Derive calibration factor from completed tasks
  const completedTasks = await db.planTask.findMany({
    where: { planId, status: "done" },
    orderBy: { date: "asc" },
    select: { estimatedMinutes: true, actualMinutes: true },
  });

  deriveFactorTree(completedTasks);

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
  const topicEstimates = await buildTopicEstimates(
    plan.levelId,
    totalPlanMinutes,
  );
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

    packable.push({
      ...group,
      noteMinutes: Math.max(0, budget.noteMinutes / readingCountForTopic),
      videoMinutes: Math.max(0, budget.reviewMinutes / readingCountForTopic),
      eocqMinutes: Math.max(0, budget.otherMinutes / readingCountForTopic),
      questionMinutes: Math.max(0, budget.questionMinutes / readingCountForTopic),
      vignetteCount: 0,
      calculationShare: 0.5,
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

  // Freeze tasks before today
  let frozenCount = 0;
  const tasksBeforeToday = await db.planTask.findMany({
    where: {
      planId,
      date: { lt: todayDate },
    },
  });

  for (const task of tasksBeforeToday) {
    if (!task.frozen) {
      await db.planTask.update({
        where: { id: task.id },
        data: { frozen: true },
      });
      frozenCount++;
    }
  }

  // Get existing tasks in window for comparison
  const tasksInWindow = await db.planTask.findMany({
    where: {
      planId,
      date: { gte: todayDate, lte: horizonEnd },
      frozen: false,
    },
  });

  // Build set of (date, order) tuples that are in the new plan
  const newPlanSlots = new Set<string>();
  for (const day of plannedDays) {
    const dayDate = new Date(day.date + "T00:00:00Z");
    for (let order = 0; order < day.tasks.length; order++) {
      const key = `${dayDate.getTime()}|${order}`;
      newPlanSlots.add(key);
    }
  }

  // Delete tasks that are NOT in the new plan and have no logEntryId
  // (tasks with logEntryId are preserved)
  let deletedCount = 0;
  for (const task of tasksInWindow) {
    const key = `${task.date.getTime()}|${task.order}`;
    if (!newPlanSlots.has(key) && !task.logEntryId) {
      await db.planTask.delete({ where: { id: task.id } });
      deletedCount++;
    }
  }

  // Write new tasks
  let createdCount = 0;
  for (const day of plannedDays) {
    const dayDate = new Date(day.date + "T00:00:00Z");

    for (let order = 0; order < day.tasks.length; order++) {
      const plannedTask = day.tasks[order];

      const key = `${dayDate.getTime()}|${order}`;
      const existingInWindow = tasksInWindow.find(
        (t) => `${t.date.getTime()}|${t.order}` === key,
      );

      // If task already exists at this slot, skip (it's stable)
      if (existingInWindow) {
        continue;
      }

      await db.planTask.create({
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

  // Count kept tasks: ones that exist in the window and match the new plan
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
  };
}
