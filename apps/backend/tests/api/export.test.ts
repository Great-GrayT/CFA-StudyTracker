import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { authedRequest, registerUser, setupUserWithPlan, anyLosIdForLevel, fullWeek } from "../helpers/fixtures";

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
