import type { PrescribedDay, PrescribedTask } from "./types";

// The study day ends at the plan's debrief, in the plan's own time zone. That
// is when the server judges the day, sends the debrief and replans from
// tomorrow, so the countdown and the not-done list both key off it.

const DEFAULT_DEBRIEF = "22:30";
const MISSED_DAYS = 7;

export type CoachScheduleTimes = { prescription: string; nudge: string; debrief: string };

export function debriefTime(schedule: CoachScheduleTimes | null | undefined): string {
  return schedule?.debrief ?? DEFAULT_DEBRIEF;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** The days whose unfinished tasks are shown: the week before today, plus
 * today itself once it has closed. Older misses are already back in the plan. */
export function missedWindow(todayISO: string, closed: boolean): { from: string; to: string } {
  return { from: addDays(todayISO, -MISSED_DAYS), to: closed ? todayISO : addDays(todayISO, -1) };
}

export function missedTasks(
  days: PrescribedDay[],
  todayISO: string,
  closed: boolean,
): { date: string; task: PrescribedTask }[] {
  const { from, to } = missedWindow(todayISO, closed);
  return days
    .filter((d) => d.date >= from && d.date <= to)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .flatMap((d) =>
      d.tasks
        .filter((t) => t.status === "pending")
        .sort((a, b) => a.order - b.order)
        .map((task) => ({ date: d.date, task })),
    );
}

/** One request for both the week strip and the missed window, so the page
 * loads them together instead of one section arriving after the other. */
export function fetchRange(
  todayISO: string,
  weekStart: string,
  weekEnd: string,
): { from: string; to: string } {
  const missedFrom = missedWindow(todayISO, true).from;
  return { from: missedFrom < weekStart ? missedFrom : weekStart, to: weekEnd };
}

/** Milliseconds since local midnight of `ms` in `timeZone`. */
function wallMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000 + (ms % 1000);
}

/** Milliseconds until the debrief today, in `timeZone`. Negative once passed.
 * Exact on clock-change days: the wall-clock difference is a first guess,
 * corrected by however far the zone's offset moved before the target. */
export function msUntilDayEnd(nowMs: number, timeZone: string, debrief: string): number {
  const [dh, dm] = debrief.split(":").map(Number);
  const target = (dh! * 60 + dm!) * 60 * 1000;
  const guess = target - wallMs(nowMs, timeZone);
  const drift = target - wallMs(nowMs + guess, timeZone);
  // A real offset change moves the target by an hour at most; anything larger
  // means the guess wrapped past midnight, so the guess stands.
  return Math.abs(drift) <= 2 * 60 * 60 * 1000 ? guess + drift : guess;
}
