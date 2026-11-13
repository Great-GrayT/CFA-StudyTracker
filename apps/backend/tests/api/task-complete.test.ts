import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { authedRequest, registerUser, setupPlanWithTasks } from "../helpers/fixtures";
import { PATCH } from "../../src/app/api/plans/[id]/tasks/[taskId]/route";

// setupPlanWithTasks puts two 40-minute tasks on 2027-01-04. Pin the clock to
// that day so "not in the future" means the same thing on every run.
const TODAY = new Date("2027-01-04T15:00:00Z");

async function ownedTasks() {
  const { planId } = await setupPlanWithTasks();
  const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId }, include: { user: true } });
  const tasks = await db.planTask.findMany({ where: { planId }, orderBy: { order: "asc" } });
  // setupPlanWithTasks registers the owner but does not return a token, so
  // hand the plan to a fresh user whose token we hold.
  const user = await registerUser();
  await db.studyPlan.update({ where: { id: planId }, data: { userId: user.id } });
  return { planId, user, tasks, owner: plan.user };
}

function patch(user: Awaited<ReturnType<typeof registerUser>>, planId: string, taskId: string, body: unknown) {
  return PATCH(authedRequest(user, `/api/plans/${planId}/tasks/${taskId}`, body, "PATCH"));
}

describe("PATCH /api/plans/:id/tasks/:taskId", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TODAY);
  });
  afterEach(() => vi.useRealTimers());

  test("marking a task done records it with the estimate as the default minutes", async () => {
    const { planId, user, tasks } = await ownedTasks();
    const res = await patch(user, planId, tasks[0]!.id, { status: "done" });
    expect(res.status).toBe(200);
    const row = await db.planTask.findUniqueOrThrow({ where: { id: tasks[0]!.id } });
    expect(row.status).toBe("done");
    expect(row.actualMinutes).toBe(40);
  });

  test("marking a task done keeps the minutes the candidate reports", async () => {
    const { planId, user, tasks } = await ownedTasks();
    const res = await patch(user, planId, tasks[0]!.id, { status: "done", actualMinutes: 55 });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.task.actualMinutes).toBe(55);
  });

  test("a partial submission needs the minutes worked", async () => {
    const { planId, user, tasks } = await ownedTasks();
    expect((await patch(user, planId, tasks[0]!.id, { status: "partial" })).status).toBe(400);
    const ok = await patch(user, planId, tasks[0]!.id, { status: "partial", actualMinutes: 15 });
    expect(ok.status).toBe(200);
    const row = await db.planTask.findUniqueOrThrow({ where: { id: tasks[0]!.id } });
    expect(row.status).toBe("partial");
    expect(row.actualMinutes).toBe(15);
  });

  test("undoing a submission returns the task to pending and clears its minutes", async () => {
    const { planId, user, tasks } = await ownedTasks();
    await patch(user, planId, tasks[0]!.id, { status: "done", actualMinutes: 30 });
    const res = await patch(user, planId, tasks[0]!.id, { status: "pending" });
    expect(res.status).toBe(200);
    const row = await db.planTask.findUniqueOrThrow({ where: { id: tasks[0]!.id } });
    expect(row.status).toBe("pending");
    expect(row.actualMinutes).toBeNull();
  });

  test("a task dated after today in the plan's zone cannot be submitted", async () => {
    const { planId, user } = await ownedTasks();
    const future = await db.planTask.create({
      data: { planId, date: new Date("2027-01-05T00:00:00Z"), order: 0, kind: "content-video", estimatedMinutes: 30 },
    });
    expect((await patch(user, planId, future.id, { status: "done" })).status).toBe(400);
  });

  test("a frozen task from an earlier day can still be submitted late", async () => {
    const { planId, user } = await ownedTasks();
    const earlier = await db.planTask.create({
      data: { planId, date: new Date("2027-01-03T00:00:00Z"), order: 0, kind: "content-video", estimatedMinutes: 30, frozen: true },
    });
    expect((await patch(user, planId, earlier.id, { status: "done" })).status).toBe(200);
  });

  test("out-of-range minutes are rejected", async () => {
    const { planId, user, tasks } = await ownedTasks();
    expect((await patch(user, planId, tasks[0]!.id, { status: "done", actualMinutes: 0 })).status).toBe(400);
    expect((await patch(user, planId, tasks[0]!.id, { status: "done", actualMinutes: 1000 })).status).toBe(400);
    expect((await patch(user, planId, tasks[0]!.id, { status: "finished" })).status).toBe(400);
  });

  test("another user's plan is not found", async () => {
    const { planId, tasks } = await ownedTasks();
    const stranger = await registerUser();
    expect((await patch(stranger, planId, tasks[0]!.id, { status: "done" })).status).toBe(404);
  });

  test("a task id from a different plan is not found under this plan", async () => {
    const a = await ownedTasks();
    const b = await ownedTasks();
    expect((await patch(a.user, a.planId, b.tasks[0]!.id, { status: "done" })).status).toBe(404);
  });

  test("the day's done totals reflect the submission", async () => {
    const { getPrescription } = await import("../../src/lib/FUNC-prescription");
    const { planId, user, tasks } = await ownedTasks();
    await patch(user, planId, tasks[0]!.id, { status: "done" });
    const [day] = await getPrescription(planId, "2027-01-04", "2027-01-04");
    expect(day!.doneTasks).toBe(1);
    expect(day!.doneMinutes).toBe(40);
  });
});
