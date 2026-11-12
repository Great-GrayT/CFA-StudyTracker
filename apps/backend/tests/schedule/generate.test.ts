import { beforeEach, describe, test, expect, vi } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { setupPlanWithCatalogue } from "../helpers/fixtures";
import { generateHorizon } from "../../src/lib/FUNC-schedule";

describe("generateHorizon", () => {
  beforeEach(async () => {
    await resetDb();
  });

  test("freeze, delete and write run inside one transaction, not three independent steps", async () => {
    // A crash between freezing, deleting and writing used to be able to
    // leave a plan half-regenerated: rows deleted with their replacements
    // never written. Spying (not mocking) $transaction proves the whole
    // sequence is actually handed to Prisma as one atomic unit, rather
    // than three separate top-level db.* calls racing a process exit.
    const spy = vi.spyOn(db, "$transaction");
    try {
      const { planId } = await setupPlanWithCatalogue();
      await generateHorizon(planId, "2027-01-04");
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("generates a stable horizon", async () => {
    const { planId } = await setupPlanWithCatalogue();
    const a = await generateHorizon(planId, "2027-01-04");
    const b = await generateHorizon(planId, "2027-01-04");
    expect(b.created).toBe(0);
    expect(await db.planTask.count({ where: { planId } })).toBe(a.created);
  });

  test("materialises today plus fourteen days and no more", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await generateHorizon(planId, "2027-01-04");
    const dates = (await db.planTask.findMany({ where: { planId } })).map(
      (t) => t.date.toISOString().slice(0, 10),
    );
    expect(Math.max(...dates.map(Date.parse))).toBeLessThanOrEqual(
      Date.parse("2027-01-18"),
    );
  });

  test("yesterday's undone tasks are frozen, not deleted", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await generateHorizon(planId, "2027-01-04");
    await generateHorizon(planId, "2027-01-05");
    const yesterday = await db.planTask.findMany({
      where: { planId, date: new Date("2027-01-04") },
    });
    expect(yesterday.length).toBeGreaterThan(0);
    expect(yesterday.every((t) => t.frozen)).toBe(true);
  });

  test("a future task the candidate already completed survives regeneration", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await generateHorizon(planId, "2027-01-04");

    // Find the first generated task to place our test task after it
    const firstTask = await db.planTask.findFirst({
      where: { planId },
      orderBy: [{ date: "asc" }, { order: "asc" }],
    });

    if (!firstTask) {
      throw new Error("No tasks generated");
    }

    // Create a task at an order far beyond what regeneration produces.
    // This forces its (date, order) slot to NOT be in newPlanSlots after regeneration.
    // Deletion code WILL reach this task and attempt deletion.
    // The logEntryId protection is the only thing that saves it.
    const testTask = await db.planTask.create({
      data: {
        planId,
        date: firstTask.date,
        order: 99,
        kind: "content-notes",
        estimatedMinutes: 60,
        requiresConfidence: false,
        readingIds: [],
        status: "done",
        logEntryId: "fake-log-entry",
      },
    });

    // Regenerate: the plan will only generate tasks at orders 0, 1, 2... (low numbers).
    // Order 99 will NOT be in newPlanSlots.
    // Without logEntryId protection, deletion code would destroy this completed work.
    // With protection, it survives.
    await generateHorizon(planId, "2027-01-04");

    // Verify the task still exists with its work (logEntryId) intact
    const still = await db.planTask.findUnique({ where: { id: testTask.id } });
    expect(still).not.toBeNull();
    expect(still!.status).toBe("done");
    expect(still!.logEntryId).toBe("fake-log-entry");
  });

  test("a candidate's observed pace recalibrates future estimates", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await generateHorizon(planId, "2027-01-04");

    const before = await db.planTask.findMany({
      where: { planId },
      orderBy: [{ date: "asc" }, { order: "asc" }],
    });
    expect(before.length).toBeGreaterThan(0);

    // A single day's availability caps any one task's size, so comparing
    // one slot's estimatedMinutes before/after can't see calibration at
    // work (a 4x-bigger reading just becomes four day-sized split pieces
    // instead of one - each individual piece still ~the same size). The
    // reading's TOTAL planned minutes, summed across however many pieces
    // it now takes, is what calibration actually moves.
    const firstTask = before[0];
    const firstReadingId = firstTask.readingIds[0];
    const totalBefore = before
      .filter((t) => t.readingIds.includes(firstReadingId))
      .reduce((sum, t) => sum + t.estimatedMinutes, 0);

    // Mark the first task done at 4x its estimate - the calibration
    // clamp's own ceiling - so the pace signal is unmistakable.
    await db.planTask.update({
      where: { id: firstTask.id },
      data: { status: "done", actualMinutes: firstTask.estimatedMinutes * 4 },
    });

    await generateHorizon(planId, "2027-01-04");

    const after = await db.planTask.findMany({
      where: { planId },
      orderBy: [{ date: "asc" }, { order: "asc" }],
    });
    const totalAfter = after
      .filter((t) => t.readingIds.includes(firstReadingId))
      .reduce((sum, t) => sum + t.estimatedMinutes, 0);

    // If calibration were discarded (k stuck at its default of 1, as
    // before this fix), this reading's total planned minutes would stay
    // exactly what they were the first time. With the observed 4x-slower
    // pace wired through factorFor, the reading's total must grow.
    expect(totalAfter).toBeGreaterThan(totalBefore);
  });

  test("changing the weekly hours replans the days ahead and leaves the worked ones alone", async () => {
    // A plan edited mid-week must keep the days already studied exactly as
    // they were and spread the new budget over what is left. Backdating the
    // change would rewrite history the candidate can see in their own log.
    const { planId } = await setupPlanWithCatalogue();

    await generateHorizon(planId, "2027-01-04");
    // A day passes, so 2027-01-04 is now behind the candidate.
    await generateHorizon(planId, "2027-01-05");

    const pastBefore = await db.planTask.findMany({
      where: { planId, date: new Date("2027-01-04T00:00:00Z") },
      orderBy: { order: "asc" },
    });
    expect(pastBefore.length).toBeGreaterThan(0);
    expect(pastBefore.every((t) => t.frozen)).toBe(true);

    // The busiest day still ahead. Totalling the remaining days instead would
    // measure the wrong thing: a bigger budget packs the same finite material
    // into FEWER days, so the tail of the horizon empties and the sum falls
    // even though every day that still has work got bigger.
    const busiestDayAhead = async () => {
      const rows = await db.planTask.findMany({
        where: { planId, date: { gt: new Date("2027-01-05T00:00:00Z") } },
      });
      const byDate = new Map<string, number>();
      for (const t of rows) {
        const key = t.date.toISOString().slice(0, 10);
        byDate.set(key, (byDate.get(key) ?? 0) + t.estimatedMinutes);
      }
      return Math.max(0, ...byDate.values());
    };
    const busiestBefore = await busiestDayAhead();

    // Three times the hours, from today forward.
    await db.studyPlan.update({
      where: { id: planId },
      data: {
        weeklyAvailability: { mon: 6, tue: 6, wed: 6, thu: 6, fri: 6, sat: 3, sun: 3 },
      },
    });
    await generateHorizon(planId, "2027-01-05");

    const pastAfter = await db.planTask.findMany({
      where: { planId, date: new Date("2027-01-04T00:00:00Z") },
      orderBy: { order: "asc" },
    });
    expect(pastAfter.map((t) => `${t.kind}:${t.estimatedMinutes}`)).toEqual(
      pastBefore.map((t) => `${t.kind}:${t.estimatedMinutes}`),
    );

    expect(await busiestDayAhead()).toBeGreaterThan(busiestBefore);
  });

  test("a task with a non-pending status survives regeneration even without a logEntryId", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await generateHorizon(planId, "2027-01-04");

    const firstTask = await db.planTask.findFirst({
      where: { planId },
      orderBy: [{ date: "asc" }, { order: "asc" }],
    });
    if (!firstTask) throw new Error("No tasks generated");

    // order: 99 is a slot regeneration cannot reach, so the deletion
    // branch genuinely runs against it (same technique as the logEntryId test).
    const testTask = await db.planTask.create({
      data: {
        planId,
        date: firstTask.date,
        order: 99,
        kind: "content-notes",
        estimatedMinutes: 60,
        requiresConfidence: false,
        readingIds: [],
        status: "skipped",
      },
    });

    await generateHorizon(planId, "2027-01-04");

    const still = await db.planTask.findUnique({ where: { id: testTask.id } });
    expect(still).not.toBeNull();
    expect(still!.status).toBe("skipped");
  });

  test("a task with actualMinutes recorded survives regeneration even without a logEntryId", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await generateHorizon(planId, "2027-01-04");

    const firstTask = await db.planTask.findFirst({
      where: { planId },
      orderBy: [{ date: "asc" }, { order: "asc" }],
    });
    if (!firstTask) throw new Error("No tasks generated");

    const testTask = await db.planTask.create({
      data: {
        planId,
        date: firstTask.date,
        order: 99,
        kind: "content-notes",
        estimatedMinutes: 60,
        actualMinutes: 45,
        requiresConfidence: false,
        readingIds: [],
      },
    });

    await generateHorizon(planId, "2027-01-04");

    const still = await db.planTask.findUnique({ where: { id: testTask.id } });
    expect(still).not.toBeNull();
    expect(still!.actualMinutes).toBe(45);
  });

  test("a task with a running timer survives regeneration even without a logEntryId", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await generateHorizon(planId, "2027-01-04");

    const firstTask = await db.planTask.findFirst({
      where: { planId },
      orderBy: [{ date: "asc" }, { order: "asc" }],
    });
    if (!firstTask) throw new Error("No tasks generated");

    const timerStartedAt = new Date();
    const testTask = await db.planTask.create({
      data: {
        planId,
        date: firstTask.date,
        order: 99,
        kind: "content-notes",
        estimatedMinutes: 60,
        timerStartedAt,
        requiresConfidence: false,
        readingIds: [],
      },
    });

    await generateHorizon(planId, "2027-01-04");

    const still = await db.planTask.findUnique({ where: { id: testTask.id } });
    expect(still).not.toBeNull();
    expect(still!.timerStartedAt?.getTime()).toBe(timerStartedAt.getTime());
  });

  // Pinned to effort-return on purpose. orderingStrategy is no longer a
  // candidate-facing choice, but inside effort-return it is still what reaches
  // ordering.ts, and that mode is the one this assertion needs: it keeps both
  // runs on the same packer, so the task COUNT is held constant and only the
  // sequence moves. Switching planMode instead would change the packer as
  // well, and a changed row count cannot distinguish a real reorder from a
  // differently shaped plan, which is the whole point of the check below.
  test("changing the ordering strategy actually reorders the plan's modules", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await db.studyPlan.update({
      where: { id: planId },
      data: { planMode: "effort-return" },
    });
    await generateHorizon(planId, "2027-01-04");

    const before = await db.planTask.findMany({
      where: { planId },
      orderBy: [{ date: "asc" }, { order: "asc" }],
    });
    const beforeRefs = before.map((t) => t.readingIds[0] ?? null);

    // Change strategy and regenerate - should not error.
    await db.studyPlan.update({
      where: { id: planId },
      data: { orderingStrategy: "weight" },
    });

    const result = await generateHorizon(planId, "2027-01-04");

    const after = await db.planTask.findMany({
      where: { planId },
      orderBy: [{ date: "asc" }, { order: "asc" }],
    });
    const afterRefs = after.map((t) => t.readingIds[0] ?? null);

    // created===0 and an unchanged row count cannot tell a real reorder
    // apart from no effect at all - regeneration used to treat an occupied
    // (date, order) slot as "stable" without checking whether the module
    // assigned there changed. The module sequence itself must differ.
    expect(afterRefs).not.toEqual(beforeRefs);
    expect(after.length).toBe(before.length);
    expect(result.created).toBe(0);
  });
});
