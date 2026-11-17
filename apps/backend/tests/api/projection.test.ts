import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { authedRequest, registerUser, setupPlanWithCatalogue } from "../helpers/fixtures";
import { GET } from "../../src/app/api/plans/[id]/projection/route";
import { generateHorizon } from "../../src/lib/FUNC-schedule";

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
});
