import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";
import { writeSnapshotForPlan, startOfUTCDay } from "../../../../lib/snapshot";

// A user-triggered snapshot run, for the watchdogs screen's "Run now".
//
// Scoped to the caller's own active plan, deliberately. The nightly tick is a
// global sweep authenticated with a shared secret; exposing that to any
// signed-in user would let one person trigger work across everyone's data. The
// snapshot write is an idempotent upsert on [planId, date], so a user running
// this repeatedly only rewrites their own row.
//
// It never sends a push. The missed-day notification belongs to the scheduled
// run; firing it from a button would turn "Run now" into a way to make a
// device buzz on demand.

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const plan = await db.studyPlan.findFirst({
    where: { userId: auth.userId, isActive: true },
  });
  if (!plan) {
    return Response.json({ error: "No active plan" }, { status: 404 });
  }

  const run = await db.cronRun.create({
    data: { triggeredByUserId: auth.userId },
  });

  const today = startOfUTCDay(new Date());
  try {
    const { outcome } = await writeSnapshotForPlan(plan, today);
    await db.cronRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        ok: true,
        plansProcessed: outcome === "written" ? 1 : 0,
        plansSkipped: outcome === "skipped" ? 1 : 0,
      },
    });
    return Response.json(
      {
        ok: true,
        plansProcessed: outcome === "written" ? 1 : 0,
        plansSkipped: outcome === "skipped" ? 1 : 0,
      },
      { status: 200 },
    );
  } catch (err) {
    // Recorded rather than swallowed: a manual run that fails silently leaves
    // the user staring at a gap with no explanation for it.
    console.error(`cron/run: failed for plan ${plan.id}`, err);
    await db.cronRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        ok: false,
        plansFailed: 1,
        error: err instanceof Error ? err.message.slice(0, 500) : "Unknown error",
      },
    });
    return Response.json({ error: "The run did not finish." }, { status: 500 });
  }
}
