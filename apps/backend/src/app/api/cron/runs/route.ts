import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";
import { CRON_SCHEDULE, nextRunAt, isScheduleStalled } from "../../../../core/cron-schedule";

// History of the nightly tick, for the watchdogs screen.
//
// Authenticated with a user JWT, not CRON_SECRET: this is read by a signed-in
// candidate looking at their own app's health, not by the scheduler. The rows
// carry no per-user data (the tick is a global sweep), so any authenticated
// user may read them.

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = Number(new URL(req.url).searchParams.get("limit"));
  // Clamped rather than trusted: an unbounded limit turns this into a way to
  // pull the entire table in one request.
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), MAX_LIMIT) : DEFAULT_LIMIT;

  const runs = await db.cronRun.findMany({ orderBy: { startedAt: "desc" }, take: limit });
  // The stall clock reads scheduled sweeps only. A manual run used to reset
  // it, so the screen showed a healthy scheduler that had been dead for days.
  const lastSweep = await db.cronRun.findFirst({
    where: { triggeredByUserId: null },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  const lastRunAt = lastSweep?.startedAt ?? null;

  return Response.json(
    {
      schedule: CRON_SCHEDULE,
      nextRunAt: nextRunAt().toISOString(),
      lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
      stalled: isScheduleStalled(lastRunAt),
      limit,
      runs: runs.map((r) => ({
        id: r.id,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
        ok: r.ok,
        plansProcessed: r.plansProcessed,
        plansFailed: r.plansFailed,
        plansSkipped: r.plansSkipped,
        manual: r.triggeredByUserId !== null,
        error: r.error,
      })),
    },
    { status: 200 },
  );
}
