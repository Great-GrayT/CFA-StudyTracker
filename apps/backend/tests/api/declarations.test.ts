import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { authedRequest, registerUser, setupPlanWithCatalogue } from "../helpers/fixtures";
import { POST } from "../../src/app/api/plans/[id]/declarations/route";
import { generateHorizon } from "../../src/lib/FUNC-schedule";

async function setup() {
  const { planId } = await setupPlanWithCatalogue();
  const user = await registerUser();
  await db.studyPlan.update({ where: { id: planId }, data: { userId: user.id } });
  const readings = await db.reading.findMany({ where: { topic: { levelId: "II" } }, orderBy: { name: "asc" } });
  return { planId, user, r: readings.map((x) => x.id) };
}
const post = (user: any, planId: string, body: unknown) =>
  POST(authedRequest(user, `/api/plans/${planId}/declarations`, body));

describe("POST /api/plans/:id/declarations", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-04T09:00:00Z"));
  });

  test("stores declarations and replaces on repeat", async () => {
    const { planId, user, r } = await setup();
    const res = await post(user, planId, { items: [{ readingId: r[0], step: 1, confidence: 4 }] });
    expect(res.status).toBe(201);
    await post(user, planId, { items: [{ readingId: r[0], step: 1, confidence: 5 }] });
    const rows = await db.stepDeclaration.findMany({ where: { planId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.confidence).toBe(5);
  });

  test("review before the first read is rejected", async () => {
    const { planId, user, r } = await setup();
    const res = await post(user, planId, { items: [{ readingId: r[0], step: 3 }] });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe("Review needs the first read first");
  });

  test("review questions before the initial questions are rejected", async () => {
    const { planId, user, r } = await setup();
    const res = await post(user, planId, { items: [{ readingId: r[0], step: 4, answered: 10, correct: 8 }] });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe("Review questions need the initial questions first");
  });

  test("the pair in one request, or an existing earlier step, is accepted", async () => {
    const { planId, user, r } = await setup();
    expect((await post(user, planId, { items: [{ readingId: r[0], step: 3 }, { readingId: r[0], step: 1 }] })).status).toBe(201);
    await post(user, planId, { items: [{ readingId: r[1], step: 2, answered: 10, correct: 8 }] });
    expect((await post(user, planId, { items: [{ readingId: r[1], step: 4, answered: 5, correct: 4 }] })).status).toBe(201);
  });

  test("correct above answered and unknown readings are rejected", async () => {
    const { planId, user, r } = await setup();
    expect((await post(user, planId, { items: [{ readingId: r[0], step: 2, answered: 3, correct: 4 }] })).status).toBe(400);
    expect((await post(user, planId, { items: [{ readingId: "nope", step: 1 }] })).status).toBe(400);
  });

  test("a declared first read removes that module's step 1 from the horizon", async () => {
    const { planId, user, r } = await setup();
    await generateHorizon(planId, "2027-01-04");
    expect((await db.planTask.findMany({ where: { planId, step: 1 } })).some((t) => t.readingIds.includes(r[0]!))).toBe(true);
    await post(user, planId, { items: [{ readingId: r[0], step: 1, confidence: 5 }] });
    const owed = await db.planTask.findMany({ where: { planId, step: 1 } });
    expect(owed.some((t) => t.readingIds.includes(r[0]!))).toBe(false);
  });

  test("another user's plan is a 404", async () => {
    const { planId, r } = await setup();
    const intruder = await registerUser();
    expect((await post(intruder, planId, { items: [{ readingId: r[0], step: 1 }] })).status).toBe(404);
  });
});
