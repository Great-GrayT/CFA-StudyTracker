// Recording one task from the day view: finished, partly done, or undone.
//
// Before this route nothing ever moved a task off "pending", so a candidate
// could study all day and the plan would still owe every minute of it.
import { db } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/FUNC-auth";
import { generateHorizon } from "../../../../../../lib/FUNC-schedule";
import { submitTaskSchema } from "../../../../../../lib/validation";
import { recordTask } from "../../../../../../lib/FUNC-record";
import { OFF_PLAN } from "../../../../../../core/task-credit";

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

  const { date, packageId, ...record } = parsed.data;
  if ((date !== undefined || packageId !== undefined) && record.status === "pending") {
    return Response.json({ error: "Date and package apply to recorded tasks only" }, { status: 400 });
  }
  if (date !== undefined && date > today) {
    return Response.json({ error: "A task cannot be moved after today" }, { status: 400 });
  }
  if (packageId !== undefined && !(await db.planPackage.findFirst({ where: { planId, packageId } }))) {
    return Response.json({ error: "Not one of this plan's packages" }, { status: 400 });
  }

  const updated = await db.$transaction(async (tx) => {
    let target = task;
    const move = date !== undefined && date !== task.date.toISOString().slice(0, 10);
    if (move || packageId !== undefined) {
      const newDate = move ? new Date(`${date}T00:00:00Z`) : task.date;
      // Last on the new day: the plan's own order stays untouched and the slot is unique.
      const last = move
        ? await tx.planTask.aggregate({ where: { planId, date: newDate }, _max: { order: true } })
        : null;
      target = await tx.planTask.update({
        where: { id: task.id },
        data: {
          ...(move ? { date: newDate, order: (last?._max.order ?? -1) + 1, frozen: date! < today } : {}),
          ...(packageId !== undefined ? { packageId } : {}),
        },
      });
      // recordTask rewrites the log rows on the (new) task day.
    }
    return recordTask(tx, auth.userId, target, record);
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

/**
 * Takes a record away. An off-plan session disappears with its logs; a planned task goes back to
 * pending, the same as undoing it.
 */
export async function DELETE(req: Request): Promise<Response> {
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

  await db.$transaction(async (tx) => {
    if (task.insertedBecause === OFF_PLAN) {
      // The log relation is SetNull, so the rows would otherwise outlive the task as orphans.
      await tx.studyLogEntry.deleteMany({ where: { taskId: task.id } });
      await tx.planTask.delete({ where: { id: task.id } });
    } else {
      await recordTask(tx, auth.userId, task, { status: "pending" });
    }
  });

  try {
    await generateHorizon(planId, todayIn(plan.timeZone ?? "UTC"));
  } catch (err) {
    console.error(`tasks: could not regenerate plan ${planId} after a delete`, err);
  }
  return Response.json({ ok: true });
}
