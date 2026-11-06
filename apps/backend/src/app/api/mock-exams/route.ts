import { db } from "../../../lib/db";
import { requireUser } from "../../../lib/FUNC-auth";
import { createMockExamSchema } from "../../../lib/validation";
import { assertUsablePackage } from "../../../lib/FUNC-packages";

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createMockExamSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { planId, date, scorePercent, packageId, note } = parsed.data;

  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (packageId) {
    const packageError = await assertUsablePackage(packageId, auth.userId);
    if (packageError) return packageError;
  }

  const mockExam = await db.mockExam.create({
    data: {
      userId: auth.userId,
      planId,
      date,
      scorePercent,
      packageId,
      note,
    },
  });

  return Response.json(mockExam, { status: 201 });
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const planId = url.searchParams.get("planId");
  if (!planId) {
    return Response.json({ error: "planId query parameter is required" }, { status: 400 });
  }

  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const mockExams = await db.mockExam.findMany({
    where: { planId, userId: auth.userId },
    orderBy: { date: "asc" },
  });

  return Response.json(mockExams, { status: 200 });
}
