// Submitting one task from the day view: finished, partly done, or undone.
//
// Before this route nothing ever moved a task off "pending", so a candidate
// could study all day and the plan would still owe every minute of it.
import { db } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/FUNC-auth";
import { generateHorizon } from "../../../../../../lib/FUNC-schedule";
import { submitTaskSchema } from "../../../../../../lib/validation";

function idsFromUrl(req: Request): { planId: string; taskId: string } {
  const segments = new URL(req.url).pathname.split("/");
  return { planId: segments[3]!, taskId: segments[5]! }; // /api/plans/<id>/tasks/<taskId>
}

function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { planId, taskId } = idsFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const task = await db.planTask.findUnique({ where: { id: taskId } });
  if (!task || task.planId !== planId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = submitTaskSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body", issues: parsed.error.issues }, { status: 400 });
  }

  // Earlier days stay submittable: people log yesterday's session this morning.
  const today = todayIn(plan.timeZone ?? "UTC");
  if (task.date.toISOString().slice(0, 10) > today) {
    return Response.json({ error: "A task cannot be submitted before its day" }, { status: 400 });
  }

  const { status, actualMinutes } = parsed.data;
  const updated = await db.planTask.update({
    where: { id: taskId },
    data:
      status === "pending"
        ? { status, actualMinutes: null }
        : { status, actualMinutes: actualMinutes ?? task.estimatedMinutes },
  });

  // Rebuild now so a partial's remainder, or work finished early, reshapes the
  // coming days immediately instead of at the coach's next slot. The submission
  // is already stored, so a failed rebuild must not fail the request.
  try {
    await generateHorizon(planId, today);
  } catch (err) {
    console.error(`tasks: could not regenerate plan ${planId} after a submission`, err);
  }

  return Response.json({
    task: { id: updated.id, status: updated.status, actualMinutes: updated.actualMinutes },
  });
}
