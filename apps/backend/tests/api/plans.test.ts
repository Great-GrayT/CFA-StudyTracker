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
