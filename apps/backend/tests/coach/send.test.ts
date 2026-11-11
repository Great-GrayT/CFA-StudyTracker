import { describe, test, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { setupPlanWithTasks } from "../helpers/fixtures";
import { runCoachForPlan } from "../../src/lib/FUNC-coach";
import type { Mail } from "../../src/lib/FUNC-mail";

describe("runCoachForPlan", () => {
  beforeEach(async () => {
    await resetDb();
  });

  // Review Focus 1
  test("running twice sends each slot once", async () => {
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    const first = await runCoachForPlan(planId, new Date("2027-01-04T07:00:00Z"));
    const second = await runCoachForPlan(planId, new Date("2027-01-04T07:05:00Z"));
    expect(first.sent).toEqual(["prescription"]);
    expect(second.sent).toEqual([]);
    expect(await db.emailSend.count({ where: { planId, slot: "prescription" } })).toBe(1);
  });

  // Not one of the pinned eleven, but added to make the "remove the
  // transactional claim" mutation experiment honest: the sequential test
  // above never exercises concurrency at all (the second call sees the
  // first slot already marked sent via dueSlots and never even reaches
  // the claim). Two runs racing for the SAME due slot, neither having
  // committed sentAt yet, is the only way to prove the unique-constraint
  // claim - not dueSlots's own bookkeeping - is what prevents a duplicate.
  test("two concurrent runs for the same due slot send it only once", async () => {
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    const now = new Date("2027-01-04T07:00:00Z");
    const [a, b] = await Promise.all([runCoachForPlan(planId, now), runCoachForPlan(planId, now)]);
    const totalSent = a.sent.length + b.sent.length;
    expect(totalSent).toBe(1);
    expect(await db.emailSend.count({ where: { planId, slot: "prescription", sentAt: { not: null } } })).toBe(1);
  });

  // Deterministic version of the race the two-concurrent-runs test above
  // exercises non-deterministically: an EmailSend row for this slot already
  // sits unsent (sentAt null) - e.g. a crashed or still in-flight earlier
  // attempt. dueSlots still reports the slot as due (its alreadySent filter
  // only excludes sentAt-is-not-null rows), so the only thing standing
  // between this run and a second send attempt is the claim itself
  // refusing to treat an existing row as freshly won.
  test("a slot with an existing unsent EmailSend row is never claimed again", async () => {
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    await db.emailSend.create({
      data: { planId, localDate: "2027-01-04", slot: "prescription", failedAttempts: 1, lastError: "prior attempt" },
    });
    const out = await runCoachForPlan(planId, new Date("2027-01-04T07:00:00Z"));
    expect(out.sent).not.toContain("prescription");
    expect(await db.emailSend.count({ where: { planId, slot: "prescription" } })).toBe(1);
  });

  // Review Focus 2
  test("a streak regenerates the plan before the email is composed", async () => {
    const { planId } = await setupPlanWithTasks({ missedDays: 3 });
    const before = await db.planTask.count({ where: { planId } });
    await runCoachForPlan(planId, new Date("2027-01-04T07:00:00Z"));
    // The regeneration ran: the backlog is now in the live window.
    expect(await db.planTask.count({ where: { planId } })).not.toBe(before);
  });

  test("a regeneration failure sends nothing at all", async () => {
    const { planId } = await setupPlanWithTasks({ missedDays: 3, breakRegeneration: true });
    const out = await runCoachForPlan(planId, new Date("2027-01-04T07:00:00Z"));
    expect(out.sent).toEqual([]);
    expect(await db.emailSend.count({ where: { planId, sentAt: { not: null } } })).toBe(0);
  });

  // Review Focus 4. The brief's own sketch of this test calls
  // runCoachForPlan with no third argument, but the task instructions are
  // explicit that dependency injection, not module mocking, is what makes
  // a send-failure test honest - so the failing sender is passed directly
  // rather than smuggled in through the fixture.
  test("a send failure records an attempt and leaves the plan intact", async () => {
    const { planId } = await setupPlanWithTasks({});
    const taskCountBefore = await db.planTask.count({ where: { planId } });
    const failingSender = async (_mail: Mail): Promise<void> => {
      throw new Error("smtp unreachable");
    };
    const out = await runCoachForPlan(planId, new Date("2027-01-04T07:00:00Z"), failingSender);
    expect(out.failed).toEqual(["prescription"]);
    const row = await db.emailSend.findFirst({ where: { planId, slot: "prescription" } });
    expect(row!.sentAt).toBeNull();
    expect(row!.failedAttempts).toBe(1);
    expect(await db.planTask.count({ where: { planId } })).toBe(taskCountBefore);
  });

  test("emailCoach off sends nothing and debrief-only sends only the debrief", async () => {
    const { planId: offPlan } = await setupPlanWithTasks({ emailCoach: "off" });
    expect((await runCoachForPlan(offPlan, new Date("2027-01-04T23:00:00Z"))).sent).toEqual([]);
    const { planId: dPlan } = await setupPlanWithTasks({ emailCoach: "debrief-only" });
    expect((await runCoachForPlan(dPlan, new Date("2027-01-04T23:00:00Z"))).sent).toEqual(["debrief"]);
  });

  test("the nudge is not sent once something is logged", async () => {
    const { planId } = await setupPlanWithTasks({ tasksDone: 1 });
    const out = await runCoachForPlan(planId, new Date("2027-01-04T20:30:00Z"));
    expect(out.sent).not.toContain("nudge");
  });
});
