import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { addQuestionBank, authedRequest, registerUser, setupPlanWithCatalogue } from "../helpers/fixtures";
import { GET } from "../../src/app/api/plans/[id]/history/route";
import { generateHorizon } from "../../src/lib/FUNC-schedule";
import { PATCH as PATCH_TASK } from "../../src/app/api/plans/[id]/tasks/[taskId]/route";
import { POST as POST_DECL } from "../../src/app/api/plans/[id]/declarations/route";

async function setup() {
  const { planId } = await setupPlanWithCatalogue();
  await addQuestionBank({ questionsPerUnit: 200 });
  const user = await registerUser();
  await db.studyPlan.update({
    where: { id: planId },
    data: { userId: user.id, examDate: new Date("2027-04-01"), weeklyAvailability: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 8, sun: 8 } },
  });
  await generateHorizon(planId, "2027-01-04");
  return { planId, user };
}
const get = (user: Awaited<ReturnType<typeof registerUser>>, planId: string, topicId: string | null) =>
  GET(authedRequest(user, `/api/plans/${planId}/history${topicId ? `?topicId=${topicId}` : ""}`));

describe("GET /api/plans/:id/history", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-04T09:00:00Z"));
  });

  test("400 without topicId, 404 for a stranger or an unknown topic", async () => {
    const { planId, user } = await setup();
    const topic = await db.topic.findFirstOrThrow({ where: { levelId: "II" } });
    expect((await get(user, planId, null)).status).toBe(400);
    expect((await get(user, planId, "nope")).status).toBe(404);
    expect((await get(await registerUser(), planId, topic.id)).status).toBe(404);
  });

  test("a fresh topic lists its modules with four not-started steps and no records", async () => {
    const { planId, user } = await setup();
    const topic = await db.topic.findFirstOrThrow({ where: { levelId: "II", order: 2 } });
    const h = await readJson(await get(user, planId, topic.id));
    expect(h.topicId).toBe(topic.id);
    expect(h.mocks).toEqual([]);
    expect(h.modules).toHaveLength(2);
    for (const m of h.modules) {
      expect(m.steps.map((s: any) => s.step)).toEqual([1, 2, 3, 4]);
      for (const s of m.steps) {
        expect(s.status).toBe("not-started");
        expect(s.records).toEqual([]);
      }
      expect(m.steps[1].questions.n).toBe(0);
      expect(m.steps[1].questions.m).toBeGreaterThan(0);
      expect(m.steps[0].questions).toBeNull();
      expect(m.steps[0].round).toBeNull();
      expect(m.steps[1].round).toBe(1);
    }
  });

  test("a recorded step 2 task, a declaration and a mock show up", async () => {
    const { planId, user } = await setup();
    const t = await db.planTask.findFirstOrThrow({ where: { planId, date: new Date("2027-01-04") }, orderBy: { order: "asc" } });
    const readingId = t.readingIds[0]!;
    const reading = await db.reading.findUniqueOrThrow({ where: { id: readingId } });
    await db.planTask.update({
      where: { id: t.id },
      data: { kind: "questions", step: 2, round: 1, questionCount: 20, estimatedMinutes: 60, workMinutes: 60 },
    });
    await db.lOS.create({ data: { readingId, text: "Outcome", order: 1 } });
    await PATCH_TASK(authedRequest(user, `/api/plans/${planId}/tasks/${t.id}`, {
      status: "done", confidence: 4, questionsAnswered: 20, questionsCorrect: 10, answerReviewDone: true, note: "hard",
    }, "PATCH"));
    await POST_DECL(authedRequest(user, `/api/plans/${planId}/declarations`, { items: [{ readingId, step: 1, confidence: 5, date: "2027-01-02" }] }));
    await db.mockExam.create({
      data: {
        userId: user.id, planId, date: new Date("2027-01-03"), scorePercent: 50,
        topicScores: { create: [{ topicId: reading.topicId, answered: 10, correct: 5 }] },
      },
    });

    const h = await readJson(await get(user, planId, reading.topicId));
    const mod = h.modules.find((m: any) => m.readingId === readingId);
    const s2 = mod.steps[1];
    expect(s2.status).toBe("in-progress");
    expect(s2.questions).toMatchObject({ n: 20, answered: 20, correct: 10, passed: false });
    expect(s2.questions.q).toBeGreaterThan(0);
    expect(s2.records).toHaveLength(1);
    expect(s2.records[0]).toMatchObject({
      type: "task", id: t.id, date: "2027-01-04", kind: "questions", step: 2, round: 1, status: "done",
      offPlan: false, answered: 20, correct: 10, confidence: 4, note: "hard", answerReviewDone: true,
    });
    expect(Array.isArray(s2.records[0].materials)).toBe(true);
    expect(mod.steps[0].records).toHaveLength(1);
    expect(mod.steps[0].records[0]).toMatchObject({ type: "declaration", step: 1, confidence: 5, date: "2027-01-02" });
    expect(h.mocks).toHaveLength(1);
    expect(h.mocks[0]).toMatchObject({ date: "2027-01-03", scorePercent: 50, answered: 10, correct: 5 });
  });
});
