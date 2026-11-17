import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { authedRequest, registerUser, setupPlanWithCatalogue } from "../helpers/fixtures";
import { POST } from "../../src/app/api/plans/[id]/declarations/route";
import { DELETE } from "../../src/app/api/plans/[id]/declarations/[readingId]/[step]/route";
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

  test("a repeat that omits a field keeps the stored value and validates the merged row", async () => {
    const { planId, user, r } = await setup();
    await post(user, planId, { items: [{ readingId: r[0], step: 1 }, { readingId: r[0], step: 2, answered: 10, correct: 6 }] });
    await post(user, planId, { items: [{ readingId: r[0], step: 2, correct: 8 }] });
    const row = await db.stepDeclaration.findFirstOrThrow({ where: { planId, readingId: r[0], step: 2 } });
    expect([row.answered, row.correct]).toEqual([10, 8]);
    const bad = await post(user, planId, { items: [{ readingId: r[0], step: 2, correct: 11 }] });
    expect(bad.status).toBe(400);
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

describe("DELETE /api/plans/:id/declarations/:readingId/:step", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-04T09:00:00Z"));
  });
  const del = (user: any, planId: string, readingId: string, step: number) =>
    DELETE(authedRequest(user, `/api/plans/${planId}/declarations/${readingId}/${step}`, undefined, "DELETE"));

  test("removes a declaration and the module's step 1 is owed again", async () => {
    const { planId, user, r } = await setup();
    await post(user, planId, { items: [{ readingId: r[0], step: 1, confidence: 5 }] });
    const res = await del(user, planId, r[0]!, 1);
    expect(res.status).toBe(200);
    expect(await db.stepDeclaration.count({ where: { planId } })).toBe(0);
    const owed = await db.planTask.findMany({ where: { planId, step: 1 } });
    expect(owed.some((t) => t.readingIds.includes(r[0]!))).toBe(true);
  });

  test("step 1 is refused while a step 3 exists, step 2 while a step 4 exists", async () => {
    const { planId, user, r } = await setup();
    await post(user, planId, { items: [{ readingId: r[0], step: 1 }, { readingId: r[0], step: 3 }] });
    const a = await del(user, planId, r[0]!, 1);
    expect(a.status).toBe(400);
    expect((await readJson(a)).error).toBe("Remove the review first");
    await post(user, planId, { items: [{ readingId: r[1], step: 2, answered: 10, correct: 8 }, { readingId: r[1], step: 4, answered: 5, correct: 4 }] });
    const b = await del(user, planId, r[1]!, 2);
    expect(b.status).toBe(400);
    expect((await readJson(b)).error).toBe("Remove the review questions first");
    expect(await db.stepDeclaration.count({ where: { planId } })).toBe(4);
  });

  test("another user's plan is a 404", async () => {
    const { planId, user, r } = await setup();
    await post(user, planId, { items: [{ readingId: r[0], step: 1 }] });
    const intruder = await registerUser();
    expect((await del(intruder, planId, r[0]!, 1)).status).toBe(404);
    expect(await db.stepDeclaration.count({ where: { planId } })).toBe(1);
  });
});
