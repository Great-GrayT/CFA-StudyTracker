/**
 * The nightly tick's schedule, mirrored from deploy/cron-schedule.
 *
 * A crontab on the host is not introspectable over HTTP, so the watchdogs
 * screen cannot ask the scheduler when it will next fire. Rather than have the
 * browser parse a cron expression, the server computes the next occurrence and
 * reports both. The expression is shown to the user as the authoritative
 * source, with the computed time as the convenience.
 *
 * Kept deliberately narrow: this understands the one expression this app
 * actually uses (a fixed daily time in UTC), not cron in general. A general
 * parser would be more code and more ways to be wrong about a value that is a
 * constant in practice.
 */

export const CRON_SCHEDULE = "0 3 * * *";
const RUN_HOUR_UTC = 3;
const RUN_MINUTE_UTC = 0;

/** The next time the nightly tick is due, strictly after `from`. */
export function nextRunAt(from: Date = new Date()): Date {
  const next = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      RUN_HOUR_UTC,
      RUN_MINUTE_UTC,
      0,
      0,
    ),
  );
  // Strictly after, so calling this exactly at 03:00 returns tomorrow rather
  // than a time that has already passed.
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/**
 * True when the scheduler looks stopped rather than merely idle.
 *
 * The distinction matters on the watchdogs screen: "no run in the last 48
 * hours" is a broken scheduler, while "no run yet today" before 03:00 is
 * normal. Two missed windows is the threshold so a single late or slow run
 * does not raise a false alarm.
 */
export function isScheduleStalled(lastRunAt: Date | null, now: Date = new Date()): boolean {
  if (!lastRunAt) return false;
  return now.getTime() - lastRunAt.getTime() > 48 * 60 * 60 * 1000;
}
