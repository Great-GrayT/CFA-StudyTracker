import { db } from "../../../lib/db";
import { checkConfig } from "../../../lib/FUNC-config";
import { STALL_AFTER_MS, isScheduleStalled } from "../../../core/cron-schedule";

/**
 * Liveness and readiness for an operator and for a platform health check.
 *
 * Returns 503 when the deployment is misconfigured in a way that breaks a
 * user-visible feature, so a bad deploy fails its health check instead of
 * sitting there serving traffic with no coach emails and dead links in the
 * ones it does send. 200 with warnings means running but degraded.
 *
 * UNAUTHENTICATED, and that constrains what it may say. It reports variable
 * NAMES and whether each is usable, never a value, never a length, never a
 * fragment. The one exception is VAPID_SUBJECT, echoed in its error because it
 * is a public contact address by definition and the error is unactionable
 * without it. Nothing here distinguishes "wrong password" from "host
 * unreachable" either, since that would map the deployment's internals for
 * anyone who asks.
 */
export async function GET(): Promise<Response> {
  const config = checkConfig();

  let database = false;
  try {
    // Cheapest possible round trip. Proves the pool can reach Postgres and
    // authenticate, which is what a readiness probe actually needs to know.
    await db.$queryRawUnsafe("SELECT 1");
    database = true;
  } catch {
    // Deliberately not reported in detail: the reason is operator information,
    // and this endpoint has no operator to authenticate.
  }

  /**
   * Whether the curriculum has been loaded.
   *
   * This is reported because a deploy does NOT seed. The curriculum and the
   * provider catalogue are licensed text, so `prisma/seed-data/*.json` is
   * gitignored and is therefore absent from the Docker image too, and `seed.ts`
   * skips quietly when it finds no files. A fresh deploy consequently comes up
   * perfectly healthy by every other measure while being unable to generate a
   * single study task, and nothing anywhere says so.
   *
   * BOTH halves are required, and that is not belt and braces. The first
   * production deploy reported `seeded: true` on a database holding 102
   * readings and ZERO catalogue resources, because this check originally asked
   * only whether any reading existed. A curriculum with no provider catalogue
   * behind it cannot generate a single task: the scheduler builds tasks from
   * package resources, so every plan comes out empty while the flag that exists
   * to catch exactly that says everything is fine.
   *
   * Counted rather than merely probed, for the same reason. A Level row with no
   * readings under it is a half-finished seed, which is worse than none because
   * it looks loaded.
   */
  let curriculumReadings = 0;
  let catalogueResources = 0;
  if (database) {
    try {
      [curriculumReadings, catalogueResources] = await Promise.all([
        db.reading.count(),
        db.packageResource.count(),
      ]);
    } catch {
      // Table missing means migrations have not run, which the database flag
      // above cannot distinguish and which the seeded flag below reports as
      // not seeded. Either way the deploy is not ready.
    }
  }
  // Both seeds must have run. They are separate scripts and the second one is
  // easy to forget, which is precisely what happened in production.
  const seeded = curriculumReadings > 0 && catalogueResources > 0;

  /**
   * Whether the coach sweep is actually running.
   *
   * The sweep once depended on a host crontab that another project's deploy
   * overwrote; every check here stayed green while no email or push went out
   * for days. A sweep is a CronRun with no triggeredByUserId, so a candidate
   * pressing "Run now" cannot mask a dead scheduler. A process younger than
   * the threshold that has not swept yet is just starting up, not broken.
   */
  let lastSweepAt: Date | null = null;
  if (database) {
    try {
      const last = await db.cronRun.findFirst({
        where: { triggeredByUserId: null },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      });
      lastSweepAt = last?.startedAt ?? null;
    } catch {
      // Same reasoning as the curriculum counts above.
    }
  }
  // Same threshold as the watchdogs screen, so the two never disagree.
  const schedulerOk = lastSweepAt
    ? !isScheduleStalled(lastSweepAt)
    : process.uptime() * 1000 <= STALL_AFTER_MS;

  const ok = config.ok && database && seeded && schedulerOk;

  return Response.json(
    {
      ok,
      database,
      // A deploy does not seed. Until this is true the app cannot generate a
      // task, so it counts toward `ok` rather than being advisory.
      seeded,
      curriculum: { readings: curriculumReadings, catalogueResources },
      scheduler: { ok: schedulerOk, lastSweepAt: lastSweepAt?.toISOString() ?? null },
      configuration: {
        ok: config.ok,
        errors: config.errors,
        warnings: config.warnings,
      },
      features: config.features,
    },
    // 503 rather than 200-with-a-flag, so a platform that only reads the status
    // code still refuses to route traffic to a broken deploy.
    { status: ok ? 200 : 503 },
  );
}
