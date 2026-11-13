// Videos watched before tasks could be ticked come from the study log. A low
// star rating keeps the notes: the video is credited, the notes are not.
import { beforeEach, describe, expect, test } from "vitest";
import { resetDb } from "../helpers/test-db";
import { hasRealSeedData, setupPlanWithRealCatalogue } from "../helpers/fixtures";
import { generateHorizon } from "../../src/lib/FUNC-schedule";
import { db } from "../../src/lib/db";

const HORIZON = { horizonDays: 30 };

const minutesOf = (tasks: { kind: string; estimatedMinutes: number }[], kind: string) =>
  tasks.filter((t) => t.kind === kind).reduce((s, t) => s + t.estimatedMinutes, 0);

async function planWithLog(log: { questionsAnswered: number }) {
  const { planId } = await setupPlanWithRealCatalogue();
  const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
  await generateHorizon(planId, "2027-01-04", HORIZON);

  // First module, in plan order, that has both notes and a video to watch.
  const baseline = await db.planTask.findMany({ where: { planId }, orderBy: [{ date: "asc" }, { order: "asc" }] });
  const readingId = baseline
    .map((t) => t.readingIds[0])
    .find((id) => {
      const mine = baseline.filter((t) => t.readingIds[0] === id);
      return mine.some((t) => t.kind === "content-video") && mine.some((t) => t.kind === "content-notes");
    });
  expect(readingId).toBeDefined();
  const before = baseline.filter((t) => t.readingIds.includes(readingId!));

  const los = await db.lOS.findFirstOrThrow({ where: { readingId } });
  await db.studyLogEntry.create({
    data: {
      userId: plan.userId,
      planId,
      losId: los.id,
      confidence: 1,
      questionsAnswered: log.questionsAnswered,
      date: new Date("2027-01-03T00:00:00Z"),
    },
  });
  // Rebuild from scratch so the log is the only thing that differs.
  await db.planTask.deleteMany({ where: { planId } });
  await generateHorizon(planId, "2027-01-04", HORIZON);
  const after = (await db.planTask.findMany({ where: { planId } })).filter((t) =>
    t.readingIds.includes(readingId!),
  );
  return { before, after };
}

describe.runIf(hasRealSeedData())("videos watched before the plan could record them", () => {
  beforeEach(resetDb);

  test("a logged study session with no questions credits the video and keeps the notes whole", async () => {
    const { before, after } = await planWithLog({ questionsAnswered: 0 });
    expect(minutesOf(after, "content-video")).toBe(0);
    expect(minutesOf(after, "content-notes")).toBe(minutesOf(before, "content-notes"));
  }, 120_000);

  test("a logged practice session leaves the video on the plan", async () => {
    const { before, after } = await planWithLog({ questionsAnswered: 6 });
    expect(minutesOf(after, "content-video")).toBe(minutesOf(before, "content-video"));
  }, 120_000);
});
