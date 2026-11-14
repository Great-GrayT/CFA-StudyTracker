import { startScheduler } from "./lib/FUNC-scheduler";
import { runSweep } from "./lib/FUNC-sweep";
import { SWEEP_INTERVAL_MS, nextRunAt } from "./core/cron-schedule";

export function startCoachScheduler(): void {
  // Off switch for a second replica or a local dev server pointed at a shared
  // database; a duplicate sweep is harmless but pointless.
  if (process.env.COACH_SCHEDULER === "off") return;

  startScheduler({
    run: runSweep,
    intervalMs: SWEEP_INTERVAL_MS,
    // Aligned to the quarter hour so the watchdogs screen's "next run" is the
    // real one. Waiting is never lossy: a due slot stays due until sent.
    initialDelayMs: nextRunAt().getTime() - Date.now(),
  });
  console.log("scheduler: coach sweep every 15 minutes, on the quarter hour");
}
