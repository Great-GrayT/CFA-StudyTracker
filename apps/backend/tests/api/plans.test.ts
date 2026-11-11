import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { db } from "../../src/lib/db";
import {
  registerUser,
  createPlan,
  listPlansForUser,
  setupUserWithPlan,
  listLogs,
  authedRequest,
  anyLosIdForLevel,
  anyPresetPackage,
  fullWeek,
} from "../helpers/fixtures";

// Every test here creates a plan with levelId "I", which is an FK - the test
// DB (unlike the dev DB) has no curriculum seeded, so ensure a minimal Level
// "I" chain exists right after each wipe, even for tests that don't
// otherwise need a LOS id.
beforeEach(async () => {
  await resetDb();
  await anyLosIdForLevel("I");
});

// Regresses the Critical DoS finding: an unbounded examDate let a crafted
// far-future date make pace.ts's remaining-hours math churn for a huge
// span. The real defense is now pace.ts's O(1) rewrite (see pace.test.ts),
// but this boundary check means a degenerate date is rejected outright
// before it ever reaches that math, on every route that accepts examDate.
test("creating a plan with an examDate more than 10 years out is rejected with 400", async () => {
  const { POST } = await import("../../src/app/api/plans/route");
  const user = await registerUser();
  const farFuture = new Date(Date.now() + 11 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const res = await POST(
    authedRequest(user, "/api/plans", { levelId: "I", examDate: farFuture, weeklyAvailability: fullWeek }),
  );
  expect(res.status).toBe(400);
});

test("PATCHing a plan's examDate more than 10 years out is rejected with 400", async () => {
  const { PATCH } = await import("../../src/app/api/plans/[id]/route");
  const { user, plan } = await setupUserWithPlan();
  const farFuture = new Date(Date.now() + 11 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const res = await PATCH(authedRequest(user, `/api/plans/${plan.id}`, { examDate: farFuture }));
  expect(res.status).toBe(400);
});

test("importing a plan with an examDate more than 10 years out is rejected with 400", async () => {
  const { POST } = await import("../../src/app/api/plans/import/route");
  const user = await registerUser();
  const farFuture = new Date(Date.now() + 11 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const res = await POST(
    authedRequest(user, "/api/plans/import", { levelId: "I", examDate: farFuture, weeklyAvailability: fullWeek }),
  );
  expect(res.status).toBe(400);
});

test("creating a new active plan deactivates the previous active plan", async () => {
  const user = await registerUser();
  await createPlan(user, { levelId: "I", examDate: "2027-06-01", weeklyAvailability: fullWeek });
  const second = await createPlan(user, { levelId: "I", examDate: "2027-12-01", weeklyAvailability: fullWeek });
  const plans = await listPlansForUser(user);
  expect(plans.filter((p) => p.isActive)).toEqual([expect.objectContaining({ id: second.id })]);
});

test("creating a plan with backfilled logs writes one StudyLogEntry per entry, dated startDate", async () => {
  const user = await registerUser();
  const losId = await anyLosIdForLevel("I");
  const plan = await createPlan(user, {
    levelId: "I",
    examDate: "2027-06-01",
    startDate: "2026-10-01",
    weeklyAvailability: fullWeek,
    initialLogs: [{ losId, confidence: 4, questionsAnswered: 12 }],
  });
  const logs = await listLogs(user, plan.id);
  expect(logs).toEqual([
    expect.objectContaining({ losId, confidence: 4, questionsAnswered: 12, date: new Date("2026-10-01") }),
  ]);
});

test("adding a holiday range persists it and it's listed back", async () => {
  const { POST, GET } = await import("../../src/app/api/plans/[id]/holidays/route");
  const { user, plan } = await setupUserWithPlan({ weeklyAvailability: fullWeek });
  const res = await POST(
    authedRequest(user, `/api/plans/${plan.id}/holidays`, {
      startDate: "2026-12-20",
      endDate: "2026-12-27",
      note: "trip",
    }),
  );
  expect(res.status).toBe(201);
  const list = await readJson(await GET(authedRequest(user, `/api/plans/${plan.id}/holidays`)));
  expect(list).toEqual([
    expect.objectContaining({ startDate: "2026-12-20", endDate: "2026-12-27", note: "trip" }),
  ]);
  // the holiday's effect on remaining hours is covered at the pure-function level in Task 8;
  // this test only proves the CRUD plumbing persists and returns it correctly
});

test("deleting a holiday range removes it", async () => {
  const { POST } = await import("../../src/app/api/plans/[id]/holidays/route");
  const { DELETE } = await import("../../src/app/api/plans/[id]/holidays/[holidayId]/route");
  const { user, plan } = await setupUserWithPlan();
  const holiday = await readJson(
    await POST(authedRequest(user, `/api/plans/${plan.id}/holidays`, { startDate: "2026-12-20", endDate: "2026-12-27" })),
  );
  const res = await DELETE(authedRequest(user, `/api/plans/${plan.id}/holidays/${holiday.id}`));
  expect(res.status).toBe(200);
  expect(await db.planHoliday.count()).toBe(0);
});

// Guards the raw-SQL partial unique index (migration
// 20261105000254_add_study_plan_active_unique_index): schema.prisma has no
// model-level annotation for it, so a future `prisma migrate dev` run could
// silently generate a migration that drops it (see that migration's own
// comment for why). Querying pg_indexes directly means CI catches a dropped
// index even though schema.prisma itself would never show the drift.
test("the StudyPlan_userId_active_unique partial index still exists", async () => {
  const rows = await db.$queryRaw<Array<{ indexdef: string }>>`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'StudyPlan' AND indexname = 'StudyPlan_userId_active_unique'
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0]!.indexdef).toContain('"isActive"');
});

test("tagging a package with roles on a plan, then re-tagging it, replaces the roles rather than duplicating the row", async () => {
  const { POST, GET } = await import("../../src/app/api/plans/[id]/packages/route");
  const { user, plan } = await setupUserWithPlan();
  const pkg = await anyPresetPackage();
  await POST(authedRequest(user, `/api/plans/${plan.id}/packages`, { packageId: pkg.id, roles: ["content"] }));
  await POST(
    authedRequest(user, `/api/plans/${plan.id}/packages`, { packageId: pkg.id, roles: ["content", "questions"] }),
  );
  const list = await readJson(await GET(authedRequest(user, `/api/plans/${plan.id}/packages`)));
  expect(list).toEqual([expect.objectContaining({ packageId: pkg.id, roles: ["content", "questions"] })]);
});

// LOCATION, TIMEZONE AND COACH PREFERENCE
//
// All three columns existed before any route could set them. timeZone in
// particular shipped with a UTC default and no way to change it, so every
// candidate outside UTC would have received their "half past six" email at the
// wrong hour with no means of correcting it.

test("PATCHing a location sets all four columns together", async () => {
  const { PATCH } = await import("../../src/app/api/plans/[id]/route");
  const { user, plan } = await setupUserWithPlan();
  const res = await PATCH(
    authedRequest(user, `/api/plans/${plan.id}`, {
      location: {
        city: "Manchester",
        countryCode: "GB",
        latitude: 53.48,
        longitude: -2.24,
        timeZone: "Europe/London",
      },
    }),
  );
  expect(res.status).toBe(200);

  const updated = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(updated.city).toBe("Manchester");
  expect(updated.countryCode).toBe("GB");
  expect(updated.latitude).toBeCloseTo(53.48, 5);
  expect(updated.longitude).toBeCloseTo(-2.24, 5);
  // Choosing a city sets the zone, since the geocoder returns it and leaving a
  // candidate in Manchester on UTC is the bug the column exists to prevent.
  expect(updated.timeZone).toBe("Europe/London");
});

test("an explicit timeZone beats the one implied by the chosen city", async () => {
  // Real case: a candidate living in one zone and sitting the exam in another,
  // who wants their emails on exam-centre time.
  const { PATCH } = await import("../../src/app/api/plans/[id]/route");
  const { user, plan } = await setupUserWithPlan();
  await PATCH(
    authedRequest(user, `/api/plans/${plan.id}`, {
      timeZone: "Asia/Dubai",
      location: {
        city: "Manchester",
        countryCode: "GB",
        latitude: 53.48,
        longitude: -2.24,
        timeZone: "Europe/London",
      },
    }),
  );
  const updated = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(updated.timeZone).toBe("Asia/Dubai");
  expect(updated.city).toBe("Manchester");
});

test("PATCHing location to null clears every location column", async () => {
  const { PATCH } = await import("../../src/app/api/plans/[id]/route");
  const { user, plan } = await setupUserWithPlan();
  await PATCH(
    authedRequest(user, `/api/plans/${plan.id}`, {
      location: {
        city: "Oslo",
        countryCode: "NO",
        latitude: 59.91,
        longitude: 10.75,
        timeZone: "Europe/Oslo",
      },
    }),
  );
  await PATCH(authedRequest(user, `/api/plans/${plan.id}`, { location: null }));

  const updated = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(updated.city).toBeNull();
  expect(updated.countryCode).toBeNull();
  expect(updated.latitude).toBeNull();
  expect(updated.longitude).toBeNull();
  // Withdrawing a location must not reset the zone: the emails would silently
  // move to UTC as a side effect of a privacy choice.
  expect(updated.timeZone).toBe("Europe/Oslo");
});

test("omitting location leaves an existing one untouched", async () => {
  const { PATCH } = await import("../../src/app/api/plans/[id]/route");
  const { user, plan } = await setupUserWithPlan();
  await PATCH(
    authedRequest(user, `/api/plans/${plan.id}`, {
      location: {
        city: "Oslo",
        countryCode: "NO",
        latitude: 59.91,
        longitude: 10.75,
        timeZone: "Europe/Oslo",
      },
    }),
  );
  await PATCH(authedRequest(user, `/api/plans/${plan.id}`, { emailCoach: "off" }));

  const updated = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(updated.city).toBe("Oslo");
  expect(updated.emailCoach).toBe("off");
});

test.each([
  ["a latitude past the pole", { latitude: 91, longitude: 0 }],
  ["a latitude past the south pole", { latitude: -91, longitude: 0 }],
  ["a longitude past the date line", { latitude: 0, longitude: 181 }],
  ["a longitude past the other side", { latitude: 0, longitude: -181 }],
])("an out-of-range coordinate is rejected with 400: %s", async (_label, coords) => {
  const { PATCH } = await import("../../src/app/api/plans/[id]/route");
  const { user, plan } = await setupUserWithPlan();
  const res = await PATCH(
    authedRequest(user, `/api/plans/${plan.id}`, {
      location: { city: "Nowhere", countryCode: "XX", timeZone: "UTC", ...coords },
    }),
  );
  expect(res.status).toBe(400);
});

test("a half-set location is rejected rather than stored", async () => {
  // There is no state the coach can use with a city and no coordinates, so the
  // route must refuse instead of writing one and failing later at send time.
  const { PATCH } = await import("../../src/app/api/plans/[id]/route");
  const { user, plan } = await setupUserWithPlan();
  const res = await PATCH(
    authedRequest(user, `/api/plans/${plan.id}`, { location: { city: "Lisbon" } }),
  );
  expect(res.status).toBe(400);

  const unchanged = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(unchanged.city).toBeNull();
});

test("a plausible but fictional timezone is rejected with 400", async () => {
  // A pattern match on "Area/City" would accept this. The failure then shows up
  // as every email arriving at the wrong hour rather than as a bad request.
  const { PATCH } = await import("../../src/app/api/plans/[id]/route");
  const { user, plan } = await setupUserWithPlan();
  const res = await PATCH(
    authedRequest(user, `/api/plans/${plan.id}`, { timeZone: "Europe/Narnia" }),
  );
  expect(res.status).toBe(400);
});

test.each(["all", "debrief-only", "off"])(
  "emailCoach accepts the documented value %s",
  async (value) => {
    const { PATCH } = await import("../../src/app/api/plans/[id]/route");
    const { user, plan } = await setupUserWithPlan();
    const res = await PATCH(authedRequest(user, `/api/plans/${plan.id}`, { emailCoach: value }));
    expect(res.status).toBe(200);
    const updated = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(updated.emailCoach).toBe(value);
  },
);

test("an emailCoach value outside the closed set is rejected with 400", async () => {
  // The column is a String, so nothing at the database level stops a typo from
  // being stored, and a stored typo silently behaves as "all" in FUNC-coach.
  const { PATCH } = await import("../../src/app/api/plans/[id]/route");
  const { user, plan } = await setupUserWithPlan();
  const res = await PATCH(
    authedRequest(user, `/api/plans/${plan.id}`, { emailCoach: "debrief_only" }),
  );
  expect(res.status).toBe(400);
});

test("another user cannot set the location on a plan that is not theirs", async () => {
  const { PATCH } = await import("../../src/app/api/plans/[id]/route");
  const { plan } = await setupUserWithPlan();
  const stranger = await registerUser();
  const res = await PATCH(
    authedRequest(stranger, `/api/plans/${plan.id}`, {
      location: {
        city: "Lagos",
        countryCode: "NG",
        latitude: 6.45,
        longitude: 3.4,
        timeZone: "Africa/Lagos",
      },
    }),
  );
  expect(res.status).toBe(403);

  const unchanged = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(unchanged.city).toBeNull();
});

