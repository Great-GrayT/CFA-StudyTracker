import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { priorWorkSchema } from "../../../../../lib/validation";
import {
  CFAI,
  declaredRows,
  ensureCfaiPackage,
  priorWorkSources,
  unknownSource,
} from "../../../../../lib/FUNC-prior-work";
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

  // Every declared topic must exist in this plan's level, and a module row
  // must sit inside its topic. Unknown ids are a 400 rather than a skip:
  // silently dropping one would leave the candidate believing they had
  // recorded work they had not.
  const topics = await db.topic.findMany({
    where: { levelId: plan.levelId, id: { in: declarations.map((d) => d.topicId) } },
    include: { readings: { include: { los: { select: { id: true } } } } },
  });
  if (topics.length !== new Set(declarations.map((d) => d.topicId)).size) {
    return Response.json(
      { error: "One or more topics do not belong to this plan's level" },
      { status: 400 },
    );
  }
  const byTopicId = new Map(topics.map((t) => [t.id, t]));
  const strayModule = declarations.find(
    (d) => d.readingId && !byTopicId.get(d.topicId)!.readings.some((r) => r.id === d.readingId),
  );
  if (strayModule) {
    return Response.json({ error: "A module does not belong to its topic" }, { status: 400 });
  }

  const sources = await priorWorkSources(plan.levelId, auth.userId);
  const unknown = unknownSource(declarations, sources);
  if (unknown) {
    return Response.json({ error: `Unknown source: ${unknown}` }, { status: 400 });
  }
  if (declarations.some((d) => [d.notesFrom, d.videosFrom, d.questions?.from].includes(CFAI.id))) {
    await ensureCfaiPackage();
  }

  // Dated now rather than backdated to whenever the study happened, which the
  // candidate was not asked and would not reliably remember. Freshness then
  // decays from the declaration, the conservative direction.
  const declaredAt = new Date();
  const rows = declaredRows(declarations, byTopicId).map((r) => ({
    ...r,
    userId: auth.userId,
    planId,
    selfDeclared: true,
    date: declaredAt,
  }));

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
    await tx.studyPlan.update({ where: { id: planId }, data: { priorWork: declarations } });
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

/** The sources the form may name, by kind, and the form as last submitted. */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const planId = planIdFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const sources = await priorWorkSources(plan.levelId, auth.userId);
  return Response.json({ sources, declarations: plan.priorWork ?? [] });
}
