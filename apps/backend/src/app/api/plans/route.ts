import type { Prisma } from "@prisma/client";
import { db } from "../../../lib/db";
import { requireUser } from "../../../lib/FUNC-auth";
import { createPlanSchema } from "../../../lib/validation";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const plan = await db.studyPlan.findFirst({
    where: { userId: auth.userId, isActive: true },
  });
  if (!plan) {
    return Response.json({ error: "No active plan" }, { status: 404 });
  }

  return Response.json(plan, { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createPlanSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { levelId, examDate, weeklyAvailability, initialLogs } = parsed.data;
  const startDate = parsed.data.startDate ?? new Date();

  // Deactivate-then-create-then-backfill all happen inside one transaction so
  // a reader can never observe two active plans, or a plan with only some of
  // its backfilled logs, even under concurrent requests from the same user.
  const plan = await db.$transaction(async (tx) => {
    await tx.studyPlan.updateMany({
      where: { userId: auth.userId, isActive: true },
      data: { isActive: false },
    });

    const created = await tx.studyPlan.create({
      data: {
        userId: auth.userId,
        levelId,
        examDate,
        startDate,
        weeklyAvailability: weeklyAvailability as Prisma.InputJsonValue,
        isActive: true,
      },
    });

    if (initialLogs && initialLogs.length > 0) {
      await tx.studyLogEntry.createMany({
        data: initialLogs.map((entry) => ({
          userId: auth.userId,
          planId: created.id,
          losId: entry.losId,
          confidence: entry.confidence,
          questionsAnswered: entry.questionsAnswered,
          date: startDate,
        })),
      });
    }

    return created;
  });

  return Response.json(plan, { status: 201 });
}
