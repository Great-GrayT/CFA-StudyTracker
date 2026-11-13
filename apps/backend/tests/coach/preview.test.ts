// Previewing the coach: what it would say for a slot or any event, without
// sending, and without using up the day's real message.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { authedRequest, registerUser, setupPlanWithTasks } from "../helpers/fixtures";

vi.mock("../../src/lib/FUNC-mail", async (orig) => ({
  ...(await orig<typeof import("../../src/lib/FUNC-mail")>()),
  mailConfigured: () => true,
  sendMail: vi.fn(async () => undefined),
}));
import { sendMail } from "../../src/lib/FUNC-mail";
import { GET, POST } from "../../src/app/api/coach/preview/route";

async function owned() {
  const { planId } = await setupPlanWithTasks();
  const user = await registerUser();
  await db.studyPlan.updateMany({ where: {}, data: { isActive: false } });
  await db.studyPlan.update({ where: { id: planId }, data: { userId: user.id, isActive: true } });
  return { planId, user };
}

describe("coach preview", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(sendMail).mockClear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-04T12:00:00Z"));
    return () => vi.useRealTimers();
  });

  test("lists the schedule, the time zone and every event by slot", async () => {
    const { user } = await owned();
    const body = await readJson(await GET(authedRequest(user, "/api/coach/preview")));
    expect(body.schedule).toEqual({ prescription: "06:30", nudge: "20:00", debrief: "22:30" });
    expect(body.timeZone).toBe("UTC");
    expect(body.events.prescription).toContain("P_NORMAL");
    expect(body.events.nudge).toContain("N_FIRST");
    expect(body.events.debrief).toContain("D_DONE");
  });

  test("a slot preview shows the event the coach would pick and its message", async () => {
    const { user } = await owned();
    const body = await readJson(await POST(authedRequest(user, "/api/coach/preview", { slot: "prescription" })));
    expect(body.key).toMatch(/^P_/);
    expect(body.message.subject.length).toBeGreaterThan(0);
    expect(body.message.text.length).toBeGreaterThan(0);
  });

  test("any event can be previewed with the candidate's real numbers", async () => {
    const { user } = await owned();
    const body = await readJson(await POST(authedRequest(user, "/api/coach/preview", { key: "D_DONE" })));
    expect(body.key).toBe("D_DONE");
    expect(body.message.text).not.toMatch(/\{\w+\}/);
  });

  test("delivering a preview emails it, marked as a preview, and claims no slot", async () => {
    const { user, planId } = await owned();
    const res = await POST(authedRequest(user, "/api/coach/preview", { slot: "prescription", deliver: "email" }));
    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendMail).mock.calls[0]![0].subject).toMatch(/^Preview: /);
    expect(await db.emailSend.count({ where: { planId } })).toBe(0);
  });

  test("an unknown slot or event is refused", async () => {
    const { user } = await owned();
    expect((await POST(authedRequest(user, "/api/coach/preview", { slot: "brunch" }))).status).toBe(400);
    expect((await POST(authedRequest(user, "/api/coach/preview", { key: "X_NOPE" }))).status).toBe(400);
  });
});
