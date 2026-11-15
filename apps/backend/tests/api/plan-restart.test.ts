import { beforeEach, expect, test } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { authedRequest, ensureLevel, registerUser, setupUserWithPlan } from "../helpers/fixtures";
import { POST } from "../../src/app/api/plans/[id]/restart/route";
import { GET } from "../../src/app/api/plans/route";

beforeEach(async () => {
  await resetDb();
  await ensureLevel("I");
});

test("restarting retires the plan so the owner lands on setup, history kept", async () => {
  const { user, plan, losId } = await setupUserWithPlan();
  await db.studyLogEntry.create({ data: { userId: user.id, planId: plan.id, losId, confidence: 3 } });

  const res = await POST(authedRequest(user, `/api/plans/${plan.id}/restart`, {}));
  expect(res.status).toBe(204);

  expect((await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } })).isActive).toBe(false);
  expect((await GET(authedRequest(user, "/api/plans"))).status).toBe(404);
  expect(await db.studyLogEntry.count({ where: { planId: plan.id } })).toBe(1);
});

test("another user cannot restart someone's plan", async () => {
  const { plan } = await setupUserWithPlan();
  const stranger = await registerUser();
  const res = await POST(authedRequest(stranger, `/api/plans/${plan.id}/restart`, {}));
  expect(res.status).toBe(403);
  expect((await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } })).isActive).toBe(true);
});

test("restarting needs a signed-in user", async () => {
  const { plan } = await setupUserWithPlan();
  const res = await POST(new Request(`http://localhost/api/plans/${plan.id}/restart`, { method: "POST" }));
  expect(res.status).toBe(401);
});
