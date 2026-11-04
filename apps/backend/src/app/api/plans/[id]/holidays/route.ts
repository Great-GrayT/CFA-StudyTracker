import type { PlanHoliday } from "@prisma/client";
import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { createHolidaySchema } from "../../../../../lib/validation";

function planIdFromUrl(req: Request): string {
  const segments = new URL(req.url).pathname.split("/");
  return segments[3]!; // /api/plans/<id>/holidays
}

async function findOwnedPlan(planId: string, userId: string) {
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== userId) return null;
  return plan;
}

// Holiday ranges are calendar days ("2026-12-20"), not instants - serialize
// them back as bare YYYY-MM-DD so round-tripping through JSON doesn't grow a
// timezone-dependent time component the caller never sent.
function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function serializeHoliday(holiday: PlanHoliday) {
  return {
    ...holiday,
    startDate: formatDateOnly(holiday.startDate),
    endDate: formatDateOnly(holiday.endDate),
  };
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const planId = planIdFromUrl(req);
  const plan = await findOwnedPlan(planId, auth.userId);
  if (!plan) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const holidays = await db.planHoliday.findMany({
    where: { planId },
    orderBy: { startDate: "asc" },
  });

  return Response.json(holidays.map(serializeHoliday), { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const planId = planIdFromUrl(req);
  const plan = await findOwnedPlan(planId, auth.userId);
  if (!plan) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createHolidaySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const holiday = await db.planHoliday.create({
    data: { planId, ...parsed.data },
  });

  return Response.json(serializeHoliday(holiday), { status: 201 });
}
