import { beforeEach, test, expect } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import {
  registerUser,
  setupUserWithPlan,
  authedRequest,
  createLog,
  anyPresetPackage,
  type RegisteredUser,
} from "../helpers/fixtures";

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

test("DELETE /api/logs/:id is forbidden against another user's log entry", async () => {
  const { DELETE } = await import("../../src/app/api/logs/[id]/route");
  const { user: owner, plan, losId } = await setupUserWithPlan();
  const intruder = await registerUser();
  const log = await readJson(await createLog(owner, { planId: plan.id, losId, confidence: 3, questionsAnswered: 1 }));

  const res = await DELETE(authedRequest(intruder, `/api/logs/${log.id}`, undefined, "DELETE"));
  expect(res.status).toBe(403);
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

/**
 * Cross-tenant packageId coverage (Important finding #10 of the final
 * review): attaching another user's private custom StudyPackage to your
 * own plan/log/mock-exam/import must be rejected, not just silently
 * accepted via an unchecked FK. plans/[id]/packages's GET in particular
 * returns `package.name` when listing - without this check, attaching a
 * stranger's private package and then listing it reads back that
 * stranger's package name, a real cross-tenant data leak.
 */

async function createPrivatePackage(owner: RegisteredUser): Promise<{ id: string }> {
  const res = await (await import("../../src/app/api/packages/route")).POST(
    authedRequest(owner, "/api/packages", { name: "Owner's Private Package" }),
  );
  return readJson(res);
}

test("logs POST with another user's private packageId is rejected, not attached", async () => {
  const owner = await registerUser();
  const privatePkg = await createPrivatePackage(owner);
  const { user: intruder, plan, losId } = await setupUserWithPlan();

  const res = await createLog(intruder, {
    planId: plan.id,
    losId,
    confidence: 3,
    questionsAnswered: 1,
    packageId: privatePkg.id,
  });
  expect([400, 403]).toContain(res.status);
  expect(await db.studyLogEntry.count({ where: { packageId: privatePkg.id } })).toBe(0);
});

test("plan-scoped packages POST with another user's private packageId is rejected, not attached or leaked back via GET", async () => {
  const { POST, GET } = await import("../../src/app/api/plans/[id]/packages/route");
  const owner = await registerUser();
  const privatePkg = await createPrivatePackage(owner);
  const { user: intruder, plan } = await setupUserWithPlan();

  const postRes = await POST(
    authedRequest(intruder, `/api/plans/${plan.id}/packages`, { packageId: privatePkg.id, roles: ["content"] }),
  );
  expect([400, 403]).toContain(postRes.status);

  const list = await readJson(await GET(authedRequest(intruder, `/api/plans/${plan.id}/packages`)));
  expect(list).toEqual([]);
});

test("mock-exams POST with another user's private packageId is rejected", async () => {
  const { POST } = await import("../../src/app/api/mock-exams/route");
  const owner = await registerUser();
  const privatePkg = await createPrivatePackage(owner);
  const { user: intruder, plan } = await setupUserWithPlan();

  const res = await POST(
    authedRequest(intruder, "/api/mock-exams", {
      planId: plan.id,
      date: "2026-11-01",
      scorePercent: 68,
      packageId: privatePkg.id,
    }),
  );
  expect([400, 403]).toContain(res.status);
});

test("plans/import with another user's private packageId is rejected", async () => {
  const { POST } = await import("../../src/app/api/plans/import/route");
  const owner = await registerUser();
  const privatePkg = await createPrivatePackage(owner);
  const intruder = await registerUser();

  const res = await POST(
    authedRequest(intruder, "/api/plans/import", {
      levelId: "I",
      examDate: "2027-06-01",
      weeklyAvailability: { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 1 },
      packages: [{ packageId: privatePkg.id, roles: ["content"] }],
    }),
  );
  expect([400, 403]).toContain(res.status);
  expect(await db.planPackage.count({ where: { packageId: privatePkg.id } })).toBe(0);
});

test("a shared/official preset package is still usable by anyone (the ownership check doesn't over-block)", async () => {
  const { POST, GET } = await import("../../src/app/api/plans/[id]/packages/route");
  const { user, plan } = await setupUserWithPlan();
  const presetPkg = await anyPresetPackage(); // userId: null

  const postRes = await POST(
    authedRequest(user, `/api/plans/${plan.id}/packages`, { packageId: presetPkg.id, roles: ["content"] }),
  );
  expect(postRes.status).toBe(201);

  const list = await readJson(await GET(authedRequest(user, `/api/plans/${plan.id}/packages`)));
  expect(list).toEqual([expect.objectContaining({ packageId: presetPkg.id })]);
});
