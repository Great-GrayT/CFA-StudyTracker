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

describe("after the exam", () => {
  beforeEach(async () => {
    await resetDb();
  });

  /** Moves a plan's exam date so that `runAt` falls after it. */
  async function setExamDate(planId: string, iso: string): Promise<void> {
    await db.studyPlan.update({ where: { id: planId }, data: { examDate: new Date(iso) } });
  }

  test("the sign-off goes out once and then never again", async () => {
    // The uniqueness guard is keyed on the local DATE, so every new day is a
    // fresh row. Without an explicit check the sign-off, whose own copy says
    // there will be no further emails, would be sent every single morning for
    // the rest of the plan's life, which is the exact opposite of what it says.
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    await setExamDate(planId, "2027-01-01T00:00:00Z");

    const dayOne = await runCoachForPlan(planId, new Date("2027-01-04T07:00:00Z"));
    expect(dayOne.sent).toEqual(["prescription"]);

    const row = await db.emailSend.findFirstOrThrow({ where: { planId, slot: "prescription" } });
    expect(row.dialogueKey).toBe("P_PAST");

    // A different day, so the uniqueness guard does not help at all here.
    const dayTwo = await runCoachForPlan(planId, new Date("2027-01-05T07:00:00Z"));
    expect(dayTwo.sent).toEqual([]);
    expect(dayTwo.skipped).toContain("prescription");

    const dayThree = await runCoachForPlan(planId, new Date("2027-01-06T07:00:00Z"));
    expect(dayThree.sent).toEqual([]);

    expect(await db.emailSend.count({ where: { planId, dialogueKey: "P_PAST" } })).toBe(1);
  });

  test("the evening nudge and the night debrief are silent after the exam", async () => {
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    await setExamDate(planId, "2027-01-01T00:00:00Z");

    // Late enough that all three slots are due.
    const out = await runCoachForPlan(planId, new Date("2027-01-04T23:00:00Z"));
    expect(out.sent).toEqual(["prescription"]);
    expect(out.skipped).toContain("nudge");
    expect(out.skipped).toContain("debrief");
  });

  test("which dialogue was sent is recorded, not just that something was", async () => {
    // Without this column there is no record anywhere of what a candidate was
    // actually told, which makes a complaint about the copy unanswerable.
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    await runCoachForPlan(planId, new Date("2027-01-04T07:00:00Z"));

    const row = await db.emailSend.findFirstOrThrow({ where: { planId, slot: "prescription" } });
    expect(row.dialogueKey).toBeTruthy();
    expect(row.dialogueKey).toMatch(/^P_/);
  });
});

describe("studying something other than the plan", () => {
  beforeEach(async () => {
    await resetDb();
  });

  /**
   * Points today's tasks at one reading and returns a LOS under a different
   * one, so work logged against it is genuinely off-plan rather than off-plan
   * only because the fixture leaves readingIds empty.
   */
  async function planOneReadingAndGetAnother(
    planId: string,
  ): Promise<{ plannedLosId: string; otherLosId: string; otherReadingName: string }> {
    const readings = await db.reading.findMany({ orderBy: { name: "asc" } });
    const planned = readings[0]!;
    const other = readings[readings.length - 1]!;
    expect(other.id).not.toBe(planned.id);

    await db.planTask.updateMany({ where: { planId }, data: { readingIds: [planned.id] } });

    const plannedLos = await db.lOS.create({
      data: { readingId: planned.id, text: "planned outcome", order: 1 },
    });
    const otherLos = await db.lOS.create({
      data: { readingId: other.id, text: "other outcome", order: 1 },
    });
    return {
      plannedLosId: plannedLos.id,
      otherLosId: otherLos.id,
      otherReadingName: other.name,
    };
  }

  async function log(planId: string, losId: string): Promise<void> {
    const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
    await db.studyLogEntry.create({
      data: {
        userId: plan.userId,
        planId,
        losId,
        date: new Date("2027-01-04T12:00:00Z"),
        confidence: 3,
      },
    });
  }

  test("a candidate who studied the wrong topic is not told they did nothing", async () => {
    // The coach's worst bug, end to end: two hours on the wrong reading used to
    // produce the same verdict as an empty day, because the verdict was read
    // off tasks ticked rather than off what was logged.
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    const { otherLosId } = await planOneReadingAndGetAnother(planId);
    await log(planId, otherLosId);

    // Late enough that the debrief slot is due.
    const out = await runCoachForPlan(planId, new Date("2027-01-04T23:00:00Z"));
    expect(out.sent).toContain("debrief");

    const debrief = await db.emailSend.findFirstOrThrow({ where: { planId, slot: "debrief" } });
    expect(debrief.dialogueKey).toBe("D_OFF_PLAN");
    expect(debrief.dialogueKey).not.toBe("D_LOST_FIRST");
  });

  test("the evening nudge redirects instead of claiming nothing is logged", async () => {
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    const { otherLosId } = await planOneReadingAndGetAnother(planId);
    await log(planId, otherLosId);

    const out = await runCoachForPlan(planId, new Date("2027-01-04T20:30:00Z"));
    expect(out.sent).toContain("nudge");

    const nudge = await db.emailSend.findFirstOrThrow({ where: { planId, slot: "nudge" } });
    expect(nudge.dialogueKey).toBe("N_OFF_PLAN");
  });

  test("studying the prescribed reading counts even with the task box unticked", async () => {
    // Every task is still "pending", so tasks ticked is zero. The log entry is
    // the evidence, and it is on today's reading.
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    const { plannedLosId } = await planOneReadingAndGetAnother(planId);
    await log(planId, plannedLosId);

    await runCoachForPlan(planId, new Date("2027-01-04T23:00:00Z"));

    const debrief = await db.emailSend.findFirstOrThrow({ where: { planId, slot: "debrief" } });
    expect(debrief.dialogueKey).toBe("D_PARTIAL");
  });

  test("a genuinely empty day still reports as nothing done", async () => {
    // The distinction must hold in both directions, or the coach credits work
    // that never happened.
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    await planOneReadingAndGetAnother(planId);

    await runCoachForPlan(planId, new Date("2027-01-04T23:00:00Z"));

    const debrief = await db.emailSend.findFirstOrThrow({ where: { planId, slot: "debrief" } });
    expect(debrief.dialogueKey).toBe("D_LOST_FIRST");
  });

  test("the off-plan topic is named in the email rather than left blank", async () => {
    // The copy says what they studied instead. An unsupplied variable throws,
    // and a blank one would reach the candidate reading as a bug.
    const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
    const { otherLosId, otherReadingName } = await planOneReadingAndGetAnother(planId);
    await log(planId, otherLosId);

    const captured: Mail[] = [];
    await runCoachForPlan(planId, new Date("2027-01-04T23:00:00Z"), async (mail) => {
      captured.push(mail);
    });

    const debriefMail = captured.find((m) => m.text.includes(otherReadingName));
    expect(debriefMail).toBeDefined();
    expect(debriefMail!.text).not.toMatch(/[{}]/);
  });
});
