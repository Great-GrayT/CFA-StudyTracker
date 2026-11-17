import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";
import { generateHorizon } from "../../../../lib/FUNC-schedule";
import { todayIn } from "../../../../lib/FUNC-today";

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
