import { db } from "../../../lib/db";
import { requireUser } from "../../../lib/FUNC-auth";
import { createLogSchema } from "../../../lib/validation";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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
