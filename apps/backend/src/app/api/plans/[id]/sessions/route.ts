import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { createSessionSchema } from "../../../../../lib/validation";
import { assertUsablePackage } from "../../../../../lib/FUNC-packages";
import { recordTask } from "../../../../../lib/FUNC-record";
import { generateHorizon } from "../../../../../lib/FUNC-schedule";
import { OFF_PLAN } from "../../../../../core/task-credit";
import { localDateFor } from "../../../../../core/slots";

// Handlers are called directly in tests, so the id comes from the path.
function planIdFromUrl(req: Request): string {
  return new URL(req.url).pathname.split("/")[3]!; // /api/plans/<id>/sessions
}

// Planned slots are numbered from 0 per day; off-plan cells sit above them so
// a rebuild that grows a day can never collide with one.
const OFF_PLAN_ORDER_BASE = 100;

/**
 * Records a study session shaped like a plan cell.
 *
 * Against a planned cell (taskId) it settles that cell, the same act as the
 * cell's own Record button. Otherwise it writes a finished off-plan cell, so
 * the engine credits it by kind exactly as it credits planned work, and the
 * day view shows it as a cell. Either way the outcome logs come from
 * recordTask, so mastery and the coach see one shape of evidence.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const planId = planIdFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createSessionSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid request body" }, { status: 400 });
  const input = parsed.data;

  const reading = await db.reading.findUnique({ where: { id: input.readingId }, include: { topic: true } });
  if (!reading || reading.topic.levelId !== plan.levelId) {
    return Response.json({ error: "That module is not part of this plan's level" }, { status: 400 });
  }
  if (input.packageId) {
    const packageError = await assertUsablePackage(input.packageId, auth.userId);
    if (packageError) return packageError;
  }

  // Calendar days in the plan's zone, compared as strings.
  const today = localDateFor(new Date(), plan.timeZone ?? "UTC");
  const day = input.date ?? today;
  const start = plan.startDate.toISOString().slice(0, 10);
  if (day < start || day > today) {
    return Response.json(
      { error: "date must be on or after the plan's startDate and not in the future" },
      { status: 400 },
    );
  }
  const dayDate = new Date(`${day}T00:00:00Z`);

  const record = {
    status: input.finished === false ? ("partial" as const) : ("done" as const),
    actualMinutes: input.minutes,
    confidence: input.confidence,
    questionsAnswered: input.questionsAnswered,
    questionsCorrect: input.questionsCorrect,
    note: input.note,
  };

  let task;
  if (input.taskId) {
    const planned = await db.planTask.findUnique({ where: { id: input.taskId } });
    if (!planned || planned.planId !== planId) {
      return Response.json({ error: "Task not found on this plan" }, { status: 404 });
    }
    if (!planned.readingIds.includes(input.readingId)) {
      return Response.json({ error: "That module is not part of this task" }, { status: 400 });
    }
    if (planned.date.toISOString().slice(0, 10) > today) {
      return Response.json({ error: "A task cannot be recorded before its day" }, { status: 400 });
    }
    task = await db.$transaction((tx) => recordTask(tx, auth.userId, planned, record));
  } else {
    task = await db.$transaction(async (tx) => {
      const last = await tx.planTask.findFirst({
        where: { planId, date: dayDate, order: { gte: OFF_PLAN_ORDER_BASE } },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      const created = await tx.planTask.create({
        data: {
          planId,
          date: dayDate,
          order: last ? last.order + 1 : OFF_PLAN_ORDER_BASE,
          kind: input.kind,
          readingIds: [input.readingId],
          // The session's own minutes are the only measure of the material it
          // covered, so they are its estimate too.
          estimatedMinutes: input.minutes,
          requiresConfidence: false,
          packageId: input.packageId ?? null,
          insertedBecause: OFF_PLAN,
          // Already history: a rebuild must never rewrite it.
          frozen: true,
        },
      });
      return recordTask(tx, auth.userId, created, { ...record, status: "done" });
    });
  }

  try {
    await generateHorizon(planId, today);
  } catch (err) {
    console.error(`sessions: could not regenerate plan ${planId} after a session`, err);
  }

  const row = await db.planTask.findUniqueOrThrow({ where: { id: task.id } });
  return Response.json(
    {
      task: {
        id: row.id,
        status: row.status,
        kind: row.kind,
        readingIds: row.readingIds,
        actualMinutes: row.actualMinutes,
        insertedBecause: row.insertedBecause,
      },
    },
    { status: 201 },
  );
}
