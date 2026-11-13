import { db } from "../../../lib/db";
import { requireUser } from "../../../lib/FUNC-auth";
import { createLogSchema } from "../../../lib/validation";
import { assertUsablePackage } from "../../../lib/FUNC-packages";
import { recordTask } from "../../../lib/FUNC-record";
import { generateHorizon } from "../../../lib/FUNC-schedule";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Same UTC-calendar-day convention as pace.ts/progress/route.ts - plan dates
// are calendar days, not instants.
function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createLogSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { planId, losId, confidence, questionsAnswered, questionsCorrect, packageId, note } = parsed.data;

  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (packageId) {
    const packageError = await assertUsablePackage(packageId, auth.userId);
    if (packageError) return packageError;
  }

  // date defaults to now (today) - the behavior before this field existed.
  // When given explicitly, it must fall within the plan's own lifetime: not
  // before it started, and not in the future (a candidate can log today or
  // backdate a missed entry, but can't log ahead of when the session
  // happened).
  const date = parsed.data.date ?? new Date();
  const dateDay = startOfUTCDay(date);
  const todayDay = startOfUTCDay(new Date());
  const startDateDay = startOfUTCDay(plan.startDate);
  if (dateDay.getTime() < startDateDay.getTime() || dateDay.getTime() > todayDay.getTime()) {
    return Response.json(
      { error: "date must be on or after the plan's startDate and not in the future" },
      { status: 400 },
    );
  }

  if (parsed.data.taskId) {
    const task = await db.planTask.findUnique({ where: { id: parsed.data.taskId } });
    if (!task || task.planId !== planId) {
      return Response.json({ error: "Task not found on this plan" }, { status: 404 });
    }
    const los = await db.lOS.findUnique({ where: { id: losId }, select: { readingId: true } });
    if (!los || !task.readingIds.includes(los.readingId)) {
      return Response.json({ error: "That outcome is not part of this task" }, { status: 400 });
    }
    if (startOfUTCDay(task.date).getTime() > todayDay.getTime()) {
      return Response.json({ error: "A task cannot be recorded before its day" }, { status: 400 });
    }
    const recorded = await db.$transaction(async (tx) => {
      await recordTask(tx, auth.userId, task, {
        status: parsed.data.finished === false ? "partial" : "done",
        actualMinutes: parsed.data.actualMinutes,
        confidence,
        questionsAnswered,
        questionsCorrect,
        note,
      });
      return tx.studyLogEntry.findFirstOrThrow({ where: { taskId: task.id, losId } });
    });
    try {
      await generateHorizon(planId, new Intl.DateTimeFormat("en-CA", { timeZone: plan.timeZone ?? "UTC" }).format(new Date()));
    } catch (err) {
      console.error(`logs: could not regenerate plan ${planId} after a task record`, err);
    }
    return Response.json(recorded, { status: 201 });
  }

  const log = await db.studyLogEntry.create({
    data: {
      userId: auth.userId,
      planId,
      losId,
      confidence,
      questionsAnswered,
      questionsCorrect: questionsCorrect ?? 0,
      packageId,
      note,
      date,
    },
  });

  return Response.json(log, { status: 201 });
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

  const cursor = url.searchParams.get("cursor");
  const limitParam = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

  // Fetch one extra row to know whether a next page exists, without a
  // separate count query.
  const rows = await db.studyLogEntry.findMany({
    where: { planId, userId: auth.userId },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]!.id : null;

  return Response.json({ items, nextCursor }, { status: 200 });
}
