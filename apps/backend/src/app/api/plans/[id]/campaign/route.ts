// The whole run to the exam, bucketed into periods and split by study stage.
//
// The fourteen-day horizon answers "what am I doing this week". This answers
// "when does the first pass end and does the plan still fit", which nothing
// in the app could show.
//
// Read-only. projectCampaign runs the planner's own pipeline over the full
// span and writes nothing: no PlanTask rows, no transaction.
import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { projectCampaign } from "../../../../../lib/FUNC-campaign";

function planIdFromUrl(req: Request): string {
  const segments = new URL(req.url).pathname.split("/");
  return segments[3]!; // /api/plans/<id>/campaign
}

/** Today in the plan's own zone, which is the day the candidate is living in. */
function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const planId = planIdFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const raw = new URL(req.url).searchParams.get("periodDays");
  const parsed = raw === null ? 7 : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 31) {
    return Response.json(
      { error: "periodDays must be a whole number between 1 and 31" },
      { status: 400 },
    );
  }

  // The candidate's own date, not the server's. A UTC date puts the first
  // period on the wrong day for anyone west of Greenwich, and the horizon
  // endpoint already resolves today the same way, so the two agree.
  const campaign = await projectCampaign(planId, {
    periodDays: parsed,
    today: todayIn(plan.timeZone ?? "UTC"),
  });

  return Response.json(campaign);
}
