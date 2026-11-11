import { db } from "../../../lib/db";
import { checkConfig } from "../../../lib/FUNC-config";

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
   * Counted rather than merely probed: a Level row with no readings under it is
   * a half-finished seed, which is worse than none because it looks loaded.
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
  const seeded = curriculumReadings > 0;

  const ok = config.ok && database && seeded;

  return Response.json(
    {
      ok,
      database,
      // A deploy does not seed. Until this is true the app cannot generate a
      // task, so it counts toward `ok` rather than being advisory.
      seeded,
      curriculum: { readings: curriculumReadings, catalogueResources },
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
