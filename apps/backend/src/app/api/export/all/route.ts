import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";

// Full dump, no pagination, per spec - the caller downloads this once to
// back up or move their account, not to page through it.
export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [plans, packages, logs] = await Promise.all([
    db.studyPlan.findMany({ where: { userId: auth.userId } }),
    // Only the user's own custom packages, not the shared presets
    // (userId: null) - those aren't the user's data to export.
    db.studyPackage.findMany({ where: { userId: auth.userId } }),
    db.studyLogEntry.findMany({ where: { userId: auth.userId } }),
  ]);

  return Response.json({ plans, packages, logs }, { status: 200 });
}
