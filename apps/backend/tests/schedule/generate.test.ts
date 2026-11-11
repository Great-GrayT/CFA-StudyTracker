import { beforeEach, describe, test, expect } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { setupPlanWithCatalogue } from "../helpers/fixtures";
import { generateHorizon } from "../../src/lib/FUNC-schedule";

describe("generateHorizon", () => {
  beforeEach(async () => {
    await resetDb();
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

  test("changing the ordering strategy regenerates without error", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await generateHorizon(planId, "2027-01-04");
    const beforeCount = await db.planTask.count({ where: { planId } });

    // Change strategy and regenerate - should not error
    await db.studyPlan.update({
      where: { id: planId },
      data: { orderingStrategy: "weight" },
    });

    const result = await generateHorizon(planId, "2027-01-04");
    const afterCount = await db.planTask.count({ where: { planId } });

    // Result should be stable: created 0 (all slots already exist and aren't changing)
    expect(result.created).toBe(0);
    // Task count should remain the same
    expect(afterCount).toBe(beforeCount);
  });
});
