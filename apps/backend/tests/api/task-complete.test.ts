import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { addQuestionBank, authedRequest, registerUser, setupPlanWithCatalogue, setupPlanWithTasks } from "../helpers/fixtures";
import { generateHorizon } from "../../src/lib/FUNC-schedule";
import { PATCH, DELETE } from "../../src/app/api/plans/[id]/tasks/[taskId]/route";
import { POST as POST_LOG } from "../../src/app/api/logs/route";

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

/** As ownedTasks, with the first task covering a reading that has outcomes. */
async function ownedTaskWithOutcomes() {
  const base = await ownedTasks();
  const reading = await db.reading.findFirstOrThrow({ where: { topic: { levelId: "II" } } });
  const los = await Promise.all(
    [1, 2, 3].map((order) => db.lOS.create({ data: { readingId: reading.id, text: `Outcome ${order}`, order } })),
  );
  await db.planTask.update({ where: { id: base.tasks[0]!.id }, data: { readingIds: [reading.id] } });
  return { ...base, losIds: los.map((l) => l.id) };
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
    const res = await patch(user, planId, tasks[0]!.id, { status: "done", confidence: 3 });
    expect(res.status).toBe(200);
    const row = await db.planTask.findUniqueOrThrow({ where: { id: tasks[0]!.id } });
    expect(row.status).toBe("done");
    expect(row.actualMinutes).toBe(40);
  });

  test("marking a task done keeps the minutes the candidate reports", async () => {
    const { planId, user, tasks } = await ownedTasks();
    const res = await patch(user, planId, tasks[0]!.id, { status: "done", confidence: 3, actualMinutes: 55 });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.task.actualMinutes).toBe(55);
  });

  test("a partial submission needs the minutes worked", async () => {
    const { planId, user, tasks } = await ownedTasks();
    expect((await patch(user, planId, tasks[0]!.id, { status: "partial", confidence: 3 })).status).toBe(400);
    const ok = await patch(user, planId, tasks[0]!.id, { status: "partial", confidence: 3, actualMinutes: 15 });
    expect(ok.status).toBe(200);
    const row = await db.planTask.findUniqueOrThrow({ where: { id: tasks[0]!.id } });
    expect(row.status).toBe("partial");
    expect(row.actualMinutes).toBe(15);
  });

  test("undoing a submission returns the task to pending and clears its minutes", async () => {
    const { planId, user, tasks } = await ownedTasks();
    await patch(user, planId, tasks[0]!.id, { status: "done", confidence: 3, actualMinutes: 30 });
    const res = await patch(user, planId, tasks[0]!.id, { status: "pending" });
    expect(res.status).toBe(200);
    // The rebuild after an undo may replace the now-pending row with a fresh plan,
    // so check that nothing keeps the recorded state rather than that the row survives.
    const row = await db.planTask.findUnique({ where: { id: tasks[0]!.id } });
    expect(row === null || (row.status === "pending" && row.actualMinutes === null)).toBe(true);
    expect(await db.planTask.count({ where: { planId, OR: [{ status: { not: "pending" } }, { actualMinutes: { not: null } }] } })).toBe(0);
  });

  test("a task dated after today in the plan's zone cannot be submitted", async () => {
    const { planId, user } = await ownedTasks();
    const future = await db.planTask.create({
      data: { planId, date: new Date("2027-01-05T00:00:00Z"), order: 0, kind: "content-video", estimatedMinutes: 30 },
    });
    expect((await patch(user, planId, future.id, { status: "done", confidence: 3 })).status).toBe(400);
  });

  test("a frozen task from an earlier day can still be submitted late", async () => {
    const { planId, user } = await ownedTasks();
    const earlier = await db.planTask.create({
      data: { planId, date: new Date("2027-01-03T00:00:00Z"), order: 0, kind: "content-video", estimatedMinutes: 30, frozen: true },
    });
    expect((await patch(user, planId, earlier.id, { status: "done", confidence: 3 })).status).toBe(200);
  });

  test("out-of-range minutes are rejected", async () => {
    const { planId, user, tasks } = await ownedTasks();
    expect((await patch(user, planId, tasks[0]!.id, { status: "done", confidence: 3, actualMinutes: 0 })).status).toBe(400);
    expect((await patch(user, planId, tasks[0]!.id, { status: "done", confidence: 3, actualMinutes: 1000 })).status).toBe(400);
    expect((await patch(user, planId, tasks[0]!.id, { status: "finished" })).status).toBe(400);
    // A submission is also a log, so it must say how it went.
    expect((await patch(user, planId, tasks[0]!.id, { status: "done" })).status).toBe(400);
    expect((await patch(user, planId, tasks[0]!.id, { status: "done", confidence: 6 })).status).toBe(400);
    expect(
      (await patch(user, planId, tasks[0]!.id, { status: "done", confidence: 3, questionsAnswered: 2, questionsCorrect: 3 })).status,
    ).toBe(400);
  });

  test("another user's plan is not found", async () => {
    const { planId, tasks } = await ownedTasks();
    const stranger = await registerUser();
    expect((await patch(stranger, planId, tasks[0]!.id, { status: "done", confidence: 3 })).status).toBe(404);
  });

  test("a task id from a different plan is not found under this plan", async () => {
    const a = await ownedTasks();
    const b = await ownedTasks();
    expect((await patch(a.user, a.planId, b.tasks[0]!.id, { status: "done", confidence: 3 })).status).toBe(404);
  });

  test("submitting writes a log row per outcome of the task's modules, with the confidence given", async () => {
    const { planId, user, tasks, losIds } = await ownedTaskWithOutcomes();
    const res = await patch(user, planId, tasks[0]!.id, { status: "done", confidence: 2 });
    expect(res.status).toBe(200);
    const rows = await db.studyLogEntry.findMany({ where: { taskId: tasks[0]!.id } });
    expect(rows.map((r) => r.losId).sort()).toEqual([...losIds].sort());
    expect(rows.every((r) => r.confidence === 2 && !r.selfDeclared)).toBe(true);
    // Dated on the task's day, which is the day the work belongs to.
    expect(rows.every((r) => r.date.toISOString().slice(0, 10) === "2027-01-04")).toBe(true);
  });

  test("questions answered are spread over the outcomes and add back up", async () => {
    const { planId, user, tasks } = await ownedTaskWithOutcomes();
    await patch(user, planId, tasks[0]!.id, { status: "done", confidence: 4, questionsAnswered: 8, questionsCorrect: 5 });
    const rows = await db.studyLogEntry.findMany({ where: { taskId: tasks[0]!.id } });
    expect(rows.reduce((s, r) => s + r.questionsAnswered, 0)).toBe(8);
    expect(rows.reduce((s, r) => s + r.questionsCorrect, 0)).toBe(5);
    expect(rows.every((r) => r.questionsCorrect <= r.questionsAnswered)).toBe(true);
  });

  test("resubmitting replaces the task's rows and undoing removes them", async () => {
    const { planId, user, tasks, losIds } = await ownedTaskWithOutcomes();
    await patch(user, planId, tasks[0]!.id, { status: "partial", confidence: 2, actualMinutes: 10 });
    await patch(user, planId, tasks[0]!.id, { status: "done", confidence: 4 });
    const rows = await db.studyLogEntry.findMany({ where: { taskId: tasks[0]!.id } });
    expect(rows).toHaveLength(losIds.length);
    expect(rows.every((r) => r.confidence === 4)).toBe(true);
    await patch(user, planId, tasks[0]!.id, { status: "pending" });
    expect(await db.studyLogEntry.count({ where: { taskId: tasks[0]!.id } })).toBe(0);
  });

  test("recording study from the sheet against a task records the task, as one record", async () => {
    const { planId, user, tasks, losIds } = await ownedTaskWithOutcomes();
    const res = await POST_LOG(
      authedRequest(user, "/api/logs", {
        planId, losId: losIds[1], confidence: 2, questionsAnswered: 3, questionsCorrect: 1,
        taskId: tasks[0]!.id, actualMinutes: 35,
      }),
    );
    expect(res.status).toBe(201);
    const task = await db.planTask.findUniqueOrThrow({ where: { id: tasks[0]!.id } });
    expect(task.status).toBe("done");
    expect(task.actualMinutes).toBe(35);
    // Exactly the rows the Record button would write; no stray standalone row.
    const rows = await db.studyLogEntry.findMany({ where: { planId } });
    expect(rows).toHaveLength(losIds.length);
    expect(rows.every((r) => r.taskId === tasks[0]!.id && r.confidence === 2)).toBe(true);
    expect(rows.reduce((s, r) => s + r.questionsAnswered, 0)).toBe(3);
  });

  test("the sheet can record a task as partway", async () => {
    const { planId, user, tasks, losIds } = await ownedTaskWithOutcomes();
    await POST_LOG(
      authedRequest(user, "/api/logs", {
        planId, losId: losIds[0], confidence: 3, questionsAnswered: 0, taskId: tasks[0]!.id, finished: false, actualMinutes: 12,
      }),
    );
    expect((await db.planTask.findUniqueOrThrow({ where: { id: tasks[0]!.id } })).status).toBe("partial");
  });

  test("the sheet refuses a task that does not cover the chosen outcome", async () => {
    const { planId, user, tasks } = await ownedTaskWithOutcomes();
    const covered = (await db.planTask.findUniqueOrThrow({ where: { id: tasks[0]!.id } })).readingIds;
    const other = await db.reading.findFirstOrThrow({ where: { id: { notIn: covered } } });
    const stray = await db.lOS.create({ data: { readingId: other.id, text: "Elsewhere", order: 9 } });
    const res = await POST_LOG(
      authedRequest(user, "/api/logs", { planId, losId: stray.id, confidence: 3, questionsAnswered: 0, taskId: tasks[0]!.id }),
    );
    expect(res.status).toBe(400);
  });

  test("an outcome studied off the plan is still recorded on its own", async () => {
    const { planId, user, losIds } = await ownedTaskWithOutcomes();
    const res = await POST_LOG(authedRequest(user, "/api/logs", { planId, losId: losIds[0], confidence: 4, questionsAnswered: 0 }));
    expect(res.status).toBe(201);
    const rows = await db.studyLogEntry.findMany({ where: { planId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taskId).toBeNull();
  });

  test("the day's done totals reflect the submission", async () => {
    const { getPrescription } = await import("../../src/lib/FUNC-prescription");
    const { planId, user, tasks } = await ownedTasks();
    await patch(user, planId, tasks[0]!.id, { status: "done", confidence: 3 });
    const [day] = await getPrescription(planId, "2027-01-04", "2027-01-04");
    expect(day!.doneTasks).toBe(1);
    expect(day!.doneMinutes).toBe(40);
  });

  test("the prescription carries the engine step fields", async () => {
    const { getPrescription } = await import("../../src/lib/FUNC-prescription");
    const { planId, tasks } = await ownedTasks();
    await db.planTask.update({
      where: { id: tasks[0]!.id },
      data: { step: 2, round: 3, questionCount: 25, extraReason: "top-up-80", mockRef: "m1", answerReviewDone: true },
    });
    const [day] = await getPrescription(planId, "2027-01-04", "2027-01-04");
    const t = day!.tasks.find((x) => x.id === tasks[0]!.id)!;
    expect(t).toMatchObject({ step: 2, round: 3, questionCount: 25, extraReason: "top-up-80", mockRef: "m1", answerReviewDone: true });
  });
});

describe("answer review on a questions task", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TODAY);
  });
  afterEach(() => vi.useRealTimers());

  async function questionTask() {
    const { planId } = await setupPlanWithCatalogue();
    await addQuestionBank({ questionsPerUnit: 200 });
    const user = await registerUser();
    await db.studyPlan.update({ where: { id: planId }, data: { userId: user.id, examDate: new Date("2027-04-01") } });
    await generateHorizon(planId, "2027-01-04");
    const t = await db.planTask.findFirstOrThrow({ where: { planId, date: new Date("2027-01-04") }, orderBy: { order: "asc" } });
    await db.planTask.update({
      where: { id: t.id },
      data: { kind: "questions", step: 2, round: 1, questionCount: 20, estimatedMinutes: 60, workMinutes: 60 },
    });
    return { planId, user, task: t };
  }

  test("answerReviewDone false creates an answer-review-owed extra after the rebuild", async () => {
    const { planId, user, task } = await questionTask();
    const res = await patch(user, planId, task.id, {
      status: "done", confidence: 3, questionsAnswered: 20, questionsCorrect: 16, answerReviewDone: false,
    });
    expect(res.status).toBe(200);
    expect((await db.planTask.findUniqueOrThrow({ where: { id: task.id } })).answerReviewDone).toBe(false);
    const extras = await db.planTask.findMany({ where: { planId, extraReason: "answer-review-owed" } });
    expect(extras.length).toBeGreaterThan(0);
  });

  test("answerReviewDone true is stored and owes nothing", async () => {
    const { planId, user, task } = await questionTask();
    await patch(user, planId, task.id, {
      status: "done", confidence: 3, questionsAnswered: 20, questionsCorrect: 16,
      answerReviewDone: true, answerReviewMinutes: 15,
    });
    const row = await db.planTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.answerReviewDone).toBe(true);
    expect(row.answerReviewMinutes).toBe(15);
    expect(row.actualMinutes).toBe(60);
    expect(await db.planTask.count({ where: { planId, extraReason: "answer-review-owed" } })).toBe(0);
    await patch(user, planId, task.id, { status: "pending" });
    const undone = await db.planTask.findUniqueOrThrow({ where: { id: task.id } });
    expect([undone.actualMinutes, undone.answerReviewMinutes]).toEqual([null, null]);
  });

  test("more correct than answered is a 400", async () => {
    const { planId, user, task } = await questionTask();
    const res = await patch(user, planId, task.id, {
      status: "done", confidence: 3, questionsAnswered: 5, questionsCorrect: 6, answerReviewDone: true,
    });
    expect(res.status).toBe(400);
  });
});

describe("editing and deleting a recorded task", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TODAY);
  });
  afterEach(() => vi.useRealTimers());

  const del = (user: Awaited<ReturnType<typeof registerUser>>, planId: string, taskId: string) =>
    DELETE(authedRequest(user, `/api/plans/${planId}/tasks/${taskId}`, undefined, "DELETE"));

  test("a recorded task moves to an earlier day, last in order and frozen, logs follow", async () => {
    const { planId, user, tasks } = await ownedTaskWithOutcomes();
    const t = tasks[0]!;
    await db.planTask.create({
      data: { planId, date: new Date("2027-01-03T00:00:00Z"), order: 4, kind: "content-video", estimatedMinutes: 10, frozen: true },
    });
    const body = { status: "done", confidence: 3, actualMinutes: 30 };
    expect((await patch(user, planId, t.id, body)).status).toBe(200);
    const res = await patch(user, planId, t.id, { ...body, date: "2027-01-03" });
    expect(res.status).toBe(200);
    const row = await db.planTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.date.toISOString().slice(0, 10)).toBe("2027-01-03");
    expect(row.order).toBe(5);
    expect(row.frozen).toBe(true);
    const logs = await db.studyLogEntry.findMany({ where: { taskId: t.id } });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.date.toISOString().slice(0, 10) === "2027-01-03")).toBe(true);
  });

  test("a date after today, a malformed date and pending with a date are 400", async () => {
    const { planId, user, tasks } = await ownedTaskWithOutcomes();
    const body = { status: "done", confidence: 3 };
    expect((await patch(user, planId, tasks[0]!.id, { ...body, date: "2027-01-05" })).status).toBe(400);
    expect((await patch(user, planId, tasks[0]!.id, { ...body, date: "yesterday" })).status).toBe(400);
    expect((await patch(user, planId, tasks[0]!.id, { status: "pending", date: "2027-01-03" })).status).toBe(400);
  });

  test("packageId must be one of the plan's packages", async () => {
    const { planId, user, tasks } = await ownedTaskWithOutcomes();
    const pkg = await db.studyPackage.create({ data: { slug: `p-${Date.now()}`, name: "Mine", userId: null } });
    const body = { status: "done", confidence: 3 };
    expect((await patch(user, planId, tasks[0]!.id, { ...body, packageId: pkg.id })).status).toBe(400);
    await db.planPackage.create({ data: { planId, packageId: pkg.id, roles: ["questions"] } });
    expect((await patch(user, planId, tasks[0]!.id, { ...body, packageId: pkg.id })).status).toBe(200);
    expect((await db.planTask.findUniqueOrThrow({ where: { id: tasks[0]!.id } })).packageId).toBe(pkg.id);
  });

  test("DELETE on a planned task undoes it, DELETE on an off-plan task removes it and its logs", async () => {
    const { planId, user, tasks } = await ownedTaskWithOutcomes();
    await patch(user, planId, tasks[0]!.id, { status: "done", confidence: 3, actualMinutes: 30 });
    expect((await del(user, planId, tasks[0]!.id)).status).toBe(200);
    expect(await db.planTask.count({ where: { planId, OR: [{ status: { not: "pending" } }, { actualMinutes: { not: null } }] } })).toBe(0);
    expect(await db.studyLogEntry.count({ where: { planId } })).toBe(0);

    const off = await db.planTask.create({
      data: {
        planId, date: new Date("2027-01-04T00:00:00Z"), order: 9, kind: "questions", estimatedMinutes: 20,
        status: "done", actualMinutes: 20, insertedBecause: "off-plan", frozen: true, readingIds: tasks[0]!.readingIds,
      },
    });
    const los = await db.lOS.findFirstOrThrow({ where: { reading: { topic: { levelId: "II" } } } });
    await db.studyLogEntry.create({
      data: { userId: user.id, planId, losId: los.id, confidence: 3, taskId: off.id, date: off.date },
    });
    expect((await del(user, planId, off.id)).status).toBe(200);
    expect(await db.planTask.findUnique({ where: { id: off.id } })).toBeNull();
    expect(await db.studyLogEntry.count({ where: { planId } })).toBe(0);
  });

  test("DELETE is a 404 for another user", async () => {
    const { planId, tasks } = await ownedTasks();
    const stranger = await registerUser();
    expect((await del(stranger, planId, tasks[0]!.id)).status).toBe(404);
  });
});
