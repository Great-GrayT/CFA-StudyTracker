import { db } from "../../../../../../../lib/db";
import { requireUser } from "../../../../../../../lib/FUNC-auth";
import { todayIn } from "../../../../../../../lib/FUNC-today";
import { generateHorizon } from "../../../../../../../lib/FUNC-schedule";

// /api/plans/<id>/declarations/<readingId>/<step>
function partsFromUrl(req: Request) {
  const s = new URL(req.url).pathname.split("/");
  return { planId: s[3]!, readingId: decodeURIComponent(s[5]!), step: Number(s[6]) };
}

/** Takes back a "did this before" self-state, then rebuilds so the work is owed again. */
export async function DELETE(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { planId, readingId, step } = partsFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!Number.isInteger(step) || step < 1 || step > 4) {
    return Response.json({ error: "Invalid step" }, { status: 400 });
  }

  // The reverse of the POST rule: a review may not outlive the step it follows.
  const dependent = step === 1 ? 3 : step === 2 ? 4 : null;
  if (dependent !== null) {
    const later = await db.stepDeclaration.count({ where: { planId, readingId, step: dependent } });
    if (later > 0) {
      return Response.json(
        { error: step === 1 ? "Remove the review first" : "Remove the review questions first" },
        { status: 400 },
      );
    }
  }

  await db.stepDeclaration.deleteMany({ where: { planId, readingId, step } });

  try {
    const today = todayIn(plan.timeZone);
    await generateHorizon(planId, today);
  } catch (err) {
    console.error(`declarations DELETE: could not replan plan ${planId}`, err);
  }
  return Response.json({ ok: true }, { status: 200 });
}
