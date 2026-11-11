import type { Prisma } from "@prisma/client";
import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";
import { patchPlanSchema } from "../../../../lib/validation";

// Route handlers here are called directly in tests (no Next.js router in the
// loop), so the dynamic segment is pulled from the URL itself rather than a
// framework-injected `params` argument - works identically under both the
// test harness and a real Next.js request, since the pathname is the same.
function planIdFromUrl(req: Request): string {
  const segments = new URL(req.url).pathname.split("/");
  return segments[3]!; // /api/plans/<id>
}

export async function PATCH(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const planId = planIdFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  // Same 403 for "doesn't exist" and "exists but isn't yours" - never reveal
  // whether a plan id is real to someone who doesn't own it.
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = patchPlanSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const data: Prisma.StudyPlanUpdateInput = {};
  if (parsed.data.examDate !== undefined) data.examDate = parsed.data.examDate;
  if (parsed.data.weeklyAvailability !== undefined) {
    data.weeklyAvailability = parsed.data.weeklyAvailability as Prisma.InputJsonValue;
  }
  if (parsed.data.timeZone !== undefined) data.timeZone = parsed.data.timeZone;
  if (parsed.data.emailCoach !== undefined) data.emailCoach = parsed.data.emailCoach;

  // The four location columns move as one unit: a half-set location (a city
  // with no coordinates, or coordinates with no city) is not a state the coach
  // can do anything useful with, so there is no path that produces one.
  if (parsed.data.location === null) {
    data.city = null;
    data.countryCode = null;
    data.latitude = null;
    data.longitude = null;
  } else if (parsed.data.location !== undefined) {
    const loc = parsed.data.location;
    data.city = loc.city;
    data.countryCode = loc.countryCode;
    data.latitude = loc.latitude;
    data.longitude = loc.longitude;
    // Choosing a city sets the zone too, since the geocoder returns it and an
    // explicit timeZone in the same request would otherwise silently disagree
    // with the place just chosen. An explicit timeZone still wins, for the
    // candidate who studies in one zone and sits the exam in another.
    if (parsed.data.timeZone === undefined) data.timeZone = loc.timeZone;
  }

  const updated = await db.studyPlan.update({ where: { id: planId }, data });

  return Response.json(updated, { status: 200 });
}
