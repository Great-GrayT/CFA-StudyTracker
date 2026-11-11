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

// Generate all task kinds for a module
function generateModuleTasks(
  group: SchedulableGroup & { [key: string]: any }, // Allow access to additional properties
  moduleIndex: number
): UnscheduledTask[] {
  let tasks: UnscheduledTask[] = [];
  const kinds = ["content-notes", "content-video", "eocq", "questions"];

  // Use provided minutes or distribute equally
  const noteMinutes = group.noteMinutes ?? Math.round(group.estimatedMinutes / 4);
  const videoMinutes = group.videoMinutes ?? Math.round(group.estimatedMinutes / 4);
  const eocqMinutes = group.eocqMinutes ?? Math.round(group.estimatedMinutes / 4);
  const questionMinutes = group.questionMinutes ?? Math.round(group.estimatedMinutes / 4);

  const minutesByKind = {
    "content-notes": noteMinutes,
    "content-video": videoMinutes,
    "eocq": eocqMinutes,
    "questions": questionMinutes,
  };

  // Generate vignette boundaries for questions
  const vignetteCount = group.vignetteCount ?? 1;

  for (const kind of kinds) {
    const isLastKind = kind === "questions";
    const minutes = minutesByKind[kind as keyof typeof minutesByKind];

    if (kind === "questions") {
      // For questions, create task with vignette range
      const vigFrom = 0;
      const vigTo = vignetteCount - 1;
      tasks.push({
        kind,
        resourceId: undefined,
        readingIds: group.readingRefs,
        estimatedMinutes: minutes,
        requiresConfidence: isLastKind,
        mode: group.calculationShare !== undefined && group.calculationShare >= 0.35 ? "timed-drill" : "untimed-review",
        vignetteFrom: vigFrom,
        vignetteTo: vigTo,
        moduleRef: group.ref,
        isLastInModule: isLastKind,
      });
    } else {
      tasks.push({
        kind,
        resourceId: undefined,
        readingIds: group.readingRefs,
        estimatedMinutes: minutes,
        requiresConfidence: isLastKind,
        moduleRef: group.ref,
        isLastInModule: isLastKind,
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
      lastTask.requiresConfidence = task.requiresConfidence; // Update if last task changed
      lastTask.isLastInModule = task.isLastInModule;
    } else {
      result.push(task);
    }
  }

  return result;
}

// Split a task into parts
function splitTask(task: UnscheduledTask, maxMinutes: number): { head: UnscheduledTask; tail: UnscheduledTask } {
  const headMinutes = Math.max(MIN_TASK_MINUTES, maxMinutes);

  if (task.kind === "questions") {
    // Split questions at vignette boundaries
    const vigFrom = task.vignetteFrom ?? 0;
    const vigTo = task.vignetteTo ?? 0;
    const totalVignettes = vigTo - vigFrom + 1;
    const vignettesPerPart = Math.max(1, Math.floor(totalVignettes * (headMinutes / task.estimatedMinutes)));

    const headVigTo = Math.min(vigFrom + vignettesPerPart - 1, vigTo);
    const headTask: UnscheduledTask = {
      ...task,
      estimatedMinutes: headMinutes,
      vignetteFrom: vigFrom,
      vignetteTo: headVigTo,
      splitOf: task.splitOf ?? task.moduleRef,
    };

    const tailTask: UnscheduledTask = {
      ...task,
      estimatedMinutes: task.estimatedMinutes - headMinutes,
      vignetteFrom: headVigTo + 1,
      vignetteTo: vigTo,
      splitOf: task.splitOf ?? task.moduleRef,
    };

    return { head: headTask, tail: tailTask };
  } else {
    // For other tasks, split at any boundary
    const headTask: UnscheduledTask = {
      ...task,
      estimatedMinutes: headMinutes,
      splitOf: task.splitOf ?? task.moduleRef,
    };

    const tailTask: UnscheduledTask = {
      ...task,
      estimatedMinutes: task.estimatedMinutes - headMinutes,
      splitOf: task.splitOf ?? task.moduleRef,
    };

    return { head: headTask, tail: tailTask };
  }
}

// Ensure split counts are set and indices are sequential
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

  // Assign splitIndex and splitCount based on actual order
  for (const [key, group] of splitGroups.entries()) {
    for (let i = 0; i < group.length; i++) {
      group[i].splitIndex = i + 1;
      group[i].splitCount = group.length;
    }
  }

  return tasks;
}

export function packDays(
  seq: SchedulableGroup[],
  cal: Calendar,
  opts: PackOptions
): PlannedDay[] {
  // Generate all tasks for all modules
  const allTasks: UnscheduledTask[] = [];
  for (let i = 0; i < seq.length; i++) {
    const moduleTasks = generateModuleTasks(seq[i], i);
    allTasks.push(...moduleTasks);
  }

  // Create day queue
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
      // Holiday: add empty day
      days.push({ date: dateStr, taskIndices: [] });
    } else {
      // Fill the day with tasks
      const dayTaskIndices: number[] = [];
      let usedMinutes = 0;

      while (taskIndex < allTasks.length && usedMinutes < availableMinutes) {
        const task = allTasks[taskIndex];
        const remainingCapacity = availableMinutes - usedMinutes;

        if (task.estimatedMinutes <= remainingCapacity) {
          // Task fits
          allDayTasks.push(task);
          dayTaskIndices.push(allDayTasks.length - 1);
          usedMinutes += task.estimatedMinutes;
          taskIndex++;
        } else if (remainingCapacity >= MIN_TASK_MINUTES) {
          // Try to split
          const { head, tail } = splitTask(task, remainingCapacity);
          allDayTasks.push(head);
          dayTaskIndices.push(allDayTasks.length - 1);
          usedMinutes += head.estimatedMinutes;
          allTasks[taskIndex] = tail;
        } else {
          // Can't fit, move to next day
          break;
        }
      }

      days.push({ date: dateStr, taskIndices: dayTaskIndices });
    }

    currentDate = addDays(currentDate, 1);
  }

  // Finalize all splits at once
  const finalizedTasks = finalizeSplits(allDayTasks);

  // Build result with finalized tasks
  const result: PlannedDay[] = days.map((dayInfo) => ({
    date: dayInfo.date,
    tasks: dayInfo.taskIndices.map((idx) => finalizedTasks[idx] as PlannedTask),
  }));

  return result;
}
