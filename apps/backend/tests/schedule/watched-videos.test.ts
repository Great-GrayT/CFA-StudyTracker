// Reading declared before the plan existed settles step 1 by confidence: 3 or more
// credits it whole, 2 or less keeps a half-length replacement.
import { beforeEach, describe, expect, test } from "vitest";
import { resetDb } from "../helpers/test-db";
import { hasRealSeedData, setupPlanWithRealCatalogue } from "../helpers/fixtures";
import { generateHorizon } from "../../src/lib/FUNC-schedule";
import { db } from "../../src/lib/db";

const TODAY = "2027-01-04";

const step1Minutes = (r: Awaited<ReturnType<typeof generateHorizon>>, readingId: string) =>
  r.tasks
    .filter((t) => t.item.readingId === readingId && t.item.step === 1)
    .reduce((s, t) => s + t.workMinutes, 0);

async function declare(confidence: number) {
  const { planId } = await setupPlanWithRealCatalogue();
  const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
  const before = await generateHorizon(planId, TODAY, { dryRun: true });
  const readingId = before.catalog.find((m) => step1Minutes(before, m.readingId) > 0)!.readingId;
  const los = await db.lOS.findFirstOrThrow({ where: { readingId } });
  await db.studyLogEntry.create({
    data: {
      userId: plan.userId, planId, losId: los.id, confidence, selfDeclared: true, declaredWatched: true,
      date: new Date("2027-01-03T00:00:00Z"),
    },
  });
  const after = await generateHorizon(planId, TODAY, { dryRun: true });
  return { base: step1Minutes(before, readingId), now: step1Minutes(after, readingId) };
}

describe.runIf(hasRealSeedData())("reading declared before the plan could record it", () => {
  beforeEach(resetDb);

  test("a confident declaration credits step 1 whole", async () => {
    const { base, now } = await declare(4);
    expect(base).toBeGreaterThan(0);
    expect(now).toBe(0);
  }, 120_000);

  test("a low-confidence declaration keeps half of step 1", async () => {
    const { base, now } = await declare(1);
    expect(now).toBeGreaterThan(0);
    expect(now).toBeCloseTo(base / 2, 0);
  }, 120_000);
});
