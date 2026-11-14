import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { ensureLevel, setupPlanWithCatalogue, setupUserWithPlan } from "../helpers/fixtures";
import { runSweep } from "../../src/lib/FUNC-sweep";
import { localDateFor } from "../../src/core/slots";
import * as scheduleModule from "../../src/lib/FUNC-schedule";
import * as coachModule from "../../src/lib/FUNC-coach";

const NO_COACH = { sent: [], skipped: [], failed: [], pushSent: [], pushFailed: [] };

beforeEach(async () => {
  await resetDb();
  await ensureLevel("I");
  vi.spyOn(coachModule, "runCoachForPlan").mockResolvedValue(NO_COACH);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// A candidate who never opened the app kept a list that assumed yesterday
// went to plan, because nothing rebuilt it when the day ended.
test("the sweep rebuilds a plan whose horizon was built for an earlier day", async () => {
  const { plan } = await setupUserWithPlan();
  await db.studyPlan.update({ where: { id: plan.id }, data: { horizonGeneratedFor: "2020-01-01" } });

  await runSweep();

  const after = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(after.horizonGeneratedFor).toBe(localDateFor(new Date(), after.timeZone));
});

test("the sweep does not rebuild twice in one local day", async () => {
  await setupUserWithPlan();
  const spy = vi.spyOn(scheduleModule, "generateHorizon");

  await runSweep();
  await runSweep();

  expect(spy).toHaveBeenCalledTimes(1);
});

test("a plan that fails to rebuild does not stop the next plan or its coach", async () => {
  const { plan: bad } = await setupUserWithPlan();
  const { plan: good } = await setupUserWithPlan();
  const real = scheduleModule.generateHorizon;
  vi.spyOn(scheduleModule, "generateHorizon").mockImplementation((planId, ...rest) =>
    planId === bad.id ? Promise.reject(new Error("boom")) : real(planId, ...rest),
  );
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  await runSweep();

  const after = await db.studyPlan.findUniqueOrThrow({ where: { id: good.id } });
  expect(after.horizonGeneratedFor).not.toBeNull();
  expect(error).toHaveBeenCalledWith(expect.stringContaining(bad.id), expect.anything());
  expect(coachModule.runCoachForPlan).toHaveBeenCalledTimes(2);
});

// The user's rule: the day ends at the debrief, and that sweep closes the
// day, sends the debrief, and replans from tomorrow.
test("after the debrief the sweep replans from tomorrow and freezes today", async () => {
  const { plan } = await setupUserWithPlan();
  const now = new Date();
  const today = localDateFor(now, plan.timeZone);
  await scheduleModule.generateHorizon(plan.id, today);
  await db.studyPlan.update({
    where: { id: plan.id },
    data: { coachSchedule: { prescription: "00:00", nudge: "00:01", debrief: "00:02" } },
  });

  await runSweep();

  const after = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(after.horizonGeneratedFor! > today).toBe(true);
  const todayTasks = await db.planTask.findMany({
    where: { planId: plan.id, date: new Date(`${today}T00:00:00Z`) },
  });
  expect(todayTasks.every((t) => t.frozen)).toBe(true);
});

test("a rebuild after the day has closed never adds work to the closed day", async () => {
  const { planId } = await setupPlanWithCatalogue();
  const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
  const today = localDateFor(new Date(), plan.timeZone);
  const [y, m, d] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
  const onToday = () =>
    db.planTask.count({ where: { planId, date: new Date(`${today}T00:00:00Z`) } });

  // The day has closed: the horizon was built from tomorrow.
  await scheduleModule.generateHorizon(planId, tomorrow);
  // What recording a forgotten task does: rebuild "from today".
  await scheduleModule.generateHorizon(planId, today);
  expect(await onToday()).toBe(0);

  // Control: on an open day the same rebuild does put work on today, so the
  // assertion above is about the closed day and not an empty fixture.
  await db.studyPlan.update({ where: { id: planId }, data: { horizonGeneratedFor: null } });
  await scheduleModule.generateHorizon(planId, today);
  expect(await onToday()).toBeGreaterThan(0);
});
