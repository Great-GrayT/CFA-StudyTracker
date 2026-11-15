// The planner's own ranges stop here, so a larger weekday would not be schedulable.
export const MAX_HOURS = 12;

// Half-hour steps: the planner schedules in halves, so a finer value would be silently rounded later.
export function clampHours(n: number): number {
  const safe = Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(MAX_HOURS, Math.round(safe * 2) / 2));
}
