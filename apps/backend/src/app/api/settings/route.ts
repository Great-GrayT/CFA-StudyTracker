import { db } from "../../../lib/db";
import { requireUser } from "../../../lib/FUNC-auth";

/**
 * Everything the signed-in user can manage, in one read.
 *
 * Read-only on purpose. Writes stay on the endpoints that already own them
 * (plans/:id for plan and notification preferences, auth/password, auth/2fa,
 * auth/passkeys, push/subscribe), because a second write path for the same
 * fields is two sources of truth and they drift. What was missing was not a
 * place to write but a place to SEE: a settings screen previously needed five
 * round trips and still could not tell the user whether their phone was
 * actually subscribed.
 *
 * Never returns a secret, a hash, or a push key. Booleans and counts only: the
 * screen needs to know what is switched on, never what the credentials are.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({ where: { id: auth.userId } });
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [passkeyCount, pushSubscriptions, plan] = await Promise.all([
    db.passkey.count({ where: { userId: user.id } }),
    db.pushSubscription.findMany({
      where: { userId: user.id },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    // The active plan, since every plan-scoped preference belongs to it. A user
    // between plans has none, and the screen must render rather than break.
    db.studyPlan.findFirst({
      where: { userId: user.id, isActive: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return Response.json(
    {
      account: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
        twoStepEnabled: user.totpEnabledAt !== null,
        passkeyCount,
        // An OAuth-only account has no password, so the screen must not offer
        // to change one or to use it as confirmation.
        hasPassword: user.passwordHash !== null,
      },
      // Endpoint and keys deliberately withheld: a subscription is a bearer
      // credential for sending to that device. The screen only needs to show
      // how many devices are registered and let the user revoke one by id.
      devices: pushSubscriptions.map((s) => ({ id: s.id, registeredAt: s.createdAt })),
      plan: plan
        ? {
            id: plan.id,
            levelId: plan.levelId,
            examDate: plan.examDate,
            startDate: plan.startDate,
            weeklyAvailability: plan.weeklyAvailability,
            orderingStrategy: plan.orderingStrategy,
            timeZone: plan.timeZone,
            // One per channel. Both are closed sets of "all", "debrief-only",
            // "off", and both are written through PATCH /api/plans/:id.
            emailCoach: plan.emailCoach,
            pushCoach: plan.pushCoach,
            // City-level only, and null when the user has not said or has
            // withdrawn it. Coordinates are included because the screen shows
            // the chosen place back to them; they are not sensitive beyond the
            // city the user typed.
            location:
              plan.city !== null && plan.latitude !== null && plan.longitude !== null
                ? {
                    city: plan.city,
                    countryCode: plan.countryCode,
                    latitude: plan.latitude,
                    longitude: plan.longitude,
                  }
                : null,
          }
        : null,
    },
    { status: 200 },
  );
}
