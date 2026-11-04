import { db } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/FUNC-auth";

function idsFromUrl(req: Request): { planId: string; packageId: string } {
  const segments = new URL(req.url).pathname.split("/");
  return { planId: segments[3]!, packageId: segments[5]! }; // /api/plans/<id>/packages/<packageId>
}

export async function DELETE(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId, packageId } = idsFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.planPackage.deleteMany({ where: { planId, packageId } });

  return Response.json({ ok: true }, { status: 200 });
}
