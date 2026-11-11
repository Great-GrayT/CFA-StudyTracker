// Pure packing engine. No DB, no HTTP, no framework.
// Takes ordered modules and a calendar, produces dated days of tasks.

import type { SchedulableGroup } from "./ordering";

export type PlannedTask = {
  kind: string;
  resourceId?: string;
  readingIds: string[];
  estimatedMinutes: number;
  requiresConfidence: boolean;
  questionTarget?: number;
  vignetteFrom?: number;
  vignetteTo?: number;
  mode?: string;
  splitOf?: string;
  splitIndex?: number;
  splitCount?: number;
};

export type PlannedDay = {
  date: string;
  tasks: PlannedTask[];
};

export type Calendar = {
  weeklyAvailability: Record<string, number>;
  startDate: string; // ISO date
  horizonDays: number;
  holidays: string[]; // ISO dates
};

export type PackOptions = Record<string, unknown>;

// Input requires per-kind minutes from effort model, not invented.
// Extends SchedulableGroup with outputs from the effort model (effort.ts -> byKind).
export type PackableGroup = SchedulableGroup & {
  noteMinutes: number;
  videoMinutes: number;
  eocqMinutes: number;
  questionMinutes: number;
  vignetteCount: number;
  calculationShare: number;
};

type UnscheduledTask = PlannedTask & {
  moduleRef: string;
  isLastInModule: boolean;
};

const WEEKDAY_KEYS: Array<keyof { mon: 0; tue: 1; wed: 2; thu: 3; fri: 4; sat: 5; sun: 6 }> = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

const MIN_TASK_MINUTES = 15;

// Get ISO date string from a Date
function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Parse ISO date string to Date (UTC)
function fromISODate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00Z");
}

// Get weekday name (mon-sun) from Date
function getWeekday(d: Date): string {
  const day = d.getUTCDay();
  return WEEKDAY_KEYS[day];
}

// Add days to a Date
function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// Get available minutes for a specific date
function getAvailableMinutes(cal: Calendar, date: string): number {
  if (cal.holidays.includes(date)) {
    return 0;
  }
  const d = fromISODate(date);
  const weekday = getWeekday(d);
  return cal.weeklyAvailability[weekday] ?? 0;
}

// Generate all task kinds for a module, with questions split into vignette groups.
// Vignettes are grouped to ensure each question task is >= 15 minutes.
function generateModuleTasks(
  group: PackableGroup
): UnscheduledTask[] {
  let tasks: UnscheduledTask[] = [];

  const noteMinutes = group.noteMinutes;
  const videoMinutes = group.videoMinutes;
  const eocqMinutes = group.eocqMinutes;
  const questionMinutes = group.questionMinutes;
  const vignetteCount = group.vignetteCount;
  const calculationShare = group.calculationShare;

  // Notes task
  if (noteMinutes > 0) {
    tasks.push({
      kind: "content-notes",
      resourceId: undefined,
      readingIds: group.readingRefs,
      estimatedMinutes: noteMinutes,
      requiresConfidence: false,
      moduleRef: group.ref,
      isLastInModule: false,
    });
  }

  // Video task
  if (videoMinutes > 0) {
    tasks.push({
      kind: "content-video",
      resourceId: undefined,
      readingIds: group.readingRefs,
      estimatedMinutes: videoMinutes,
      requiresConfidence: false,
      moduleRef: group.ref,
      isLastInModule: false,
    });
  }

  // EOCQ task
  if (eocqMinutes > 0) {
    tasks.push({
      kind: "eocq",
      resourceId: undefined,
      readingIds: group.readingRefs,
      estimatedMinutes: eocqMinutes,
      requiresConfidence: false,
      moduleRef: group.ref,
      isLastInModule: false,
    });
  }

  // Question tasks: generate multiple tasks (one per vignette group) such that
  // each task covers complete vignettes and is >= 15 minutes if possible.
  if (questionMinutes > 0 && vignetteCount > 0) {
    const minutesPerVignette = questionMinutes / vignetteCount;

    // Calculate how many vignettes to group together to ensure >= 15 minutes per task.
    // If any single vignette is >= 15 min, group size is 1.
    // Otherwise, group them to meet the minimum.
    const vignettesPerGroup = Math.max(1, Math.ceil(MIN_TASK_MINUTES / minutesPerVignette));
    const groupCount = Math.ceil(vignetteCount / vignettesPerGroup);

    for (let i = 0; i < groupCount; i++) {
      const vigFrom = i * vignettesPerGroup;
      const vigTo = Math.min((i + 1) * vignettesPerGroup - 1, vignetteCount - 1);
      const groupMinutes = Math.round((vigTo - vigFrom + 1) * minutesPerVignette);
      const isLastOfModule = i === groupCount - 1;

      tasks.push({
        kind: "questions",
        resourceId: undefined,
        readingIds: group.readingRefs,
        estimatedMinutes: groupMinutes,
        requiresConfidence: isLastOfModule,
        mode: calculationShare >= 0.35 ? "timed-drill" : "untimed-review",
        vignetteFrom: vigFrom,
        vignetteTo: vigTo,
        moduleRef: group.ref,
        isLastInModule: isLastOfModule,
      });
    }
  }

  // Merge tasks < 15 minutes into preceding task of the same module
  tasks = mergeSmallTasks(tasks);

  return tasks;
}

// Merge tasks under 15 minutes into the preceding task of the same module
function mergeSmallTasks(tasks: UnscheduledTask[]): UnscheduledTask[] {
  if (tasks.length === 0) return tasks;

  const result: UnscheduledTask[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];

    if (task.estimatedMinutes < MIN_TASK_MINUTES && result.length > 0) {
      // Merge into preceding task
      const lastTask = result[result.length - 1];
      lastTask.estimatedMinutes += task.estimatedMinutes;
      // If merged task is last, transfer requiresConfidence
      if (task.requiresConfidence) {
        lastTask.requiresConfidence = true;
      }
      if (task.isLastInModule) {
        lastTask.isLastInModule = true;
      }
    } else {
      result.push(task);
    }
  }

  return result;
}

// Split a task into parts at natural boundaries.
// For questions, split at vignette boundaries (never mid-vignette).
// Returns null if the task cannot be split while respecting boundaries.
function splitTask(task: UnscheduledTask, maxMinutes: number): { head: UnscheduledTask; tail: UnscheduledTask } | null {
  const headMinutes = Math.max(MIN_TASK_MINUTES, maxMinutes);

  if (task.kind === "questions") {
    // Split questions at vignette boundaries.
    const vigFrom = task.vignetteFrom ?? 0;
    const vigTo = task.vignetteTo ?? 0;
    const totalVignettes = vigTo - vigFrom + 1;
    const minutesPerVignette = task.estimatedMinutes / totalVignettes;

    // Determine how many complete vignettes fit in the head capacity.
    const vignettesForHead = Math.max(1, Math.floor(headMinutes / minutesPerVignette));

    // Check if the head would be < 15 minutes (less than one vignette group).
    const actualHeadMinutes = vignettesForHead * minutesPerVignette;
    if (actualHeadMinutes < MIN_TASK_MINUTES && vignettesForHead < totalVignettes) {
      // Cannot split without violating the 15-minute minimum.
      return null;
    }

    // Ensure we don't exceed the vignette range.
    const headVigTo = Math.min(vigFrom + vignettesForHead - 1, vigTo);

    const headTask: UnscheduledTask = {
      ...task,
      estimatedMinutes: Math.round(actualHeadMinutes),
      vignetteFrom: vigFrom,
      vignetteTo: headVigTo,
      splitOf: task.splitOf ?? task.moduleRef,
      requiresConfidence: false, // Only last task of module has this.
    };

    const tailMinutes = task.estimatedMinutes - Math.round(actualHeadMinutes);
    const tailTask: UnscheduledTask = {
      ...task,
      estimatedMinutes: tailMinutes,
      vignetteFrom: headVigTo + 1,
      vignetteTo: vigTo,
      splitOf: task.splitOf ?? task.moduleRef,
      requiresConfidence: task.requiresConfidence, // Preserve for last task.
      isLastInModule: task.isLastInModule, // Preserve for last task.
    };

    return { head: headTask, tail: tailTask };
  } else {
    // For other tasks, split at any boundary.
    const headTask: UnscheduledTask = {
      ...task,
      estimatedMinutes: headMinutes,
      splitOf: task.splitOf ?? task.moduleRef,
      requiresConfidence: false,
    };

    const tailTask: UnscheduledTask = {
      ...task,
      estimatedMinutes: task.estimatedMinutes - headMinutes,
      splitOf: task.splitOf ?? task.moduleRef,
      requiresConfidence: task.requiresConfidence,
      isLastInModule: task.isLastInModule,
    };

    return { head: headTask, tail: tailTask };
  }
}

// Assign splitIndex and splitCount based on placement order.
function finalizeSplits(tasks: UnscheduledTask[]): UnscheduledTask[] {
  const splitGroups = new Map<string, UnscheduledTask[]>();

  for (const task of tasks) {
    if (task.splitOf) {
      if (!splitGroups.has(task.splitOf)) {
        splitGroups.set(task.splitOf, []);
      }
      splitGroups.get(task.splitOf)!.push(task);
    }
  }

  // Assign splitIndex and splitCount based on actual order.
  for (const [key, group] of splitGroups.entries()) {
    for (let i = 0; i < group.length; i++) {
      group[i].splitIndex = i + 1;
      group[i].splitCount = group.length;
    }
  }

  return tasks;
}

export function packDays(
  seq: PackableGroup[],
  cal: Calendar,
  opts: PackOptions
): PlannedDay[] {
  // Generate all tasks for all modules.
  const allTasks: UnscheduledTask[] = [];
  for (let i = 0; i < seq.length; i++) {
    const moduleTasks = generateModuleTasks(seq[i]);
    allTasks.push(...moduleTasks);
  }

  // Create day queue.
  const allDayTasks: UnscheduledTask[] = [];
  const days: Array<{ date: string; taskIndices: number[] }> = [];
  const startDate = fromISODate(cal.startDate);
  const endDate = addDays(startDate, cal.horizonDays - 1);

  let currentDate = startDate;
  let taskIndex = 0;

  while (currentDate <= endDate && taskIndex < allTasks.length) {
    const dateStr = toISODate(currentDate);
    const availableMinutes = getAvailableMinutes(cal, dateStr);

    if (availableMinutes === 0) {
      // Holiday: add empty day.
      days.push({ date: dateStr, taskIndices: [] });
    } else {
      // Fill the day with tasks.
      const dayTaskIndices: number[] = [];
      let usedMinutes = 0;

      while (taskIndex < allTasks.length && usedMinutes < availableMinutes) {
        const task = allTasks[taskIndex];
        const remainingCapacity = availableMinutes - usedMinutes;

        if (task.estimatedMinutes <= remainingCapacity) {
          // Task fits.
          allDayTasks.push(task);
          dayTaskIndices.push(allDayTasks.length - 1);
          usedMinutes += task.estimatedMinutes;
          taskIndex++;
        } else if (remainingCapacity >= MIN_TASK_MINUTES) {
          // Try to split.
          const split = splitTask(task, remainingCapacity);
          if (split) {
            const { head, tail } = split;
            allDayTasks.push(head);
            dayTaskIndices.push(allDayTasks.length - 1);
            usedMinutes += head.estimatedMinutes;
            allTasks[taskIndex] = tail;
          } else {
            // Cannot split (e.g., questions with large vignettes).
            break;
          }
        } else {
          // Can't fit, move to next day.
          break;
        }
      }

      days.push({ date: dateStr, taskIndices: dayTaskIndices });
    }

    currentDate = addDays(currentDate, 1);
  }

  // Finalize all splits at once.
  const finalizedTasks = finalizeSplits(allDayTasks);

  // Build result with finalized tasks.
  const result: PlannedDay[] = days.map((dayInfo) => ({
    date: dayInfo.date,
    tasks: dayInfo.taskIndices.map((idx) => finalizedTasks[idx] as PlannedTask),
  }));

  return result;
}
