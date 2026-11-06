import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";

// Full dump, no pagination, per spec - the caller downloads this once to
// back up or move their account, not to page through it.
export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [plans, packages, logs, mockExams] = await Promise.all([
    db.studyPlan.findMany({ where: { userId: auth.userId } }),
    // Only the user's own custom packages, not the shared presets
    // (userId: null) - those aren't the user's data to export.
    db.studyPackage.findMany({ where: { userId: auth.userId } }),
    db.studyLogEntry.findMany({ where: { userId: auth.userId } }),
    db.mockExam.findMany({ where: { userId: auth.userId } }),
  ]);

  // PlanHoliday and PlanPackage carry no userId of their own (see
  // schema.prisma) - they're scoped to the plans fetched above, same
  // ownership boundary, one level removed.
  const planIds = plans.map((p) => p.id);
  const [holidays, planPackages] = await Promise.all([
    db.planHoliday.findMany({ where: { planId: { in: planIds } } }),
    db.planPackage.findMany({ where: { planId: { in: planIds } } }),
  ]);

  return Response.json({ plans, packages, logs, mockExams, holidays, planPackages }, { status: 200 });
}
