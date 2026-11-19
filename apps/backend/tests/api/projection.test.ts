import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { addQuestionBank, authedRequest, registerUser, setupPlanWithCatalogue } from "../helpers/fixtures";
import { GET } from "../../src/app/api/plans/[id]/projection/route";
import { generateHorizon } from "../../src/lib/FUNC-schedule";
import { PATCH as PATCH_TASK } from "../../src/app/api/plans/[id]/tasks/[taskId]/route";
import { POST as POST_DECL } from "../../src/app/api/plans/[id]/declarations/route";

async function ownedPlan() {
  const { planId } = await setupPlanWithCatalogue();
  const user = await registerUser();
  await db.studyPlan.update({
    where: { id: planId },
    data: {
      userId: user.id, examDate: new Date("2027-04-01"),
      weeklyAvailability: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 8, sun: 8 },
    },
  });
  await generateHorizon(planId, "2027-01-04");
  return { planId, user };
}

const get = (user: Awaited<ReturnType<typeof registerUser>>, planId: string) =>
  GET(authedRequest(user, `/api/plans/${planId}/projection`));

describe("GET /api/plans/:id/projection", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-04T09:00:00Z"));
  });

  test("a fresh plan projects zero readiness, one section per topic and a planned horizon", async () => {
    const { planId, user } = await ownedPlan();
    const res = await get(user, planId);
    expect(res.status).toBe(200);
    const p = await readJson(res);
    expect(p.asOf).toBe("2027-01-04");
    expect(p.exam).toBe("2027-04-01");
    expect(typeof p.gate).toBe("string");
    expect(p.readiness).toBe(0);
    expect(p.readinessPlanToday).toBe(0);
    expect(p.fit.feasible).toBe(true);
    expect(p.sections).toHaveLength(3);
    for (const s of p.sections) {
      expect(s.steps.map((x: any) => x.step)).toEqual([1, 2, 3, 4]);
      expect(s.modules).toHaveLength(2);
      expect(s.performance.initial).toBeNull();
      expect(s.performance.extras).toEqual({ tasks: 0, minutes: 0 });
    }
    expect(p.sections[0].steps[0].plannedMin).toBeGreaterThan(0);
    expect(p.sections[0].steps[0].donePassedMin).toBe(0);
    const planned = p.daily.filter((d: any) => d.plannedMin > 0);
    expect(planned.length).toBeGreaterThanOrEqual(14);
    expect(JSON.stringify(p)).not.toContain("NaN");
    expect(p.mocks.done).toBe(0);
    expect(p.rules.accuracyTarget).toBe(80);
    const t = p.totals;
    expect(t.requiredMin).toBeGreaterThan(0);
    expect(t.doneMin).toBe(0);
    expect(t.leftMin).toBe(t.requiredMin);
    expect(Object.values(t.byStep).reduce((a: number, x: any) => a + x.requiredMin, 0)).toBe(t.requiredMin);
    expect(t.questions.answered).toBe(0);
    expect(t.questions.required).toBe(p.sections.reduce((a: number, s: any) => a + s.questions.required, 0));
    expect(t.daysLeft).toBeGreaterThan(0);
    expect(t.minPerDayNeeded).toBeGreaterThan(0);
    expect(t.minPerDayAvailable).toBeGreaterThanOrEqual(0);
  });

  test("another user's plan is a 404", async () => {
    const { planId } = await ownedPlan();
    const intruder = await registerUser();
    expect((await get(intruder, planId)).status).toBe(404);
  });

  test("credited minutes show as doneMin and past days keep their frozen plan", async () => {
    const { planId, user } = await ownedPlan();
    const t = await db.planTask.findFirstOrThrow({ where: { planId }, orderBy: [{ date: "asc" }, { order: "asc" }] });
    await db.planTask.update({ where: { id: t.id }, data: { status: "done", actualMinutes: t.estimatedMinutes } });
    vi.setSystemTime(new Date("2027-01-06T09:00:00Z"));
    await generateHorizon(planId, "2027-01-06");
    const p = await readJson(await get(user, planId));
    const day = p.daily.find((d: any) => d.date === "2027-01-04");
    expect(day.doneMin).toBe(t.estimatedMinutes);
    expect(day.plannedMin).toBeGreaterThanOrEqual(t.estimatedMinutes);
    expect(p.daily[0].date).toBe("2027-01-04");
  });

  test("holidays are listed with their cancelled flag from the fit", async () => {
    const { planId, user } = await ownedPlan();
    const h = await db.planHoliday.create({
      data: { planId, startDate: new Date("2027-02-01"), endDate: new Date("2027-02-03") },
    });
    const p = await readJson(await get(user, planId));
    expect(p.holidays).toEqual([{ id: h.id, start: "2027-02-01", end: "2027-02-03", cancelled: false }]);
  });

  test("a rebuild invalidates the cached projection", async () => {
    const { planId, user } = await ownedPlan();
    const a = await readJson(await get(user, planId));
    await db.planHoliday.create({
      data: { planId, startDate: new Date("2027-02-01"), endDate: new Date("2027-02-03") },
    });
    await generateHorizon(planId, "2027-01-04");
    const b = await readJson(await get(user, planId));
    expect(a.holidays).toHaveLength(0);
    expect(b.holidays).toHaveLength(1);
  });

  test("a recorded step 2 task shows in that module's performance with passed false", async () => {
    const { planId, user } = await ownedPlan();
    const reading = await db.reading.findFirstOrThrow({ where: { topic: { levelId: "II" } }, orderBy: { name: "asc" } });
    const los = await db.lOS.findFirst({ where: { readingId: reading.id } })
      ?? await db.lOS.create({ data: { readingId: reading.id, text: "Outcome", order: 1 } });
    const task = await db.planTask.create({
      data: {
        planId, date: new Date("2027-01-04T00:00:00Z"), order: 99, kind: "questions", step: 2, round: 1,
        readingIds: [reading.id], estimatedMinutes: 60, actualMinutes: 60, status: "done",
      },
    });
    await db.studyLogEntry.create({
      data: { userId: user.id, planId, losId: los.id, confidence: 3, questionsAnswered: 24, questionsCorrect: 12, taskId: task.id },
    });
    const p = await readJson(await get(user, planId));
    const mod = p.sections.flatMap((s: any) => s.modules).find((m: any) => m.readingId === reading.id);
    expect(mod.performance.s2).toMatchObject({ answered: 24, correct: 12, passed: false });
    expect(mod.performance.s2.adequateMin).toBeGreaterThan(0);
    expect(mod.performance.s4).toBeNull();
  });

  test("extras: none on a fresh plan, and only the top-up after a 50% step 2 record", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await addQuestionBank({ questionsPerUnit: 200 });
    const user = await registerUser();
    await db.studyPlan.update({
      where: { id: planId },
      data: { userId: user.id, examDate: new Date("2027-04-01"), weeklyAvailability: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 8, sun: 8 } },
    });
    await generateHorizon(planId, "2027-01-04");
    expect((await readJson(await get(user, planId))).extras).toEqual([]);

    const t = await db.planTask.findFirstOrThrow({ where: { planId, date: new Date("2027-01-04") }, orderBy: { order: "asc" } });
    await db.planTask.update({
      where: { id: t.id },
      data: { kind: "questions", step: 2, round: 1, questionCount: 20, estimatedMinutes: 60, workMinutes: 60 },
    });
    await db.lOS.create({ data: { readingId: t.readingIds[0]!, text: "Outcome", order: 1 } });
    await PATCH_TASK(authedRequest(user, `/api/plans/${planId}/tasks/${t.id}`, {
      status: "done", confidence: 3, questionsAnswered: 20, questionsCorrect: 10, answerReviewDone: true,
    }, "PATCH"));
    const p = await readJson(await get(user, planId));
    expect(p.extras.length).toBeGreaterThan(0);
    for (const e of p.extras) expect(["top-up-80", "top-up-adequacy"]).toContain(e.reason);
    expect(new Set(p.extras.map((e: any) => e.reason)).size).toBe(1);
  });

  test("an edited declaration is not served from the cache", async () => {
    const { planId, user } = await ownedPlan();
    const r = (await db.reading.findFirstOrThrow({ where: { topic: { levelId: "II" } }, orderBy: { name: "asc" } })).id;
    const post = (items: unknown[]) =>
      POST_DECL(authedRequest(user, `/api/plans/${planId}/declarations`, { items }));
    await post([{ readingId: r, step: 1 }, { readingId: r, step: 2, answered: 10, correct: 5 }]);
    const mod = (p: any) => p.sections.flatMap((s: any) => s.modules).find((m: any) => m.readingId === r);
    const before = mod(await readJson(await get(user, planId)));
    expect(before.performance.s2.correct).toBe(5);
    await post([{ readingId: r, step: 2, answered: 10, correct: 9 }]);
    const after = mod(await readJson(await get(user, planId)));
    expect(after.performance.s2.correct).toBe(9);
  });

  test("concurrent replans of one plan serialize instead of colliding", async () => {
    const { planId } = await ownedPlan();
    vi.setSystemTime(new Date("2027-01-05T09:00:00Z"));
    await Promise.all([1, 2, 3].map(() => generateHorizon(planId, "2027-01-05")));
    const rows = await db.planTask.findMany({ where: { planId, date: { gte: new Date("2027-01-05") } } });
    const slots = rows.map((r) => `${r.date.getTime()}|${r.order}`);
    expect(new Set(slots).size).toBe(slots.length);
  });
  test("question stats: adequateQ, perQ, extraPendingQ and per-module totals", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await addQuestionBank({ questionsPerUnit: 200 });
    const user = await registerUser();
    await db.studyPlan.update({
      where: { id: planId },
      data: { userId: user.id, examDate: new Date("2027-04-01"), weeklyAvailability: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 8, sun: 8 } },
    });
    await generateHorizon(planId, "2027-01-04");
    const t = await db.planTask.findFirstOrThrow({ where: { planId, date: new Date("2027-01-04") }, orderBy: { order: "asc" } });
    const readingId = t.readingIds[0]!;
    await db.planTask.update({
      where: { id: t.id },
      data: { kind: "questions", step: 2, round: 1, questionCount: 20, estimatedMinutes: 60, workMinutes: 60 },
    });
    await db.lOS.create({ data: { readingId, text: "Outcome", order: 1 } });
    await PATCH_TASK(authedRequest(user, `/api/plans/${planId}/tasks/${t.id}`, {
      status: "done", confidence: 3, questionsAnswered: 20, questionsCorrect: 10, answerReviewDone: true,
    }, "PATCH"));
    const p = await readJson(await get(user, planId));
    const mods = p.sections.flatMap((s: any) => s.modules);
    const mod = mods.find((m: any) => m.readingId === readingId);
    const s2 = mod.performance.s2;
    expect(s2.perQ).toBeGreaterThan(0);
    expect(s2.adequateQ).toBe(Math.ceil(s2.adequateMin / s2.perQ - 1e-9));
    expect(s2.extraPendingQ).toBeGreaterThan(0);
    expect(mod.totals).toEqual({ answered: 20, correct: 10, mockAnswered: 0, mockCorrect: 0 });
    expect(mods.find((m: any) => m.readingId !== readingId).totals.answered).toBe(0);
  });
  test("s2 and s4 are present from the start when the step has questions, and stated work counts as done on its date", async () => {
    const { planId, user } = await ownedPlan();
    await addQuestionBank({ questionsPerUnit: 200 });
    const p0 = await readJson(await get(user, planId));
    const m0 = p0.sections.flatMap((s: any) => s.modules)[0];
    expect(m0.performance.s2).toMatchObject({ answered: 0, passed: false });
    expect(m0.performance.s2.adequateQ).toBeGreaterThan(0);
    expect(m0.performance.s4).not.toBeNull();

    const r = (await db.reading.findFirstOrThrow({ where: { topic: { levelId: "II" } }, orderBy: { name: "asc" } })).id;
    await POST_DECL(authedRequest(user, `/api/plans/${planId}/declarations`, {
      items: [{ readingId: r, step: 1, date: "2027-01-02" }],
    }));
    const p1 = await readJson(await get(user, planId));
    const day = p1.daily.find((d: any) => d.date === "2027-01-02");
    expect(day?.doneMin).toBeGreaterThan(0);
  });
});
