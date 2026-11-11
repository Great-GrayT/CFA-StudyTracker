import { describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { setupUserWithPlan } from "../helpers/fixtures";

describe("PlanTask schema", () => {
  let planId: string;

  beforeEach(async () => {
    await resetDb();
    const { plan } = await setupUserWithPlan();
    planId = plan.id;
  });

  /**
   * Helper to create a task with reasonable defaults and custom overrides.
   * Reuses the plan created in beforeEach.
   */
  async function makeTask(
    overrides: Partial<Prisma.PlanTaskUncheckedCreateInput> = {},
  ) {
    const defaults: Prisma.PlanTaskUncheckedCreateInput = {
      planId,
      date: new Date("2027-01-05"),
      order: 1,
      kind: "content-notes",
      estimatedMinutes: 45,
      status: "pending",
      readingIds: [],
      requiresConfidence: false,
      frozen: false,
    };
    return db.planTask.create({ data: { ...defaults, ...overrides } });
  }

  it("a task records the estimate it was generated with", async () => {
    const t = await makeTask({ estimatedMinutes: 45 });
    expect(t.estimatedMinutes).toBe(45);
    expect(t.actualMinutes).toBeNull();
  });

  it("two tasks cannot occupy the same slot on a day", async () => {
    await makeTask({ date: new Date("2027-01-05"), order: 1 });
    await expect(
      makeTask({ date: new Date("2027-01-05"), order: 1 }),
    ).rejects.toThrow();
  });

  it("one task can cover many readings", async () => {
    const t = await makeTask({
      readingIds: ["a", "b", "c", "d", "e", "f", "g"],
    });
    expect(t.readingIds).toHaveLength(7);
  });

  it("resetDb removes plan tasks", async () => {
    await makeTask({});
    await resetDb();
    expect(await db.planTask.count()).toBe(0);
  });
});
