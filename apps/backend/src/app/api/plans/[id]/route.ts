import type { Prisma } from "@prisma/client";
import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";
import { patchPlanSchema } from "../../../../lib/validation";
import { parseTuning } from "../../../../core/tuning";
import { generateHorizon } from "../../../../lib/FUNC-schedule";

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
  if (parsed.data.pushCoach !== undefined) data.pushCoach = parsed.data.pushCoach;

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

  if (parsed.data.planMode !== undefined) data.planMode = parsed.data.planMode;
  if (parsed.data.reviewPolicy !== undefined) data.reviewPolicy = parsed.data.reviewPolicy;
  if (parsed.data.reviewStartDate !== undefined) {
    data.reviewStartDate = parsed.data.reviewStartDate;
  }

  // The constants merge into whatever is already stored, so a settings screen
  // can send only the field the candidate touched. parseTuning then clamps the
  // merged object and reports anything it had to substitute, which is what
  // lets one bad field cost that field and nothing else.
  let rejectedTuning: Array<{ field: string; reason: string }> = [];
  let effectiveTuning = parseTuning(null).tuning;
  if (parsed.data.tuning !== undefined) {
    const stored =
      plan.tuning && typeof plan.tuning === "object" && !Array.isArray(plan.tuning)
        ? (plan.tuning as Record<string, unknown>)
        : {};
    const merged = { ...stored, ...parsed.data.tuning };
    const result = parseTuning(merged);
    rejectedTuning = result.rejected.map((r) => ({ field: r.field, reason: r.reason }));
    data.tuning = merged as Prisma.InputJsonValue;
  }

  // The fixed-date policy needs a date, and the check has to see the plan as it
  // will BE, not just the fields in this request: switching policy when a date
  // is already stored is fine, and clearing the date while the policy stands is
  // not. A half-filled policy is rejected rather than quietly falling back,
  // because the candidate picked it deliberately.
  const nextPolicy = parsed.data.reviewPolicy ?? plan.reviewPolicy;
  const nextStart =
    parsed.data.reviewStartDate !== undefined ? parsed.data.reviewStartDate : plan.reviewStartDate;
  if (nextPolicy === "fixed-date" && nextStart === null) {
    return Response.json(
      { error: "The fixed-date review policy needs a reviewStartDate" },
      { status: 400 },
    );
  }

  const updated = await db.studyPlan.update({ where: { id: planId }, data });
  effectiveTuning = parseTuning({
    ...(updated.tuning && typeof updated.tuning === "object" && !Array.isArray(updated.tuning)
      ? (updated.tuning as Record<string, unknown>)
      : {}),
    planMode: updated.planMode,
    reviewPolicy: updated.reviewPolicy,
    reviewStartDate: updated.reviewStartDate
      ? updated.reviewStartDate.toISOString().slice(0, 10)
      : null,
  }).tuning;

  // Changing the hours or the exam date changes what the remaining days
  // should hold, and the candidate expects to see that immediately rather
  // than whenever the scheduler next runs. Cutting Saturday from four hours
  // to one and finding Saturday still full reads as the setting not having
  // taken.
  //
  // Only the days from today forward move. generateHorizon freezes everything
  // before today and keeps any task already started or finished, so a week
  // edited on Wednesday keeps Monday and Tuesday exactly as they were
  // worked: the new budget is spread over what is left, not backdated over
  // what is done.
  // Anything that changes the shape of the days ahead. The plan mode, the
  // review policy and the constants all do, as surely as the hours do: a
  // candidate who switches to curriculum order and finds this week unchanged
  // reads it as the setting not having taken.
  const replans =
    parsed.data.weeklyAvailability !== undefined ||
    parsed.data.examDate !== undefined ||
    parsed.data.planMode !== undefined ||
    parsed.data.reviewPolicy !== undefined ||
    parsed.data.reviewStartDate !== undefined ||
    parsed.data.tuning !== undefined;
  if (replans) {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: updated.timeZone ?? "UTC",
    }).format(new Date());
    try {
      await generateHorizon(planId, today);
    } catch (err) {
      // The setting is saved either way. A failed replan leaves the previous
      // horizon in place, which is stale but not wrong, and the next
      // scheduled tick rebuilds it.
      console.error(`plans PATCH: could not replan plan ${planId}`, err);
    }
  }

  return Response.json(
    { ...updated, tuning: effectiveTuning, rejectedTuning },
    { status: 200 },
  );
}
