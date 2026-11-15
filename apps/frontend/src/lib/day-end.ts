// The study day ends at the plan's debrief, in the plan's own time zone. That
// is when the server judges the day, sends the debrief and replans from
// tomorrow, carrying unstarted work forward. The countdown keys off it.

const DEFAULT_DEBRIEF = "22:30";

export type CoachScheduleTimes = { prescription: string; nudge: string; debrief: string };

export function debriefTime(schedule: CoachScheduleTimes | null | undefined): string {
  return schedule?.debrief ?? DEFAULT_DEBRIEF;
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
