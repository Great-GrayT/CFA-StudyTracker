import { beforeEach, describe, test, expect } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import {
  addQuestionBank,
  registerUser,
  setupPlanWithCatalogue,
} from "../helpers/fixtures";
import { POST as POST_PRIOR_WORK } from "../../src/app/api/plans/[id]/prior-work/route";
import { generateHorizon } from "../../src/lib/FUNC-schedule";

function priorWorkRequest(planId: string, token: string, body: unknown): Request {
  return new Request(`http://localhost/api/plans/${planId}/prior-work`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/** A catalogue plan with learning outcomes, owned by the token holder. */
async function ownedPlan(): Promise<{
  planId: string;
  token: string;
  topicId: string;
  topicName: string;
}> {
  const { planId } = await setupPlanWithCatalogue();
  await addQuestionBank();

  // The catalogue fixture seeds readings but no outcomes, and prior work is
  // recorded against outcomes, so give every reading one.
  const readings = await db.reading.findMany({ include: { topic: true } });
  for (const reading of readings) {
    const existing = await db.lOS.count({ where: { readingId: reading.id } });
    if (existing === 0) {
      await db.lOS.create({
        data: { readingId: reading.id, text: `Outcome for ${reading.name}`, order: 1 },
      });
    }
  }

  const user = await registerUser();
  await db.studyPlan.updateMany({ where: {}, data: { isActive: false } });
  await db.studyPlan.update({
    where: { id: planId },
    data: { userId: user.id, isActive: true },
  });

  const first = readings[0];
  return {
    planId,
    token: user.token,
    topicId: first.topicId,
    topicName: first.topic.name,
  };
}

describe("prior work declared at onboarding", () => {
  beforeEach(async () => {
    await resetDb();
  });

  test("declared work becomes selfDeclared log rows against that area's outcomes", async () => {
    const { planId, token, topicId } = await ownedPlan();
    const res = await POST_PRIOR_WORK(
      priorWorkRequest(planId, token, {
        declarations: [
          { topicId, read: true, questionsAnswered: 120, accuracyPercent: 70 },
        ],
      }),
    );
    expect(res.status).toBe(201);

    const rows = await db.studyLogEntry.findMany({ where: { planId } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.selfDeclared)).toBe(true);
    expect(rows.reduce((sum, r) => sum + r.questionsAnswered, 0)).toBe(120);
    expect(rows.reduce((sum, r) => sum + r.questionsCorrect, 0)).toBe(84);
  });

  test("declared work is distinguishable from work logged as it happened", async () => {
    const { planId, token, topicId } = await ownedPlan();
    await POST_PRIOR_WORK(
      priorWorkRequest(planId, token, {
        declarations: [
          { topicId, read: true, questionsAnswered: 120, accuracyPercent: 70 },
        ],
      }),
    );

    const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
    const los = await db.lOS.findFirstOrThrow();
    await db.studyLogEntry.create({
      data: {
        userId: plan.userId,
        planId,
        losId: los.id,
        confidence: 4,
        questionsAnswered: 10,
        questionsCorrect: 8,
      },
    });

    const rows = await db.studyLogEntry.findMany({ where: { planId } });
    expect(new Set(rows.map((r) => r.selfDeclared))).toEqual(new Set([true, false]));
  });

  test("an accuracy outside 0 to 100 is rejected", async () => {
    const { planId, token, topicId } = await ownedPlan();
    const res = await POST_PRIOR_WORK(
      priorWorkRequest(planId, token, {
        declarations: [
          { topicId, read: true, questionsAnswered: 10, accuracyPercent: 140 },
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect(await db.studyLogEntry.count({ where: { planId } })).toBe(0);
  });

  test("declaring reading only, with no questions, still records the reading", async () => {
    const { planId, token, topicId } = await ownedPlan();
    const res = await POST_PRIOR_WORK(
      priorWorkRequest(planId, token, {
        declarations: [
          { topicId, read: true, questionsAnswered: 0, accuracyPercent: null },
        ],
      }),
    );
    expect(res.status).toBe(201);

    const rows = await db.studyLogEntry.findMany({ where: { planId } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.questionsAnswered === 0)).toBe(true);
    expect(rows.every((r) => r.declaredRead)).toBe(true);
  });

  test("declaring questions without reading records the practice and not the reading", async () => {
    const { planId, token, topicId } = await ownedPlan();
    await POST_PRIOR_WORK(
      priorWorkRequest(planId, token, {
        declarations: [
          { topicId, read: false, questionsAnswered: 60, accuracyPercent: 40 },
        ],
      }),
    );
    const rows = await db.studyLogEntry.findMany({ where: { planId } });
    expect(rows.every((r) => r.declaredRead)).toBe(false);
    expect(rows.reduce((sum, r) => sum + r.questionsAnswered, 0)).toBe(60);
  });

  test("declaring nothing at all is accepted and writes nothing", async () => {
    const { planId, token } = await ownedPlan();
    const res = await POST_PRIOR_WORK(priorWorkRequest(planId, token, { declarations: [] }));
    expect(res.status).toBe(201);
    expect(await db.studyLogEntry.count({ where: { planId } })).toBe(0);
  });

  test("an unknown topic is rejected rather than silently ignored", async () => {
    const { planId, token } = await ownedPlan();
    const res = await POST_PRIOR_WORK(
      priorWorkRequest(planId, token, {
        declarations: [
          { topicId: "not-a-topic", read: true, questionsAnswered: 10, accuracyPercent: 50 },
        ],
      }),
    );
    expect(res.status).toBe(400);
  });

  test("another user cannot declare work on a plan that is not theirs", async () => {
    const { planId, topicId } = await ownedPlan();
    const intruder = await registerUser();
    const res = await POST_PRIOR_WORK(
      priorWorkRequest(planId, intruder.token, {
        declarations: [
          { topicId, read: true, questionsAnswered: 10, accuracyPercent: 50 },
        ],
      }),
    );
    expect(res.status).toBe(403);
    expect(await db.studyLogEntry.count({ where: { planId } })).toBe(0);
  });

  test("re-declaring replaces the previous declaration rather than doubling it", async () => {
    const { planId, token, topicId } = await ownedPlan();
    const body = {
      declarations: [{ topicId, read: true, questionsAnswered: 100, accuracyPercent: 50 }],
    };
    await POST_PRIOR_WORK(priorWorkRequest(planId, token, body));
    await POST_PRIOR_WORK(priorWorkRequest(planId, token, body));

    const rows = await db.studyLogEntry.findMany({ where: { planId } });
    expect(rows.reduce((sum, r) => sum + r.questionsAnswered, 0)).toBe(100);
  });

  // The reason this intake exists: a candidate who arrives having already read
  // a topic area should get question-only days for it, not be told to read it
  // again.
  test("a declared reading yields question-only days for that material", async () => {
    const { planId, token, topicId } = await ownedPlan();
    await POST_PRIOR_WORK(
      priorWorkRequest(planId, token, {
        declarations: [{ topicId, read: true, questionsAnswered: 0, accuracyPercent: null }],
      }),
    );
    await generateHorizon(planId, "2027-01-04");

    const declaredReadings = await db.reading.findMany({
      where: { topicId },
      select: { id: true },
    });
    const declaredIds = new Set(declaredReadings.map((r) => r.id));

    const tasks = await db.planTask.findMany({
      where: { planId },
      orderBy: [{ date: "asc" }, { order: "asc" }],
    });
    const forDeclared = tasks.filter((t) => declaredIds.has(t.readingIds[0] ?? ""));

    expect(forDeclared.length).toBeGreaterThan(0);
    const practice = new Set(["questions", "answer-review", "eocq"]);
    expect(forDeclared.every((t) => practice.has(t.kind))).toBe(true);
  });
});
