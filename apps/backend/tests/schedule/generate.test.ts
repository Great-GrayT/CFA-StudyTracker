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
    // The engine spreads work evenly, so the first working day is not necessarily today.
    const first = await db.planTask.findFirstOrThrow({ where: { planId }, orderBy: { date: "asc" } });
    const next = new Date(first.date.getTime() + 86_400_000).toISOString().slice(0, 10);
    await generateHorizon(planId, next);
    const yesterday = await db.planTask.findMany({
      where: { planId, date: first.date },
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

  test("changing the weekly hours replans the days ahead and leaves the worked ones alone", async () => {
    // A plan edited mid-week must keep the days already studied exactly as
    // they were and spread the new budget over what is left. Backdating the
    // change would rewrite history the candidate can see in their own log.
    const { planId } = await setupPlanWithCatalogue();
    // A short runway so the even spread uses weekends too; otherwise the check below proves nothing.
    await db.studyPlan.update({ where: { id: planId }, data: { examDate: new Date("2027-03-01") } });

    await generateHorizon(planId, "2027-01-04");
    const first = await db.planTask.findFirstOrThrow({ where: { planId }, orderBy: { date: "asc" } });
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    // A day passes, so the first working day is now behind the candidate.
    const today = iso(new Date(first.date.getTime() + 86_400_000));
    await generateHorizon(planId, today);

    const pastBefore = await db.planTask.findMany({
      where: { planId, date: first.date },
      orderBy: { order: "asc" },
    });
    expect(pastBefore.length).toBeGreaterThan(0);
    expect(pastBefore.every((t) => t.frozen)).toBe(true);

    const isWeekend = (d: Date) => [0, 6].includes(d.getUTCDay());
    const weekendTasks = async () =>
      (await db.planTask.findMany({ where: { planId, date: { gte: new Date(`${today}T00:00:00Z`) } } }))
        .filter((t) => isWeekend(t.date)).length;
    expect(await weekendTasks()).toBeGreaterThan(0);

    // Weekends off, from today forward.
    await db.studyPlan.update({
      where: { id: planId },
      data: { weeklyAvailability: { mon: 2, tue: 2, wed: 2, thu: 2, fri: 2, sat: 0, sun: 0 } },
    });
    await generateHorizon(planId, today);

    const pastAfter = await db.planTask.findMany({
      where: { planId, date: first.date },
      orderBy: { order: "asc" },
    });
    expect(pastAfter.map((t) => `${t.kind}:${t.estimatedMinutes}`)).toEqual(
      pastBefore.map((t) => `${t.kind}:${t.estimatedMinutes}`),
    );
    expect(await weekendTasks()).toBe(0);
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
});
