import type { Prisma } from "@prisma/client";
import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";
import { importPlanSchema } from "../../../../lib/validation";

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = importPlanSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { levelId, examDate, weeklyAvailability, packages } = parsed.data;
  const startDate = parsed.data.startDate ?? new Date();

  // Same deactivate-then-create transaction pattern as plans/route.ts's
  // POST (Task 9), so an import can never leave two active plans - or a
  // plan missing some of its imported package tags - visible mid-write.
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

    if (packages && packages.length > 0) {
      await tx.planPackage.createMany({
        data: packages.map((p) => ({
          planId: created.id,
          packageId: p.packageId,
          roles: p.roles,
        })),
      });
    }

    return created;
  });

  return Response.json(plan, { status: 201 });
}
