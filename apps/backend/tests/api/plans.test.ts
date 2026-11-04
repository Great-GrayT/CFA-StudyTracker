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
