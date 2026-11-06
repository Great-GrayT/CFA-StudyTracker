import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { authedRequest, registerUser, setupUserWithPlan, anyLosIdForLevel, anyPresetPackage, fullWeek } from "../helpers/fixtures";

beforeEach(async () => {
  await resetDb();
  await anyLosIdForLevel("I");
});

test("export/all returns the user's plan, packages, and every log entry as JSON", async () => {
  const { GET } = await import("../../src/app/api/export/all/route");
  const { user, plan } = await setupUserWithPlan();
  const res = await GET(authedRequest(user, "/api/export/all"));
  const body = await readJson(res);
  expect(body.plans).toEqual(expect.arrayContaining([expect.objectContaining({ id: plan.id })]));
});

// Regresses export/all omitting MockExam, PlanHoliday, and PlanPackage
// entirely - it only ever returned {plans, packages, logs}, silently
// dropping three whole user-data tables from the "export everything" file.
test("export/all includes mockExams, holidays, and planPackages when the user has them", async () => {
  const { POST: HOLIDAYS_POST } = await import("../../src/app/api/plans/[id]/holidays/route");
  const { POST: PACKAGES_POST } = await import("../../src/app/api/plans/[id]/packages/route");
  const { POST: MOCK_EXAM_POST } = await import("../../src/app/api/mock-exams/route");
  const { GET } = await import("../../src/app/api/export/all/route");

  const { user, plan } = await setupUserWithPlan();
  const pkg = await anyPresetPackage();

  await HOLIDAYS_POST(
    authedRequest(user, `/api/plans/${plan.id}/holidays`, { startDate: "2026-12-20", endDate: "2026-12-27" }),
  );
  await PACKAGES_POST(
    authedRequest(user, `/api/plans/${plan.id}/packages`, { packageId: pkg.id, roles: ["content"] }),
  );
  await MOCK_EXAM_POST(
    authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 70 }),
  );

  const body = await readJson(await GET(authedRequest(user, "/api/export/all")));

  expect(body.mockExams).toHaveLength(1);
  expect(body.mockExams[0]).toEqual(expect.objectContaining({ scorePercent: 70, planId: plan.id }));
  expect(body.holidays).toHaveLength(1);
  expect(new Date(body.holidays[0].startDate)).toEqual(new Date("2026-12-20"));
  expect(new Date(body.holidays[0].endDate)).toEqual(new Date("2026-12-27"));
  expect(body.planPackages).toHaveLength(1);
  expect(body.planPackages[0]).toEqual(expect.objectContaining({ packageId: pkg.id, roles: ["content"] }));
});

test("export/log returns CSV with a header row", async () => {
  const { GET } = await import("../../src/app/api/export/log/route");
  const { user } = await setupUserWithPlan();
  const res = await GET(authedRequest(user, "/api/export/log"));
  expect(res.headers.get("content-type")).toContain("text/csv");
  const text = await res.text();
  expect(text.split("\n")[0]).toContain("losId");
});

test("importing a plan file creates a new active plan from its contents", async () => {
  const { POST } = await import("../../src/app/api/plans/import/route");
  const user = await registerUser();
  const shareFile = { levelId: "I", examDate: "2027-06-01", weeklyAvailability: fullWeek };
  const res = await POST(authedRequest(user, "/api/plans/import", shareFile));
  expect(res.status).toBe(201);
});
