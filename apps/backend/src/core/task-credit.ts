/**
 * How much of a unit's debt a submitted task settles, and whether its minutes
 * may teach the pace model. Pure: no DB, no clock.
 *
 * Debt is MATERIAL denominated in minutes, so a finished task settles its whole
 * estimate regardless of time spent: going slowly is not covering more ground.
 * A partial is the one case where the candidate's minutes are the only measure
 * of how much material they got through, so it settles those, never more than
 * the estimate.
 */

export type SubmittedTask = {
  status: string;
  estimatedMinutes: number;
  actualMinutes: number | null;
};

export function creditedMinutes(task: SubmittedTask): number {
  if (task.status === "done") return Math.max(0, task.estimatedMinutes);
  if (task.status === "partial") {
    return Math.max(0, Math.min(task.actualMinutes ?? 0, task.estimatedMinutes));
  }
  return 0;
}

/** A partial's minutes cover an unknown share of the task, so its ratio to the estimate is not pace. */
export function countsForCalibration(task: SubmittedTask): boolean {
  return task.status === "done" && task.actualMinutes !== null;
}
