import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { setupPlanWithCatalogue } from "../helpers/fixtures";
import { generateHorizon } from "../../src/lib/FUNC-schedule";
import { getPrescription } from "../../src/lib/FUNC-prescription";

const D = "2027-01-04";
const NEXT = "2027-01-05";
const dDate = new Date(`${D}T00:00:00Z`);

function overlaps(a: string[], b: string[]): boolean {
  return a.some((id) => b.includes(id));
}

async function missOneDay() {
  const { planId } = await setupPlanWithCatalogue();
  await generateHorizon(planId, D);
  const missed = await db.planTask.findMany({ where: { planId, date: dDate }, orderBy: { order: "asc" } });
  expect(missed.length).toBeGreaterThan(0);
  await generateHorizon(planId, NEXT);
  return { planId, missed };
}

describe("postponed cells", () => {
  beforeEach(async () => {
    await resetDb();
  });

  test("a missed cell's work comes back tagged with the day it was missed", async () => {
    const { planId, missed } = await missOneDay();
    const window = await db.planTask.findMany({ where: { planId, date: { gt: dDate } } });

    const tagged = window.filter((t) => t.postponedFrom !== null);
    expect(tagged.length).toBeGreaterThan(0);
    for (const t of tagged) {
      expect(t.postponedFrom!.toISOString().slice(0, 10)).toBe(D);
      expect(missed.some((m) => m.kind === t.kind && overlaps(m.readingIds, t.readingIds))).toBe(true);
    }
    for (const t of window.filter((w) => w.postponedFrom === null)) {
      expect(missed.some((m) => m.kind === t.kind && overlaps(m.readingIds, t.readingIds))).toBe(false);
    }
  });

  test("a missed cell recorded late stops tagging on the next rebuild", async () => {
    const { planId, missed } = await missOneDay();
    await db.planTask.updateMany({
      where: { id: { in: missed.map((m) => m.id) } },
      data: { status: "done", actualMinutes: 30 },
    });

    await generateHorizon(planId, NEXT);

    const tagged = await db.planTask.count({ where: { planId, date: { gt: dDate }, postponedFrom: { not: null } } });
    expect(tagged).toBe(0);
  });

  test("a missed cell whose work was done in a later cell stops tagging", async () => {
    const { planId, missed } = await missOneDay();
    const nextDate = new Date(`${NEXT}T00:00:00Z`);
    // The carried work is done on the next day, in the cell that carried it.
    await db.planTask.updateMany({
      where: { planId, date: nextDate, postponedFrom: { not: null } },
      data: { status: "done", actualMinutes: 30 },
    });
    // A later cell for the same module and kind is new work (a second pass,
    // a review), not the missed one.
    await generateHorizon(planId, "2027-01-06");

    const stillTagged = await db.planTask.findMany({
      where: { planId, date: { gt: nextDate }, postponedFrom: dDate },
    });
    const carriedThenDone = await db.planTask.findMany({ where: { planId, date: nextDate, status: "done" } });
    for (const t of stillTagged) {
      const settled = carriedThenDone.some((d) => d.kind === t.kind && overlaps(d.readingIds, t.readingIds));
      expect(settled).toBe(false);
    }
    expect(missed.length).toBeGreaterThan(0);
  });

  test("an off-plan cell does not dilute pace calibration", async () => {
    const { planId } = await setupPlanWithCatalogue();
    const reading = await db.reading.findFirstOrThrow({ where: { topic: { levelId: "II" } }, orderBy: { id: "asc" } });
    // A real planned cell that ran three times its estimate: the candidate is slow.
    await db.planTask.create({
      data: {
        planId, date: new Date("2027-01-02T00:00:00Z"), order: 0, kind: "content-video",
        readingIds: [reading.id], estimatedMinutes: 30, actualMinutes: 90, status: "done", frozen: true,
      },
    });
    const slow = await generateHorizon(planId, D, { dryRun: true });

    // An off-plan session's estimate IS its minutes, so the ratio is always 1.
    // Read as calibration it would pull the slow pace back toward normal.
    await db.planTask.create({
      data: {
        planId, date: new Date("2027-01-03T00:00:00Z"), order: 100, kind: "review",
        readingIds: [reading.id], estimatedMinutes: 60, actualMinutes: 60, status: "done", frozen: true,
        insertedBecause: "off-plan",
      },
    });
    const after = await generateHorizon(planId, D, { dryRun: true });

    const minutes = (r: typeof slow) => r.days.flatMap((d) => d.tasks.map((t) => t.estimatedMinutes));
    expect(minutes(after)).toEqual(minutes(slow));
  });
});

describe("prescription tags", () => {
  beforeEach(async () => {
    await resetDb();
  });

  test("emits postponedFrom as a calendar date", async () => {
    const { planId } = await missOneDay();
    const days = await getPrescription(planId, NEXT, "2027-01-17");
    const tagged = days.flatMap((d) => d.tasks).filter((t) => t.postponedFrom !== null);
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged.every((t) => t.postponedFrom === D)).toBe(true);
    expect(tagged.every((t) => t.offPlan === false)).toBe(true);
  });

  test("an off-plan cell is flagged, uses its own package, and is not part of the planned total", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await generateHorizon(planId, D);
    const planned = (await getPrescription(planId, D, D))[0]!;

    const reading = await db.reading.findFirstOrThrow({ where: { topic: { levelId: "II" } }, orderBy: { order: "asc" } });
    const pkg = await db.studyPackage.findFirstOrThrow({ where: { slug: "test-schedule-catalogue" } });
    await db.planTask.create({
      data: {
        planId,
        date: dDate,
        order: 100,
        kind: "content-video",
        readingIds: [reading.id],
        estimatedMinutes: 25,
        actualMinutes: 25,
        status: "done",
        frozen: true,
        insertedBecause: "off-plan",
        packageId: pkg.id,
      },
    });

    const day = (await getPrescription(planId, D, D))[0]!;
    const offPlan = day.tasks.find((t) => t.offPlan)!;
    expect(offPlan).toBeDefined();
    expect(offPlan.materials.every((m) => m.packageName === pkg.name)).toBe(true);
    expect(day.totalMinutes).toBe(planned.totalMinutes);
    expect(day.doneMinutes).toBe(planned.doneMinutes + 25);
  });
});
