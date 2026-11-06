import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { db } from "../../src/lib/db";
import { readJson } from "../helpers/request";
import {
  setupUserWithPlan,
  createLog,
  listLogs,
  authedRequest,
  registerUser,
  daysAgo,
  isoDate,
} from "../helpers/fixtures";

beforeEach(resetDb);

test("logging a confidence outside 1-5 is rejected with 400", async () => {
  const { user, plan, losId } = await setupUserWithPlan();
  const res = await createLog(user, { planId: plan.id, losId, confidence: 6, questionsAnswered: 0 });
  expect(res.status).toBe(400);
});

test("logging more questionsCorrect than questionsAnswered is rejected with 400", async () => {
  const { user, plan, losId } = await setupUserWithPlan();
  const res = await createLog(user, { planId: plan.id, losId, confidence: 3, questionsAnswered: 2, questionsCorrect: 5 });
  expect(res.status).toBe(400);
});

test("logging the same LOS twice in one day updates confidence but is one coverage entry", async () => {
  const { user, plan, losId } = await setupUserWithPlan();
  await createLog(user, { planId: plan.id, losId, confidence: 2, questionsAnswered: 3 });
  await createLog(user, { planId: plan.id, losId, confidence: 4, questionsAnswered: 2 });
  const logs = await listLogs(user, plan.id);
  expect(logs.filter((l) => l.losId === losId)).toHaveLength(2);
  // coverage-once behavior is asserted on the progress endpoint in Task 10, not here
});

test("logging with an explicit past date (on or after the plan's startDate) is accepted and persisted on that date", async () => {
  const { user, plan, losId } = await setupUserWithPlan({ startDate: isoDate(daysAgo(5)) });
  const res = await createLog(user, {
    planId: plan.id,
    losId,
    confidence: 3,
    questionsAnswered: 1,
    date: daysAgo(2),
  });
  expect(res.status).toBe(201);
  const logs = await listLogs(user, plan.id);
  expect(isoDate(logs[0]!.date)).toBe(isoDate(daysAgo(2)));
});

test("logging a date before the plan's own startDate is rejected with 400", async () => {
  const { user, plan, losId } = await setupUserWithPlan({ startDate: isoDate(daysAgo(2)) });
  const res = await createLog(user, {
    planId: plan.id,
    losId,
    confidence: 3,
    questionsAnswered: 1,
    date: daysAgo(5), // before the plan's startDate
  });
  expect(res.status).toBe(400);
});

test("logging a date in the future is rejected with 400", async () => {
  const { user, plan, losId } = await setupUserWithPlan();
  const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const res = await createLog(user, { planId: plan.id, losId, confidence: 3, questionsAnswered: 1, date: tomorrow });
  expect(res.status).toBe(400);
});

test("DELETE /api/logs/:id removes the caller's own log entry", async () => {
  const { DELETE } = await import("../../src/app/api/logs/[id]/route");
  const { user, plan, losId } = await setupUserWithPlan();
  const log = await readJson(await createLog(user, { planId: plan.id, losId, confidence: 3, questionsAnswered: 1 }));

  const res = await DELETE(authedRequest(user, `/api/logs/${log.id}`, undefined, "DELETE"));
  expect(res.status).toBe(200);
  expect(await db.studyLogEntry.findUnique({ where: { id: log.id } })).toBeNull();
});

test("DELETE /api/logs/:id is forbidden against another user's log entry", async () => {
  const { DELETE } = await import("../../src/app/api/logs/[id]/route");
  const { user, plan, losId } = await setupUserWithPlan();
  const log = await readJson(await createLog(user, { planId: plan.id, losId, confidence: 3, questionsAnswered: 1 }));
  const intruder = await registerUser();

  const res = await DELETE(authedRequest(intruder, `/api/logs/${log.id}`, undefined, "DELETE"));
  expect(res.status).toBe(403);
  expect(await db.studyLogEntry.findUnique({ where: { id: log.id } })).not.toBeNull();
});
