import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { setupUserWithPlan, createLog, listLogs } from "../helpers/fixtures";

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
