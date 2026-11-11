/**
 * The tick's schedule, mirrored from deploy/cron-schedule.
 *
 * A crontab on the host is not introspectable over HTTP, so the watchdogs
 * screen cannot ask the scheduler when it will next fire. Rather than have the
 * browser parse a cron expression, the server computes the next occurrence and
 * reports both. The expression is shown to the user as the authoritative
 * source, with the computed time as the convenience.
 *
 * Kept deliberately narrow: this understands the one expression this app
 * actually uses (a fixed interval of whole minutes), not cron in general. A
 * general parser would be more code and more ways to be wrong about a value
 * that is a constant in practice.
 *
 * It ran at 03:00 UTC once a day until this was corrected. That is wrong for
 * what the tick actually does: only the ProgressSnapshot half is a daily job,
 * while the study coach has three delivery slots in each candidate's own
 * local time (06:30, 20:00, 22:30) across every time zone. One nightly run
 * could not hit them, so a candidate's morning prescription arrived whenever
 * 03:00 UTC happened to fall in their day, if at all.
 */

/** Minutes between ticks. Must match deploy/cron-schedule. */
const INTERVAL_MINUTES = 15;

export const CRON_SCHEDULE = `*/${INTERVAL_MINUTES} * * * *`;

/** The next time the tick is due, strictly after `from`. */
export function nextRunAt(from: Date = new Date()): Date {
  const next = new Date(from.getTime());
  next.setUTCSeconds(0, 0);
  // Strictly after, so calling this exactly on a boundary returns the next
  // slot rather than a time that has already passed.
  const minutesPast = next.getUTCMinutes() % INTERVAL_MINUTES;
  next.setUTCMinutes(next.getUTCMinutes() - minutesPast + INTERVAL_MINUTES);
  return next;
}

/**
 * How long without a run before the scheduler is treated as stopped rather
 * than merely idle.
 *
 * Eight missed windows. Two was the right threshold at one run a night; at
 * one every fifteen minutes it would raise an alarm over a single slow run or
 * a server reboot. Two hours is long enough that nothing routine trips it and
 * short enough that a genuinely dead scheduler is reported the same morning.
 */
const STALL_AFTER_MS = 8 * INTERVAL_MINUTES * 60 * 1000;

/**
 * True when the scheduler looks stopped rather than merely idle.
 *
 * The distinction matters on the watchdogs screen: a long gap is a broken
 * scheduler, while a few minutes since the last run is normal.
 */
export function isScheduleStalled(lastRunAt: Date | null, now: Date = new Date()): boolean {
  if (!lastRunAt) return false;
  return now.getTime() - lastRunAt.getTime() > STALL_AFTER_MS;
}
