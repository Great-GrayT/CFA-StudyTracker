// The candidate's actual instructions for a span of days: which module, which
// video, which pages, how many questions, and the link that opens them.
//
// The Today screen had no endpoint for this and fell back to printing Learning
// Outcome Statements, which name what the exam will ask rather than what to go
// and do.
import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { getPrescription } from "../../../../../lib/FUNC-prescription";
import { generateHorizon } from "../../../../../lib/FUNC-schedule";

function planIdFromUrl(req: Request): string {
  const segments = new URL(req.url).pathname.split("/");
  return segments[3]!; // /api/plans/<id>/tasks
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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

  const url = new URL(req.url);
  const today = todayIn(plan.timeZone ?? "UTC");
  const from = url.searchParams.get("from") ?? today;
  const to = url.searchParams.get("to") ?? from;

  if (!DATE.test(from) || !DATE.test(to)) {
    return Response.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });
  }
  if (from > to) {
    return Response.json({ error: "from must not be after to" }, { status: 400 });
  }

  // Generate on demand when the window is empty.
  //
  // The horizon is otherwise only ever built by the scheduled tick, so a plan
  // created between two ticks, or one whose scheduler is down, would show a
  // candidate an empty week and no way to fix it. generateHorizon is
  // idempotent and freezes everything before today, so asking for it here
  // cannot rewrite a day the candidate has already worked through.
  const existing = await db.planTask.count({
    where: {
      planId,
      date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
    },
  });
  if (existing === 0) {
    try {
      await generateHorizon(planId, today);
    } catch (err) {
      console.error(`tasks: could not generate a horizon for plan ${planId}`, err);
    }
  }

  const days = await getPrescription(planId, from, to);
  return Response.json({ planId, from, to, days });
}
