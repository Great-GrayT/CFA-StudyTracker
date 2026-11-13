// Pure packing engine. No DB, no HTTP, no framework.
// Takes ordered modules and a calendar, produces dated days of tasks.

import type { SchedulableGroup } from "./ordering";
import { questionsIn, splitPractice } from "./question-pace";

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
  /**
   * Minutes available per weekday, keyed mon-sun. MINUTES, not hours:
   * StudyPlan stores availability in hours and the one caller that forgot to
   * convert produced an empty horizon for every plan.
   */
  weeklyAvailability: Record<string, number>;
  startDate: string; // ISO date
  horizonDays: number;
  holidays: string[]; // ISO dates
};

export type PackOptions = Record<string, unknown>;

// Input requires per-kind minutes from effort model, not invented.
// Extends SchedulableGroup with outputs from the effort model (effort.ts -> byKind).
// seminarMinutes and reviewMinutes are optional (default 0) so existing
// callers that only ever produced the original four kinds are unaffected.
export type PackableGroup = SchedulableGroup & {
  noteMinutes: number;
  videoMinutes: number;
  eocqMinutes: number;
  questionMinutes: number;
  /** Questions in the bank behind questionMinutes, so tasks can name their count. */
  questionCount?: number;
  /** Share of questionMinutes spent answering; the rest is answer review. Default 1. */
  answeringShare?: number;
  seminarMinutes?: number;
  reviewMinutes?: number;
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

// Exported so pairing.ts holds to the same floor. A candidate handed a
// three minute task reads it as noise whichever engine produced it.
export const MIN_TASK_MINUTES = 15;

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
  const seminarMinutes = group.seminarMinutes ?? 0;
  const reviewMinutes = group.reviewMinutes ?? 0;
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

  // Seminar task: its own kind, never folded into eocq.
  if (seminarMinutes > 0) {
    tasks.push({
      kind: "seminar",
      resourceId: undefined,
      readingIds: group.readingRefs,
      estimatedMinutes: seminarMinutes,
      requiresConfidence: false,
      moduleRef: group.ref,
      isLastInModule: false,
    });
  }

  // Review task: its own kind, never folded into content-video.
  if (reviewMinutes > 0) {
    tasks.push({
      kind: "review",
      resourceId: undefined,
      readingIds: group.readingRefs,
      estimatedMinutes: reviewMinutes,
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

      const split = splitPractice(groupMinutes, group.answeringShare ?? 1);
      const questionTarget = questionsIn(groupMinutes, group.questionCount ?? 0, questionMinutes);
      tasks.push({
        kind: "questions",
        resourceId: undefined,
        readingIds: group.readingRefs,
        estimatedMinutes: split.answering,
        questionTarget,
        requiresConfidence: isLastOfModule && split.review === 0,
        mode: calculationShare >= 0.35 ? "timed-drill" : "untimed-review",
        vignetteFrom: vigFrom,
        vignetteTo: vigTo,
        moduleRef: group.ref,
        isLastInModule: isLastOfModule && split.review === 0,
      });
      if (split.review > 0) tasks.push({
        kind: "answer-review",
        resourceId: undefined,
        readingIds: group.readingRefs,
        estimatedMinutes: split.review,
        questionTarget,
        requiresConfidence: isLastOfModule,
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

// Merge tasks under 15 minutes into the preceding task of the same module.
// A too-small FIRST task has no preceding task to merge into, so it is
// merged forward into the next task instead - otherwise a sub-15-minute
// content-notes task stands alone purely because it leads the module.
function mergeSmallTasks(tasks: UnscheduledTask[]): UnscheduledTask[] {
  if (tasks.length === 0) return tasks;

  let working = tasks;
  if (working.length > 1 && working[0].estimatedMinutes < MIN_TASK_MINUTES) {
    const [first, second, ...rest] = working;
    const merged: UnscheduledTask = {
      ...second,
      estimatedMinutes: first.estimatedMinutes + second.estimatedMinutes,
      requiresConfidence: first.requiresConfidence || second.requiresConfidence,
      isLastInModule: first.isLastInModule || second.isLastInModule,
    };
    working = [merged, ...rest];
  }

  const result: UnscheduledTask[] = [];

  for (let i = 0; i < working.length; i++) {
    const task = working[i];

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

    // How many WHOLE vignettes fit in the head capacity. Zero means not
    // even one vignette's worth fits - forcing at least one in anyway (the
    // previous bug here) produced a head bigger than the day's remaining
    // capacity and a degenerate, inverted-range, zero-minute tail. When
    // nothing fits, this task cannot be split to make progress today;
    // the caller defers the whole thing to the next day instead.
    let vignettesForHead = Math.min(totalVignettes, Math.floor(headMinutes / minutesPerVignette));
    if (vignettesForHead < 1) {
      return null;
    }

    let tailVignettes = totalVignettes - vignettesForHead;

    // Give vignettes back from head to tail until the tail also clears the
    // floor (mirrors the non-question branch below): cutting purely at head
    // capacity can leave a tail of just one short vignette group.
    while (
      tailVignettes > 0 &&
      tailVignettes * minutesPerVignette < MIN_TASK_MINUTES &&
      vignettesForHead > 1
    ) {
      vignettesForHead -= 1;
      tailVignettes += 1;
    }

    const actualHeadMinutes = vignettesForHead * minutesPerVignette;
    if (
      actualHeadMinutes < MIN_TASK_MINUTES ||
      actualHeadMinutes > headMinutes ||
      (tailVignettes > 0 && tailVignettes * minutesPerVignette < MIN_TASK_MINUTES)
    ) {
      // No split satisfies both the 15-minute floor and the day's capacity.
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
    // For other tasks, split at any boundary, but never leave a tail
    // under the 15-minute floor. A straight split (head = capacity, tail =
    // remainder) can do exactly that on an uneven divide (e.g. 100 minutes
    // against 90 of capacity leaves a 10-minute orphan tail); when it
    // would, shrink the head just enough to give the tail exactly the floor.
    let headEstimate = headMinutes;
    let tailEstimate = task.estimatedMinutes - headEstimate;

    if (tailEstimate > 0 && tailEstimate < MIN_TASK_MINUTES) {
      headEstimate = task.estimatedMinutes - MIN_TASK_MINUTES;
      tailEstimate = MIN_TASK_MINUTES;
    }

    // Cannot produce two parts that both respect the floor (mirrors the
    // question branch's null above, for the same reason).
    if (headEstimate < MIN_TASK_MINUTES || tailEstimate <= 0) {
      return null;
    }

    const headTask: UnscheduledTask = {
      ...task,
      estimatedMinutes: headEstimate,
      splitOf: task.splitOf ?? task.moduleRef,
      requiresConfidence: false,
    };

    const tailTask: UnscheduledTask = {
      ...task,
      estimatedMinutes: tailEstimate,
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
  // Time the week has going spare, carried from the days already packed.
  //
  // A weekday figure is how the candidate described an ordinary day, not a
  // ceiling the plan may never cross. Holding each day to it exactly meant an
  // hour left unused on Monday was an hour lost, while a task an hour too big
  // for Tuesday pushed every later day back. The budget that has to hold is
  // the WEEK's, so an underfilled day lends what it did not use to the days
  // after it and the total still lands where the candidate set it.
  //
  // Reset every seventh day from the start, because the promise is a weekly
  // one: a quiet week must not fund a brutal one a fortnight later.
  let carry = 0;
  let dayIndex = 0;
  // The biggest ordinary day this candidate has. Anything larger than this
  // cannot be placed by waiting, however long it waits.
  const largestDayMinutes = Math.max(
    0,
    ...Object.values(cal.weeklyAvailability),
  );

  while (currentDate <= endDate && taskIndex < allTasks.length) {
    const dateStr = toISODate(currentDate);
    const availableMinutes = getAvailableMinutes(cal, dateStr);

    if (dayIndex % 7 === 0) carry = 0;
    dayIndex++;

    if (availableMinutes === 0) {
      // A zero day is a day the candidate said they cannot study, not an
      // underfilled one, so it lends nothing.
      days.push({ date: dateStr, taskIndices: [] });
    } else {
      // Fill the day with tasks.
      const dayTaskIndices: number[] = [];
      let usedMinutes = 0;
      // Never more than double the day the candidate described. Lending is
      // meant to smooth a lumpy module across a week, not to quietly turn a
      // two hour Tuesday into a six hour one.
      const dayCapacity = Math.max(
        0,
        Math.min(availableMinutes + carry, availableMinutes * 2),
      );

      while (taskIndex < allTasks.length && usedMinutes < dayCapacity) {
        const task = allTasks[taskIndex];
        const remainingCapacity = dayCapacity - usedMinutes;

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
          } else if (
            dayTaskIndices.length === 0 &&
            task.estimatedMinutes > largestDayMinutes
          ) {
            // An indivisible task that no day in the week could hold, on a
            // day with nothing else in it. Deferring it is not patience, it
            // is a deadlock: tomorrow is no bigger, so the same task is
            // refused again every day until the horizon runs out and the
            // candidate is handed an empty fortnight. Take it here and let
            // the overshoot come out of the rest of the week.
            //
            // A task that WOULD fit a later day is still deferred, because
            // waiting a day is better than a day that runs long.
            allDayTasks.push(task);
            dayTaskIndices.push(allDayTasks.length - 1);
            usedMinutes += task.estimatedMinutes;
            taskIndex++;
            break;
          } else {
            // Cannot split (e.g., questions with large vignettes), but the
            // day already has work in it. Tomorrow starts it fresh.
            break;
          }
        } else {
          // Can't fit, move to next day.
          break;
        }
      }

      // What the week has spare after today: whatever it had spare before,
      // plus today's own allowance, less what today actually took. A day that
      // overshot makes this negative, and the days after it get less until
      // the week is square again.
      carry = carry + availableMinutes - usedMinutes;

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
