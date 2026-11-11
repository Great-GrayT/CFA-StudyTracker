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

  const ok = config.ok && database;

  return Response.json(
    {
      ok,
      database,
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
