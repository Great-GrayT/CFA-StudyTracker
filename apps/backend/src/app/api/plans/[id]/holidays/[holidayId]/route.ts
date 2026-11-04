import { db } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/FUNC-auth";

function idsFromUrl(req: Request): { planId: string; holidayId: string } {
  const segments = new URL(req.url).pathname.split("/");
  return { planId: segments[3]!, holidayId: segments[5]! }; // /api/plans/<id>/holidays/<holidayId>
}

export async function DELETE(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId, holidayId } = idsFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // deleteMany on the compound (id, planId) filter is naturally idempotent:
  // zero matching rows (already deleted, or belongs to a different plan) is
  // not an error, it just deletes nothing.
  await db.planHoliday.deleteMany({ where: { id: holidayId, planId } });

  return Response.json({ ok: true }, { status: 200 });
}
