import { describe, test, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { setupUserWithPlan } from "../helpers/fixtures";
import { resetDb } from "../helpers/test-db";

describe("EmailSend schema", () => {
  beforeEach(async () => {
    await resetDb();
  });

  test("a plan cannot record the same slot twice for one local date", async () => {
    const { plan } = await setupUserWithPlan({});
    const planId = plan.id;
    await db.emailSend.create({ data: { planId, localDate: "2027-01-04", slot: "prescription" } });
    await expect(
      db.emailSend.create({ data: { planId, localDate: "2027-01-04", slot: "prescription" } }),
    ).rejects.toThrow();
  });

  test("the same slot on a different local date is allowed", async () => {
    const { plan } = await setupUserWithPlan({});
    const planId = plan.id;
    await db.emailSend.create({ data: { planId, localDate: "2027-01-04", slot: "prescription" } });
    await db.emailSend.create({ data: { planId, localDate: "2027-01-05", slot: "prescription" } });
    expect(await db.emailSend.count({ where: { planId } })).toBe(2);
  });

  test("an existing plan defaults to UTC and the coach on", async () => {
    const { plan } = await setupUserWithPlan({});
    expect(plan.timeZone).toBe("UTC");
    expect(plan.emailCoach).toBe("all");
  });

  test("resetDb removes email sends", async () => {
    const { plan } = await setupUserWithPlan({});
    const planId = plan.id;
    await db.emailSend.create({ data: { planId, localDate: "2027-01-04", slot: "debrief" } });
    await resetDb();
    expect(await db.emailSend.count()).toBe(0);
  });
});
