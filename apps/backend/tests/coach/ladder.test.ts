// The message ladder end to end: how many sends a day earns, and that a retry or
// a recomputed list never sends twice.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { authedRequest, registerUser, setupPlanWithTasks } from "../helpers/fixtures";
import { runCoachForPlan } from "../../src/lib/FUNC-coach";

const projection = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../../src/lib/FUNC-projection", () => ({
  getProjection: vi.fn(async () => {
    if (!projection.value) throw new Error("no projection");
    return projection.value;
  }),
}));
vi.mock("../../src/lib/FUNC-mail", async (orig) => ({
  ...(await orig<typeof import("../../src/lib/FUNC-mail")>()),
  mailConfigured: () => true,
  sendMail: vi.fn(async () => undefined),
}));
import { GET, POST } from "../../src/app/api/coach/preview/route";

const day = (date: string, plannedMin: number, doneMin: number) => ({ date, plannedMin, doneMin });

function behind(days: number, over: Record<string, unknown> = {}) {
  const past = Array.from({ length: days }, (_, i) => day(`2026-12-${String(20 + i).padStart(2, "0")}`, 120, 0));
  return {
    asOf: "2027-01-04",
    fit: { feasible: true, belowPass: false },
    sections: [{ modules: [{ name: "Ethics", windows: [{ step: 1, status: "overdue" }] }] }],
    daily: [...past, day("2027-01-04", 120, 0)],
    extras: [],
    readiness: 0.3,
    readinessPlanToday: 0.45,
    ...over,
  };
}

describe("the ladder", () => {
  beforeEach(async () => {
    await resetDb();
    process.env.FRONTEND_BASE_URL = "https://app.test";
    projection.value = null;
  });

  test("five days behind sends eight messages on a normal day, once each", async () => {
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    projection.value = behind(5);
    const late = new Date("2027-01-04T23:00:00Z");
    const first = await runCoachForPlan(planId, late);
    expect(first.sent).toHaveLength(8);
    expect(first.sent.filter((s) => s.startsWith("extra-"))).toHaveLength(5);
    const rows = await db.emailSend.findMany({ where: { planId, channel: "email" } });
    expect(rows.filter((r) => r.dialogueKey?.startsWith("X_BEHIND_3"))).toHaveLength(5);

    const again = await runCoachForPlan(planId, new Date("2027-01-04T23:30:00Z"));
    expect(again.sent).toEqual([]);
  });

  test("extras only go out once their seeded time has passed", async () => {
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    projection.value = behind(5);
    const morning = await runCoachForPlan(planId, new Date("2027-01-04T07:00:00Z"));
    expect(morning.sent).toEqual(["prescription"]);
  });

  test("no projection reads as on plan: the three anchors only", async () => {
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    const out = await runCoachForPlan(planId, new Date("2027-01-04T23:00:00Z"));
    expect(out.sent).toEqual(["prescription", "nudge", "debrief"]);
  });

  test("an infeasible plan without consent gets the does-not-fit debrief", async () => {
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    projection.value = behind(0, { fit: { feasible: false, belowPass: true } });
    await runCoachForPlan(planId, new Date("2027-01-04T23:00:00Z"));
    const debrief = await db.emailSend.findFirst({ where: { planId, slot: "debrief", channel: "email" } });
    expect(debrief?.dialogueKey).toBe("D_PLAN_DOES_NOT_FIT");
  });

  test("an email debrief-only preference still gets only the debrief", async () => {
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    await db.studyPlan.update({ where: { id: planId }, data: { emailCoach: "debrief-only" } });
    projection.value = behind(5);
    const out = await runCoachForPlan(planId, new Date("2027-01-04T23:00:00Z"));
    expect(out.sent).toEqual(["debrief"]);
  });

  test("the preview shows the day's slot list with times and the new events", async () => {
    const { planId } = await setupPlanWithTasks();
    const user = await registerUser();
    await db.studyPlan.updateMany({ where: {}, data: { isActive: false } });
    await db.studyPlan.update({ where: { id: planId }, data: { userId: user.id, isActive: true } });
    projection.value = behind(5);
    const body = await readJson(await POST(authedRequest(user, "/api/coach/preview", { slot: "extra-1" })));
    expect(body.daySlots).toHaveLength(8);
    expect(body.daySlots[0]).toEqual({ slot: "prescription", time: "06:30" });
    expect(body.key).toBe("X_BEHIND_3");
    const events = (await readJson(await GET(authedRequest(user, "/api/coach/preview")))).events;
    expect(events.extra).toContain("X_BEHIND_7");
    expect(events.midday).toEqual(["M_MIDDAY_MOCK"]);
  });
});
