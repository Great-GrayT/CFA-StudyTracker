import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { registerUser, setupUserWithPlan, authedRequest, createLog, anyPresetPackage } from "../helpers/fixtures";

/**
 * Regression coverage for the cross-user ownership boundary: every
 * plan-scoped write/read in Task 9 must 403 when called with a token that
 * doesn't own the plan in question. plans.test.ts and logs.test.ts only ever
 * exercise a resource's own owner, so none of them would catch a dropped
 * ownership check on refactor - these tests exist specifically to catch
 * that. One test per route group named in the Task 9 review finding.
 */

beforeEach(resetDb);

test("logs POST and GET are forbidden against another user's plan", async () => {
  const { plan, losId } = await setupUserWithPlan();
  const intruder = await registerUser();

  const postRes = await createLog(intruder, { planId: plan.id, losId, confidence: 3, questionsAnswered: 1 });
  expect(postRes.status).toBe(403);

  const { GET } = await import("../../src/app/api/logs/route");
  const getRes = await GET(authedRequest(intruder, `/api/logs?planId=${plan.id}`));
  expect(getRes.status).toBe(403);
});

test("holidays POST and DELETE are forbidden against another user's plan", async () => {
  const { POST } = await import("../../src/app/api/plans/[id]/holidays/route");
  const { DELETE } = await import("../../src/app/api/plans/[id]/holidays/[holidayId]/route");
  const { user: owner, plan } = await setupUserWithPlan();
  const intruder = await registerUser();

  const postRes = await POST(
    authedRequest(intruder, `/api/plans/${plan.id}/holidays`, { startDate: "2026-12-20", endDate: "2026-12-27" }),
  );
  expect(postRes.status).toBe(403);

  // Owner creates a real holiday, then the intruder tries to delete it.
  const holiday = await readJson(
    await POST(authedRequest(owner, `/api/plans/${plan.id}/holidays`, { startDate: "2026-12-20", endDate: "2026-12-27" })),
  );
  const deleteRes = await DELETE(authedRequest(intruder, `/api/plans/${plan.id}/holidays/${holiday.id}`));
  expect(deleteRes.status).toBe(403);
});

test("plan-scoped packages POST and DELETE are forbidden against another user's plan", async () => {
  const { POST } = await import("../../src/app/api/plans/[id]/packages/route");
  const { DELETE } = await import("../../src/app/api/plans/[id]/packages/[packageId]/route");
  const { user: owner, plan } = await setupUserWithPlan();
  const intruder = await registerUser();
  const pkg = await anyPresetPackage();

  const postRes = await POST(
    authedRequest(intruder, `/api/plans/${plan.id}/packages`, { packageId: pkg.id, roles: ["content"] }),
  );
  expect(postRes.status).toBe(403);

  // Owner tags the package for real, then the intruder tries to remove the tag.
  await POST(authedRequest(owner, `/api/plans/${plan.id}/packages`, { packageId: pkg.id, roles: ["content"] }));
  const deleteRes = await DELETE(authedRequest(intruder, `/api/plans/${plan.id}/packages/${pkg.id}`));
  expect(deleteRes.status).toBe(403);
});

test("PATCH /api/plans/:id is forbidden against another user's plan", async () => {
  const { PATCH } = await import("../../src/app/api/plans/[id]/route");
  const { plan } = await setupUserWithPlan();
  const intruder = await registerUser();

  const res = await PATCH(authedRequest(intruder, `/api/plans/${plan.id}`, { examDate: "2028-01-01" }));
  expect(res.status).toBe(403);
});
