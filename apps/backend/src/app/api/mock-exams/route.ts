import { db } from "../../../lib/db";
import { requireUser } from "../../../lib/FUNC-auth";
import { createMockExamSchema } from "../../../lib/validation";
import { assertUsablePackage } from "../../../lib/FUNC-packages";
import { generateHorizon } from "../../../lib/FUNC-schedule";

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createMockExamSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { planId, date, packageId, note, sessionRef } = parsed.data;
  const topicScores = parsed.data.topicScores ?? [];

  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (packageId) {
    const packageError = await assertUsablePackage(packageId, auth.userId);
    if (packageError) return packageError;
  }

  let scorePercent = parsed.data.scorePercent ?? 0;
  if (topicScores.length > 0) {
    if (new Set(topicScores.map((t) => t.topicId)).size !== topicScores.length) {
      return Response.json({ error: "A topic appears twice" }, { status: 400 });
    }
    const owned = await db.topic.count({
      where: { levelId: plan.levelId, id: { in: topicScores.map((t) => t.topicId) } },
    });
    if (owned !== topicScores.length) {
      return Response.json({ error: "A topic does not belong to this plan's level" }, { status: 400 });
    }
    const answered = topicScores.reduce((a, t) => a + t.answered, 0);
    const correct = topicScores.reduce((a, t) => a + t.correct, 0);
    if (answered <= 0) return Response.json({ error: "No questions answered" }, { status: 400 });
    const derived = Math.round((correct / answered) * 100);
    // One point of slack: a client rounds its own percentage from the same counts.
    if (parsed.data.scorePercent !== undefined && Math.abs(parsed.data.scorePercent - derived) > 1) {
      return Response.json({ error: "The score does not match the topic scores" }, { status: 400 });
    }
    if (parsed.data.scorePercent === undefined) scorePercent = derived;

    if (sessionRef) {
      const session = await db.packageResource.findFirst({
        where: { kind: "mock_session", ref: sessionRef, edition: { levelId: plan.levelId } },
        select: { questionCount: true },
      });
      if (session?.questionCount && session.questionCount !== answered) {
        return Response.json(
          { error: `Topic totals must equal the session's ${session.questionCount} questions` },
          { status: 400 },
        );
      }
    }
  }

  const mockExam = await db.mockExam.create({
    data: {
      userId: auth.userId,
      planId,
      date,
      scorePercent,
      packageId,
      note,
      sessionRef,
      topicScores: { create: topicScores },
    },
    include: { topicScores: true },
  });

  // Weak topics owe a retest and a done session leaves the pool; show it now.
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: plan.timeZone ?? "UTC" }).format(new Date());
    await generateHorizon(planId, today);
  } catch (err) {
    console.error(`mock-exams POST: could not replan plan ${planId}`, err);
  }

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
