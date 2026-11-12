import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { priorWorkSchema } from "../../../../../lib/validation";
import { generateHorizon } from "../../../../../lib/FUNC-schedule";

// Same URL-parsing approach as the sibling routes: handlers here are called
// directly in tests, so the dynamic segment comes from the pathname rather
// than a framework-injected params argument.
function planIdFromUrl(req: Request): string {
  const segments = new URL(req.url).pathname.split("/");
  return segments[3]!; // /api/plans/<id>/prior-work
}

/**
 * What the candidate had already studied before this plan existed.
 *
 * A planner that assumes every unit starts owing its full reading and its full
 * practice is a planner for someone who has never opened the curriculum. Real
 * candidates arrive having read three topic areas on their own, and being told
 * to read them again is the fastest way to lose their trust in the schedule.
 *
 * Declared per TOPIC AREA rather than per outcome, because that is the
 * resolution at which anyone actually remembers what they have done. Nobody
 * knows how many questions they answered against learning outcome 14.c; they
 * know they have been through Quantitative Methods and got about seven in ten
 * right. Coarse input beats no input, and the engine says so in its own
 * comments where it divides a unit's stock pro rata.
 *
 * Writes StudyLogEntry rows flagged selfDeclared, so mastery treats them as
 * real evidence (they are the best evidence available about study that predates
 * the plan) while the audit trail keeps them distinguishable from work logged
 * as it happened. The coach should not congratulate anyone on a session they
 * only described.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const planId = planIdFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  // Same 403 for "does not exist" and "exists but is not yours", so a plan id
  // is never confirmed to someone who does not own it.
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = priorWorkSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const declarations = parsed.data.declarations;
  if (declarations.length === 0) {
    return Response.json({ created: 0, replaced: 0 }, { status: 201 });
  }

  // Every declared topic must exist in this plan's level. An unknown topic is
  // a 400 rather than a skip: silently dropping it would leave the candidate
  // believing they had recorded a topic area they had not.
  const topics = await db.topic.findMany({
    where: { levelId: plan.levelId, id: { in: declarations.map((d) => d.topicId) } },
    include: {
      readings: {
        include: { los: { select: { id: true } } },
      },
    },
  });
  if (topics.length !== new Set(declarations.map((d) => d.topicId)).size) {
    return Response.json(
      { error: "One or more topics do not belong to this plan's level" },
      { status: 400 },
    );
  }

  const byTopicId = new Map(topics.map((t) => [t.id, t]));
  const rows: Array<{
    userId: string;
    planId: string;
    losId: string;
    confidence: number;
    questionsAnswered: number;
    questionsCorrect: number;
    selfDeclared: boolean;
    declaredRead: boolean;
    date: Date;
  }> = [];

  // Dated now rather than backdated to whenever the study happened, which the
  // candidate was not asked and would not reliably remember. Freshness then
  // decays from the declaration, which is the conservative direction: it treats
  // half-remembered study as more recent than it was for a little while, rather
  // than writing it off before the candidate has had a chance to be tested.
  const declaredAt = new Date();

  for (const declaration of declarations) {
    const topic = byTopicId.get(declaration.topicId)!;
    const losIds = topic.readings.flatMap((r) => r.los.map((l) => l.id));
    if (losIds.length === 0) continue;

    // Spread the declared counts across the area's outcomes in equal shares,
    // the same pro-rata rule reconcile uses for question stock, so the two
    // halves of the engine agree about what a topic-level figure means. The
    // remainder goes on the first outcomes rather than being lost to rounding,
    // so the totals the candidate typed are the totals that get stored.
    const answered = declaration.questionsAnswered;
    const correct =
      declaration.accuracyPercent === null
        ? 0
        : Math.round((answered * declaration.accuracyPercent) / 100);

    const baseAnswered = Math.floor(answered / losIds.length);
    const baseCorrect = Math.floor(correct / losIds.length);
    let answeredRemainder = answered - baseAnswered * losIds.length;
    let correctRemainder = correct - baseCorrect * losIds.length;

    for (const losId of losIds) {
      const extraAnswered = answeredRemainder > 0 ? 1 : 0;
      const extraCorrect = correctRemainder > 0 ? 1 : 0;
      answeredRemainder -= extraAnswered;
      correctRemainder -= extraCorrect;

      rows.push({
        userId: auth.userId,
        planId,
        losId,
        // The midpoint of the 1 to 5 scale. The candidate rated a topic area,
        // not an outcome, and inventing a confident number from a coarse
        // answer would feed the mastery formula a precision it does not have.
        confidence: 3,
        questionsAnswered: baseAnswered + extraAnswered,
        questionsCorrect: Math.min(
          baseAnswered + extraAnswered,
          baseCorrect + extraCorrect,
        ),
        selfDeclared: true,
        declaredRead: declaration.read,
        date: declaredAt,
      });
    }
  }

  // Replace rather than accumulate. This is one statement about the past, not
  // an event log: a candidate who corrects their own answer on the onboarding
  // screen means "it was 60, not 100", never "it was 160".
  const replaced = await db.$transaction(async (tx) => {
    const deleted = await tx.studyLogEntry.deleteMany({
      where: { planId, selfDeclared: true },
    });
    if (rows.length > 0) {
      await tx.studyLogEntry.createMany({ data: rows });
    }
    return deleted.count;
  });

  // Fold it straight into the schedule, so the candidate sees the effect of
  // what they just told us rather than waiting for the nightly tick.
  try {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: plan.timeZone ?? "UTC",
    }).format(new Date());
    await generateHorizon(planId, today);
  } catch (err) {
    // The declaration is saved either way, and the next tick rebuilds the
    // horizon from it.
    console.error(`prior-work POST: could not replan plan ${planId}`, err);
  }

  return Response.json({ created: rows.length, replaced }, { status: 201 });
}
