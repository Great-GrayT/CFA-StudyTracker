import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { db } from "../../src/lib/db";
import { GET } from "../../src/app/api/progress/route";
import { POST as PACKAGES_POST } from "../../src/app/api/plans/[id]/packages/route";
import {
  authedRequest,
  createLog,
  setupUserWithPlan,
  setupUserWithTwoTopics,
  anyPresetPackage,
  ensureLevel,
  daysAgo,
  isoDate,
  fullWeek,
  minimalWeek,
  nineHoursPerWeek,
  tomorrow,
  yesterday,
} from "../helpers/fixtures";

beforeEach(async () => {
  await resetDb();
  await ensureLevel("I");
});

test("logging the same LOS twice counts as one covered LOS in the coverage percentage", async () => {
  const { user, plan, losId } = await setupUserWithPlan({ totalLos: 2 }); // both LOS in one topic, so flat and weighted agree here
  await createLog(user, { planId: plan.id, losId, confidence: 2, questionsAnswered: 0 });
  await createLog(user, { planId: plan.id, losId, confidence: 4, questionsAnswered: 0 });
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`));
  const body = await readJson(res);
  expect(body.coveragePercent).toBe(50);
});

test("coverage is weighted by topic exam weight, not a flat LOS count", async () => {
  // two topics: one weighted 10, one weighted 90, one LOS each; covering only the heavy topic's LOS
  const { user, plan, heavyLosId } = await setupUserWithTwoTopics({ lightWeight: 10, heavyWeight: 90 });
  await createLog(user, { planId: plan.id, losId: heavyLosId, confidence: 4, questionsAnswered: 0 });
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`));
  const body = await readJson(res);
  expect(body.coveragePercent).toBe(90); // not 50, which a flat count would give
});

test("a LOS with low question-bank accuracy is flagged for review even at high confidence", async () => {
  const { user, plan, losId } = await setupUserWithPlan();
  await createLog(user, { planId: plan.id, losId, confidence: 5, questionsAnswered: 5, questionsCorrect: 1 });
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`));
  const body = await readJson(res);
  expect(body.studyNext[0]).toEqual(expect.objectContaining({ losId, status: "flagged" }));
});

test("today's actual progress splits into newCoverage and reviewWork", async () => {
  const { user, plan, losId: losA } = await setupUserWithPlan({ totalLos: 2 });
  await createLog(user, { planId: plan.id, losId: losA, confidence: 2, questionsAnswered: 0 }); // first-ever: new coverage
  await createLog(user, { planId: plan.id, losId: losA, confidence: 2, questionsAnswered: 0 }); // re-study of a flagged LOS: review work
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`));
  const body = await readJson(res);
  expect(body.today.newCoverage).toBe(1);
  expect(body.today.reviewWork).toBe(1);
});

test("paceRealistic is false when the remaining LOS can't plausibly fit in the remaining time", async () => {
  const { user, plan } = await setupUserWithPlan({ examDate: tomorrow, weeklyAvailability: minimalWeek });
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`));
  expect((await readJson(res)).paceRealistic).toBe(false);
});

test("diversityNudges includes a LOS drilled 20+ times from one questions-role package at mid confidence", async () => {
  const { user, plan, losId } = await setupUserWithPlan();
  const pkg = await anyPresetPackage(); // e.g. UWorld
  await PACKAGES_POST(authedRequest(user, `/api/plans/${plan.id}/packages`, { packageId: pkg.id, roles: ["questions"] }));
  await createLog(user, { planId: plan.id, losId, packageId: pkg.id, confidence: 3, questionsAnswered: 25, questionsCorrect: 20 });
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`));
  expect((await readJson(res)).diversityNudges).toContain(losId);
});

test("recommendedSplit reflects the plan's remaining weekly hours at the default 1:2 ratio", async () => {
  const { user, plan } = await setupUserWithPlan({ weeklyAvailability: nineHoursPerWeek });
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`));
  const body = await readJson(res);
  expect(body.recommendedSplit).toEqual({ contentHours: 3, practiceHours: 6 });
});

test("a plan with an exam date in the past returns today's target as 0, not an error", async () => {
  const { user, plan } = await setupUserWithPlan({ examDate: "2020-01-01" });
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`));
  expect(res.status).toBe(200);
  expect((await readJson(res)).today.targetCumulative).toBe(0);
});

test("today's view is live; a past day's view reads the stored ProgressSnapshot", async () => {
  const { user, plan } = await setupUserWithPlan();
  await db.progressSnapshot.create({ data: { planId: plan.id, date: yesterday, targetCumulative: 3, actualCumulative: 1 } });
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`));
  const body = await readJson(res);
  expect(body.history).toContainEqual(expect.objectContaining({ targetCumulative: 3, actualCumulative: 1 }));
});

test("missedDays is empty when every planned day in the trailing week has a log", async () => {
  const { user, plan, losId } = await setupUserWithPlan({ weeklyAvailability: fullWeek });
  for (let i = 0; i < 7; i++) {
    await createLog(user, { planId: plan.id, losId, confidence: 3, questionsAnswered: 0, date: daysAgo(i) });
  }
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`));
  expect((await readJson(res)).missedDays).toEqual([]);
});

test("missedDays includes a planned day in the trailing week that has no log", async () => {
  const { user, plan, losId } = await setupUserWithPlan({ weeklyAvailability: fullWeek });
  // log every day except three days ago
  for (let i = 0; i < 7; i++) {
    if (i === 3) continue;
    await createLog(user, { planId: plan.id, losId, confidence: 3, questionsAnswered: 0, date: daysAgo(i) });
  }
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`));
  expect((await readJson(res)).missedDays).toContain(isoDate(daysAgo(3)));
});

test("returns 403 for a planId that isn't the caller's own plan", async () => {
  const { plan } = await setupUserWithPlan();
  const { user: otherUser } = await setupUserWithPlan();
  const res = await GET(authedRequest(otherUser, `/api/progress?planId=${plan.id}`));
  expect(res.status).toBe(403);
});
