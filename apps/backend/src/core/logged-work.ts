/**
 * Splits what a candidate actually studied today against what the plan asked
 * for. Pure: no DB, no clock.
 *
 * This exists because of the worst bug the coach has had. It decided whether
 * anybody had worked by counting TASKS TICKED, so two entirely different
 * candidates both came out as having done nothing:
 *
 *   one who studied for two hours on a topic the plan did not ask for, and
 *   one who studied exactly the prescribed topic but never ticked the box.
 *
 * Both were then shamed for idleness, and both were sent an evening nudge
 * insisting nothing was logged while they were mid-session. A coach that calls
 * a working candidate idle loses the relationship in one message, and no amount
 * of good copy elsewhere wins it back.
 *
 * The log entry is the evidence. The tick box is a UI detail.
 */

export type WorkSplit = {
  /** Log entries on a reading that is on today's list. */
  onPlan: number;
  /** Log entries on a reading that is not. */
  offPlan: number;
};

/**
 * Compares the readings studied against the readings planned.
 *
 * Both arguments are per-log-entry and per-task reading ids rather than sets,
 * because the counts matter: three entries against one planned reading is three
 * pieces of logged work, not one.
 */
export function splitLoggedWork(
  studiedReadingIds: string[],
  plannedReadingIds: string[]
): WorkSplit {
  const planned = new Set(plannedReadingIds);

  let onPlan = 0;
  let offPlan = 0;
  for (const readingId of studiedReadingIds) {
    if (planned.has(readingId)) {
      onPlan += 1;
    } else {
      offPlan += 1;
    }
  }

  return { onPlan, offPlan };
}
