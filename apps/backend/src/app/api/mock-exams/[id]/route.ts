import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";
import { generateHorizon } from "../../../../lib/FUNC-schedule";
import { todayIn } from "../../../../lib/FUNC-today";
import { updateMockExamSchema } from "../../../../lib/validation";

function idFromUrl(req: Request): string {
  const segments = new URL(req.url).pathname.split("/");
  return segments[3]!; // /api/mock-exams/<id>
}

export async function DELETE(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = idFromUrl(req);
  const mockExam = await db.mockExam.findUnique({ where: { id } });
  if (!mockExam || mockExam.userId !== auth.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await db.mockExam.delete({ where: { id } });

  // The session returns to the pool and any retest it caused goes away; show it now.
  try {
    const plan = await db.studyPlan.findUnique({ where: { id: mockExam.planId }, select: { timeZone: true } });
    await generateHorizon(mockExam.planId, todayIn(plan?.timeZone));
  } catch (err) {
    console.error(`mock-exams DELETE: could not replan plan ${mockExam.planId}`, err);
  }

  return Response.json({ ok: true }, { status: 200 });
}

export async function PATCH(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = idFromUrl(req);
  const mockExam = await db.mockExam.findUnique({ where: { id } });
  if (!mockExam || mockExam.userId !== auth.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = updateMockExamSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body", issues: parsed.error.issues }, { status: 400 });
  }
  const { date, topicScores } = parsed.data;
  let scorePercent = parsed.data.scorePercent;

  const plan = await db.studyPlan.findUnique({ where: { id: mockExam.planId } });
  if (topicScores) {
    if (new Set(topicScores.map((t) => t.topicId)).size !== topicScores.length) {
      return Response.json({ error: "A topic appears twice" }, { status: 400 });
    }
    const owned = await db.topic.count({
      where: { levelId: plan?.levelId, id: { in: topicScores.map((t) => t.topicId) } },
    });
    if (owned !== topicScores.length) {
      return Response.json({ error: "A topic does not belong to this plan's level" }, { status: 400 });
    }
    // Upsert per topic: an edit sends only the changed row, the others stay as recorded.
    const existing = await db.mockTopicScore.findMany({ where: { mockExamId: id } });
    const merged = new Map(existing.map((t) => [t.topicId, { answered: t.answered, correct: t.correct }]));
    for (const t of topicScores) merged.set(t.topicId, { answered: t.answered, correct: t.correct });
    const answered = [...merged.values()].reduce((a, t) => a + t.answered, 0);
    const correct = [...merged.values()].reduce((a, t) => a + t.correct, 0);
    if (merged.size > 0) {
      if (answered <= 0) return Response.json({ error: "No questions answered" }, { status: 400 });
      const derived = Math.round((correct / answered) * 100);
      // One point of slack, as on create: a client rounds its own percentage.
      if (scorePercent !== undefined && Math.abs(scorePercent - derived) > 1) {
        return Response.json({ error: "The score does not match the topic scores" }, { status: 400 });
      }
      scorePercent ??= derived;
    }
  }

  const updated = await db.$transaction(async (tx) => {
    if (topicScores) {
      for (const t of topicScores) {
        await tx.mockTopicScore.upsert({
          where: { mockExamId_topicId: { mockExamId: id, topicId: t.topicId } },
          create: { ...t, mockExamId: id }, update: { answered: t.answered, correct: t.correct },
        });
      }
    }
    return tx.mockExam.update({
      where: { id },
      data: { ...(date ? { date } : {}), ...(scorePercent !== undefined ? { scorePercent } : {}) },
      include: { topicScores: true },
    });
  });

  try {
    await generateHorizon(mockExam.planId, todayIn(plan?.timeZone));
  } catch (err) {
    console.error(`mock-exams PATCH: could not replan plan ${mockExam.planId}`, err);
  }
  return Response.json(updated, { status: 200 });
}
