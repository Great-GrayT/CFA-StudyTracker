// The coach's three daily times are the candidate's to set.
import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { authedRequest, registerUser, setupPlanWithTasks } from "../helpers/fixtures";
import { PATCH } from "../../src/app/api/plans/[id]/route";
import { runCoachForPlan } from "../../src/lib/FUNC-coach";
import type { Mail } from "../../src/lib/FUNC-mail";

async function ownedPlan() {
  const { planId } = await setupPlanWithTasks();
  const user = await registerUser();
  await db.studyPlan.update({ where: { id: planId }, data: { userId: user.id } });
  return { planId, user };
}

describe("coach schedule", () => {
  beforeEach(resetDb);

  test("a valid schedule is saved; out of order or malformed is refused; null resets", async () => {
    const { planId, user } = await ownedPlan();
    const patch = (body: unknown) => PATCH(authedRequest(user, `/api/plans/${planId}`, body, "PATCH"));

    const times = { prescription: "05:45", nudge: "18:00", debrief: "21:15" };
    expect((await patch({ coachSchedule: times })).status).toBe(200);
    expect((await db.studyPlan.findUniqueOrThrow({ where: { id: planId } })).coachSchedule).toEqual(times);

    expect((await patch({ coachSchedule: { ...times, nudge: "22:00" } })).status).toBe(400);
    expect((await patch({ coachSchedule: { ...times, debrief: "9:00" } })).status).toBe(400);

    expect((await patch({ coachSchedule: null })).status).toBe(200);
    expect((await db.studyPlan.findUniqueOrThrow({ where: { id: planId } })).coachSchedule).toBeNull();
  });

  test("the coach runs a slot at the candidate's time, not the default", async () => {
    const { planId } = await ownedPlan();
    process.env.FRONTEND_BASE_URL ??= "https://app.example";
    const mails: Mail[] = [];
    const sender = async (m: Mail) => void mails.push(m);
    // 07:30 UTC: only the 06:30 default is due, unless the evening slots move earlier.
    const at = new Date("2027-01-04T07:30:00Z");

    const before = await runCoachForPlan(planId, at, sender);
    const touched = (r: typeof before) => [...r.sent, ...r.skipped, ...r.failed];
    expect(touched(before)).not.toContain("debrief");

    await db.emailSend.deleteMany({ where: { planId } });
    await db.studyPlan.update({
      where: { id: planId },
      data: { coachSchedule: { prescription: "05:00", nudge: "06:00", debrief: "07:00" } },
    });
    const after = await runCoachForPlan(planId, at, sender);
    expect(touched(after)).toEqual(expect.arrayContaining(["prescription", "nudge", "debrief"]));
  });
});
