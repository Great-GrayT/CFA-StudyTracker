import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { registerUser, setupUserWithPlan, authedRequest } from "../helpers/fixtures";
import { db } from "../../src/lib/db";
import { POST, GET } from "../../src/app/api/mock-exams/route";
import { DELETE } from "../../src/app/api/mock-exams/[id]/route";

beforeEach(resetDb);

test("POST /api/mock-exams logs a score for the caller's plan", async () => {
  const { user, plan } = await setupUserWithPlan();
  const res = await POST(
    authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 68 }),
  );
  expect(res.status).toBe(201);
});

test("scorePercent outside 0-100 is rejected with 400", async () => {
  const { user, plan } = await setupUserWithPlan();
  const res = await POST(
    authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 142 }),
  );
  expect(res.status).toBe(400);
});

test("POST /api/mock-exams is forbidden against another user's plan", async () => {
  const { plan } = await setupUserWithPlan();
  const intruder = await registerUser();
  const res = await POST(
    authedRequest(intruder, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 68 }),
  );
  expect(res.status).toBe(403);
});

test("GET /api/mock-exams lists the caller's scores for a plan, ordered by date", async () => {
  const { user, plan } = await setupUserWithPlan();
  await POST(authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-10-01", scorePercent: 55 }));
  await POST(authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 68 }));
  const res = await GET(authedRequest(user, `/api/mock-exams?planId=${plan.id}`));
  const body = await readJson(res);
  expect(body.map((m: any) => m.scorePercent)).toEqual([55, 68]);
});

test("GET /api/mock-exams is forbidden against another user's plan", async () => {
  const { user, plan } = await setupUserWithPlan();
  const intruder = await registerUser();
  await POST(authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 68 }));
  const res = await GET(authedRequest(intruder, `/api/mock-exams?planId=${plan.id}`));
  expect(res.status).toBe(403);
});

test("DELETE /api/mock-exams/:id removes one, 403 if it isn't the caller's", async () => {
  const { user, plan } = await setupUserWithPlan();
  const other = await registerUser();
  const mock = await readJson(
    await POST(authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 68 })),
  );
  expect((await DELETE(authedRequest(other, `/api/mock-exams/${mock.id}`))).status).toBe(403);
  expect((await DELETE(authedRequest(user, `/api/mock-exams/${mock.id}`))).status).toBe(200);
});

async function twoTopics(planId: string) {
  const level = (await db.studyPlan.findUniqueOrThrow({ where: { id: planId } })).levelId;
  const a = await db.topic.create({ data: { levelId: level, name: "A", order: 11, examWeightMin: 1, examWeightMax: 1 } });
  const b = await db.topic.create({ data: { levelId: level, name: "B", order: 12, examWeightMin: 1, examWeightMax: 1 } });
  return [a.id, b.id] as const;
}

test("per-topic scores are stored with the session ref", async () => {
  const { user, plan } = await setupUserWithPlan();
  const [a, b] = await twoTopics(plan.id);
  const res = await POST(
    authedRequest(user, "/api/mock-exams", {
      planId: plan.id, date: "2026-11-01", scorePercent: 75, sessionRef: "pp/mock/1",
      topicScores: [{ topicId: a, answered: 20, correct: 15 }, { topicId: b, answered: 20, correct: 15 }],
    }),
  );
  expect(res.status).toBe(201);
  const row = await db.mockExam.findFirstOrThrow({ where: { planId: plan.id }, include: { topicScores: true } });
  expect(row.sessionRef).toBe("pp/mock/1");
  expect(row.topicScores).toHaveLength(2);
});

test("scorePercent is derived from topic scores when omitted", async () => {
  const { user, plan } = await setupUserWithPlan();
  const [a, b] = await twoTopics(plan.id);
  const res = await POST(
    authedRequest(user, "/api/mock-exams", {
      planId: plan.id, date: "2026-11-01",
      topicScores: [{ topicId: a, answered: 10, correct: 5 }, { topicId: b, answered: 10, correct: 7 }],
    }),
  );
  expect(res.status).toBe(201);
  expect((await readJson(res)).scorePercent).toBe(60);
});

test("topic scores whose total disagrees with scorePercent are rejected", async () => {
  const { user, plan } = await setupUserWithPlan();
  const [a, b] = await twoTopics(plan.id);
  const res = await POST(
    authedRequest(user, "/api/mock-exams", {
      planId: plan.id, date: "2026-11-01", scorePercent: 90,
      topicScores: [{ topicId: a, answered: 10, correct: 5 }, { topicId: b, answered: 10, correct: 7 }],
    }),
  );
  expect(res.status).toBe(400);
});

test("a topic score with correct above answered, or a foreign topic, is rejected", async () => {
  const { user, plan } = await setupUserWithPlan();
  const [a] = await twoTopics(plan.id);
  const bad = await POST(
    authedRequest(user, "/api/mock-exams", {
      planId: plan.id, date: "2026-11-01", topicScores: [{ topicId: a, answered: 5, correct: 6 }],
    }),
  );
  expect(bad.status).toBe(400);
  const foreign = await POST(
    authedRequest(user, "/api/mock-exams", {
      planId: plan.id, date: "2026-11-01", topicScores: [{ topicId: "nope", answered: 5, correct: 2 }],
    }),
  );
  expect(foreign.status).toBe(400);
});

test("totals must equal the session's question count when it is known", async () => {
  const { user, plan } = await setupUserWithPlan();
  const [a] = await twoTopics(plan.id);
  const pkg = await db.studyPackage.create({ data: { slug: "mx", name: "Mx", userId: null } });
  const ed = await db.packageEdition.create({ data: { packageId: pkg.id, levelId: plan.levelId, year: "2026" } });
  await db.packageResource.create({
    data: { editionId: ed.id, ref: "mx/mock/1", kind: "mock_session", questionCount: 44 },
  });
  const res = await POST(
    authedRequest(user, "/api/mock-exams", {
      planId: plan.id, date: "2026-11-01", sessionRef: "mx/mock/1",
      topicScores: [{ topicId: a, answered: 40, correct: 30 }],
    }),
  );
  expect(res.status).toBe(400);
});
