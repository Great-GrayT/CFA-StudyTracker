import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { getProjection } from "../../../../../lib/FUNC-projection";

// Handlers are called directly in tests, so the id comes from the path.
function planIdFromUrl(req: Request): string {
  return new URL(req.url).pathname.split("/")[3]!; // /api/plans/<id>/projection
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const planId = planIdFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: plan.timeZone ?? "UTC" }).format(new Date());
  return Response.json(await getProjection(planId, today));
}
