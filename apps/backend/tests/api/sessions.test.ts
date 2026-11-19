import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { authedRequest, registerUser, setupPlanWithCatalogue } from "../helpers/fixtures";
import { POST } from "../../src/app/api/plans/[id]/sessions/route";

// The catalogue plan starts 2027-01-04; pin the clock a day later so both
// days are loggable and "the future" is fixed.
const TODAY = new Date("2027-01-05T15:00:00Z");

async function setup() {
  const { planId } = await setupPlanWithCatalogue();
  const user = await registerUser();
  await db.studyPlan.update({ where: { id: planId }, data: { userId: user.id, timeZone: "UTC" } });
  const reading = await db.reading.findFirstOrThrow({ where: { topic: { levelId: "II" } }, orderBy: { order: "asc" } });
  const los = await Promise.all(
    [1, 2].map((order) => db.lOS.create({ data: { readingId: reading.id, text: `Outcome ${order}`, order } })),
  );
  const pkg = await db.studyPackage.findFirstOrThrow({ where: { slug: "test-schedule-catalogue" } });
  return { planId, user, reading, losIds: los.map((l) => l.id), pkg };
}

function post(user: Awaited<ReturnType<typeof registerUser>>, planId: string, body: unknown) {
  return POST(authedRequest(user, `/api/plans/${planId}/sessions`, body));
}

const base = (readingId: string) => ({ readingId, kind: "content-video", minutes: 35, confidence: 4 });

describe("POST /api/plans/:id/sessions", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TODAY);
  });
  afterEach(() => vi.useRealTimers());

  test("a session off the plan becomes a finished off-plan cell with its outcome logs", async () => {
    const { planId, user, reading, losIds, pkg } = await setup();
    const res = await post(user, planId, { ...base(reading.id), packageId: pkg.id, note: "ch 1" });
    expect(res.status).toBe(201);
    const { task } = await readJson(res);

    const row = await db.planTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({
      status: "done",
      frozen: true,
      insertedBecause: "off-plan",
      kind: "content-video",
      readingIds: [reading.id],
      estimatedMinutes: 35,
      actualMinutes: 35,
      packageId: pkg.id,
    });
    expect(row.order).toBeGreaterThanOrEqual(100);
    expect(row.date.toISOString().slice(0, 10)).toBe("2027-01-05");

    const logs = await db.studyLogEntry.findMany({ where: { taskId: row.id } });
    expect(logs.map((l) => l.losId).sort()).toEqual([...losIds].sort());
    expect(logs.every((l) => l.confidence === 4)).toBe(true);
  });

  test("two sessions on one day get distinct slots", async () => {
    const { planId, user, reading } = await setup();
    expect((await post(user, planId, base(reading.id))).status).toBe(201);
    expect((await post(user, planId, { ...base(reading.id), kind: "review" })).status).toBe(201);
    const orders = (await db.planTask.findMany({ where: { planId, insertedBecause: "off-plan" } })).map((t) => t.order);
    expect(new Set(orders).size).toBe(2);
  });

  test("a session against a planned cell records that cell instead", async () => {
    const { planId, user, reading } = await setup();
    const cell = await db.planTask.create({
      data: { planId, date: new Date("2027-01-05T00:00:00Z"), order: 0, kind: "content-video", readingIds: [reading.id], estimatedMinutes: 40 },
    });
    const res = await post(user, planId, { ...base(reading.id), taskId: cell.id, finished: false, minutes: 20 });
    expect(res.status).toBe(201);
    const row = await db.planTask.findUniqueOrThrow({ where: { id: cell.id } });
    expect(row.status).toBe("partial");
    expect(row.actualMinutes).toBe(20);
    expect(await db.planTask.count({ where: { planId, insertedBecause: "off-plan" } })).toBe(0);
  });

  test("a planned cell for another reading is refused", async () => {
    const { planId, user, reading } = await setup();
    const other = await db.reading.findFirstOrThrow({ where: { topic: { levelId: "II" }, id: { not: reading.id } } });
    const cell = await db.planTask.create({
      data: { planId, date: new Date("2027-01-05T00:00:00Z"), order: 0, kind: "content-video", readingIds: [other.id], estimatedMinutes: 40 },
    });
    expect((await post(user, planId, { ...base(reading.id), taskId: cell.id })).status).toBe(400);
  });

  test("someone else's plan is forbidden", async () => {
    const { planId, reading } = await setup();
    const stranger = await registerUser();
    expect((await post(stranger, planId, base(reading.id))).status).toBe(403);
  });

  test.each([
    ["an unknown kind", { kind: "nap" }],
    ["zero minutes", { minutes: 0 }],
    ["more correct than answered", { kind: "questions", questionsAnswered: 5, questionsCorrect: 6 }],
    ["a future date", { date: "2027-01-06" }],
    ["a date before the plan", { date: "2027-01-03" }],
  ])("%s is refused", async (_label, patch) => {
    const { planId, user, reading } = await setup();
    expect((await post(user, planId, { ...base(reading.id), ...patch })).status).toBe(400);
  });

  test("a reading from another level is refused", async () => {
    const { planId, user } = await setup();
    await db.level.upsert({ where: { id: "I" }, create: { id: "I", version: "t" }, update: {} });
    const topic = await db.topic.create({ data: { levelId: "I", name: "Other", order: 99, examWeightMin: 1, examWeightMax: 2 } });
    const foreign = await db.reading.create({ data: { topicId: topic.id, name: "Foreign", order: 1 } });
    expect((await post(user, planId, base(foreign.id))).status).toBe(400);
  });

  test("question numbers are stored on the off-plan cell; invalid ones are rejected", async () => {
    const { planId, user, reading, losIds } = await setup();
    const res = await post(user, planId, { ...base(reading.id), kind: "questions", questionNumbers: [3, 1, 3] });
    expect(res.status).toBe(201);
    const id = (await readJson(res)).task.id;
    expect((await db.planTask.findUniqueOrThrow({ where: { id } })).questionNumbers).toEqual([1, 3]);
    const logs = await db.studyLogEntry.findMany({ where: { taskId: id, losId: { in: losIds } } });
    expect(logs.reduce((n, l) => n + l.questionsAnswered, 0)).toBe(2);
    expect((await post(user, planId, { ...base(reading.id), questionNumbers: [0] })).status).toBe(400);
  });
});
