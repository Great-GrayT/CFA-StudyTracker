import { db } from "../../../lib/db";
import { requireUser } from "../../../lib/FUNC-auth";
import {
  DEFAULT_TUNING,
  PLAN_MODES,
  REVIEW_POLICIES,
  TUNING_RANGES,
  parseTuning,
} from "../../../core/tuning";
import { generateHorizon } from "../../../lib/FUNC-schedule";

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

  // The derived figures (what ratio the calendar actually supports, where the
  // injection cap currently sits, which readings were written off) exist only
  // as the output of a generation, so this asks for one without writing it.
  // A plan that cannot be projected still renders: the constants are the part
  // the candidate came here to change, and they do not depend on it.
  let planner: Record<string, unknown> | null = null;
  if (plan) {
    const parsed = parseTuning({
      ...(plan.tuning && typeof plan.tuning === "object" && !Array.isArray(plan.tuning)
        ? (plan.tuning as Record<string, unknown>)
        : {}),
      planMode: plan.planMode,
      reviewPolicy: plan.reviewPolicy,
      reviewStartDate: plan.reviewStartDate
        ? plan.reviewStartDate.toISOString().slice(0, 10)
        : null,
    });

    planner = {
      tuning: parsed.tuning,
      rejected: parsed.rejected.map((r) => ({ field: r.field, reason: r.reason })),
      ranges: TUNING_RANGES,
      defaults: DEFAULT_TUNING,
      modes: PLAN_MODES,
      policies: REVIEW_POLICIES,
      requestedQuestionMultiple: parsed.tuning.firstPassQuestionMultiple,
      effectiveQuestionMultiple: null,
      calendarTooShort: false,
      injectionCap: null,
      reviewReason: null,
      coverageProjection: null,
      writeOffs: [],
      underPractised: [],
    };

    try {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: plan.timeZone ?? "UTC",
      }).format(new Date());
      const projection = await generateHorizon(plan.id, today, { dryRun: true });
      planner.requestedQuestionMultiple = projection.requestedQuestionMultiple;
      planner.effectiveQuestionMultiple = projection.effectiveQuestionMultiple;
      planner.calendarTooShort = projection.calendarTooShort;
      planner.injectionCap = projection.injectionCap;
      planner.reviewReason = projection.reviewReason;
      planner.coverageProjection = projection.coverageProjection;
      planner.writeOffs = projection.writeOffs;
      planner.underPractised = projection.underPractised;
    } catch (err) {
      // A plan with no catalogue attached, or a prerequisite cycle in the
      // seed, must not take the settings screen down with it. The candidate
      // came here to change a number, and they still can.
      console.error(`settings GET: could not project plan ${plan.id}`, err);
    }
  }

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
      // Everything the planner section of the screen needs, in one read: what
      // is set, what the legal range of each constant is, what the defaults
      // are so a "reset" is possible without hard-coding them in the client,
      // and the derived figures nothing else can show.
      //
      // Still read-only, as the comment at the top of this file requires. The
      // writes stay on PATCH /api/plans/:id.
      planner: planner,
    },
    { status: 200 },
  );
}
