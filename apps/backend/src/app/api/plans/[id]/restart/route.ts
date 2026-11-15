import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";

// Handlers are called directly in tests, so the id comes from the path.
function planIdFromUrl(req: Request): string {
  return new URL(req.url).pathname.split("/")[3]!; // /api/plans/<id>/restart
}

/**
 * Starts over as a new user would: the plan is retired, not deleted, so a
 * misclick costs a fresh setup rather than months of history. With no active
 * plan, GET /api/plans answers 404 and the app sends the candidate to
 * onboarding. Packages belong to the user and carry over.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const planId = planIdFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.studyPlan.update({ where: { id: planId }, data: { isActive: false } });
  return new Response(null, { status: 204 });
}
