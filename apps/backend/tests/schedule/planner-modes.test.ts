import { beforeEach, describe, test, expect } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { addQuestionBank, setupPlanWithCatalogue } from "../helpers/fixtures";
import { generateHorizon } from "../../src/lib/FUNC-schedule";

const READING_KINDS = new Set(["read"]);
const QUESTION_KINDS = new Set(["questions"]);

/** Every generated task in plan order, tagged with its topic area's position. */
async function tasksWithTopicOrder(planId: string) {
  const [tasks, readings] = await Promise.all([
    db.planTask.findMany({
      where: { planId },
      orderBy: [{ date: "asc" }, { order: "asc" }],
    }),
    db.reading.findMany({ include: { topic: { select: { order: true, name: true } } } }),
  ]);
  const byId = new Map(readings.map((r) => [r.id, r.topic]));
  return tasks.map((t) => ({
    kind: t.kind,
    ref: t.readingIds[0] ?? null,
    topicOrder: t.readingIds[0] ? (byId.get(t.readingIds[0])?.order ?? null) : null,
  }));
}

describe("planner modes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  // The regression this whole feature exists for. The catalogue fixture seeds
  // Ethics, Quantitative Methods and Financial Statement Analysis at curriculum
  // positions 1, 2 and 3, which is the exact shape the candidate complained
  // about: one week that read all three.
  test("curriculum-topic never leaves a topic area and comes back to it", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await generateHorizon(planId, "2027-01-04");

    const areas = (await tasksWithTopicOrder(planId))
      .map((t) => t.topicOrder)
      .filter((o): o is number => o !== null);
    expect(areas.length).toBeGreaterThan(0);

    const firstAt = new Map<number, number>();
    const lastAt = new Map<number, number>();
    areas.forEach((area, i) => {
      if (!firstAt.has(area)) firstAt.set(area, i);
      lastAt.set(area, i);
    });
    for (const [area, first] of firstAt) {
      const span = areas.slice(first, lastAt.get(area)! + 1);
      expect(span.every((a) => a === area)).toBe(true);
    }
  });

  test("curriculum-topic visits topic areas in curriculum order", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await generateHorizon(planId, "2027-01-04");

    const seen: number[] = [];
    for (const t of await tasksWithTopicOrder(planId)) {
      if (t.topicOrder !== null && seen[seen.length - 1] !== t.topicOrder) {
        seen.push(t.topicOrder);
      }
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[0]).toBe(1);
  });

  // An invariant, not a heuristic: the plan may never ask for questions on
  // material it has not already asked the candidate to read.
  test("no question task in a generated plan precedes the reading of its own unit", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await addQuestionBank();
    await generateHorizon(planId, "2027-01-04");

    const firstRead = new Map<string, number>();
    const tasks = await tasksWithTopicOrder(planId);
    expect(tasks.length).toBeGreaterThan(0);

    tasks.forEach((t, i) => {
      if (t.ref === null) return;
      if (READING_KINDS.has(t.kind) && !firstRead.has(t.ref)) firstRead.set(t.ref, i);
      if (QUESTION_KINDS.has(t.kind)) {
        expect(firstRead.get(t.ref), `questions on ${t.ref} at index ${i}`).toBeLessThan(i);
      }
    });
  });

  test("generation reports the mode and policy it ran and rejects nothing by default", async () => {
    const { planId } = await setupPlanWithCatalogue();
    const result = await generateHorizon(planId, "2027-01-04");

    expect(result.planMode).toBe("curriculum-topic");
    expect(result.reviewPolicy).toBe("decay-triggered");
    expect(result.rejectedTuning).toEqual([]);
  });

  test("bad tuning values are reported rather than thrown", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await db.studyPlan.update({
      where: { id: planId },
      data: { tuning: { answerReviewWordsPerMinute: 9999 } },
    });
    const result = await generateHorizon(planId, "2027-01-04");
    expect(result.rejectedTuning.map((r) => r.field)).toContain("answerReviewWordsPerMinute");
  });

  test("switching plan mode regenerates forward and preserves logged work", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await generateHorizon(planId, "2027-01-04");

    // This catalogue fixture seeds readings but no learning outcomes, and a
    // log entry is keyed to one, so make the outcome the log needs.
    const reading = await db.reading.findFirstOrThrow({ orderBy: { id: "asc" } });
    const los =
      (await db.lOS.findFirst({ where: { readingId: reading.id } })) ??
      (await db.lOS.create({
        data: { readingId: reading.id, text: "Outcome under test", order: 1 },
      }));

    const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
    const log = await db.studyLogEntry.create({
      data: {
        userId: plan.userId,
        planId,
        losId: los.id,
        confidence: 4,
        questionsAnswered: 20,
        questionsCorrect: 15,
      },
    });

    await db.studyPlan.update({
      where: { id: planId },
      data: { planMode: "curriculum-strict" },
    });
    const result = await generateHorizon(planId, "2027-01-04");

    expect(result.planMode).toBe("curriculum-strict");
    expect(await db.studyLogEntry.findUnique({ where: { id: log.id } })).not.toBeNull();
  });

  test("a plan still stored as effort-return runs as curriculum-topic", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await db.studyPlan.update({
      where: { id: planId },
      data: { planMode: "effort-return" },
    });
    const result = await generateHorizon(planId, "2027-01-04");
    expect(result.created).toBeGreaterThan(0);
    expect(result.planMode).toBe("curriculum-topic");
  });

  test("no generated task is zero or negative minutes", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await generateHorizon(planId, "2027-01-04");
    const tasks = await db.planTask.findMany({ where: { planId } });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.estimatedMinutes > 0)).toBe(true);
  });
});
