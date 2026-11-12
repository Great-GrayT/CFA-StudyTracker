import { beforeEach, describe, test, expect } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { addQuestionBank, setupPlanWithCatalogue } from "../helpers/fixtures";
import { generateHorizon } from "../../src/lib/FUNC-schedule";

const READING_KINDS = new Set(["content-notes", "content-video", "seminar"]);
const QUESTION_KINDS = new Set(["questions", "eocq"]);

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

  test("a reading task is paired with questions on the same unit the same day", async () => {
    // The base catalogue seeds lecture resources only. Without a question bank
    // every unit would have nothing to pair with and this would pass without
    // exercising Rule A at all.
    const { planId } = await setupPlanWithCatalogue();
    await addQuestionBank();
    await generateHorizon(planId, "2027-01-04");

    const tasks = await db.planTask.findMany({
      where: { planId },
      orderBy: [{ date: "asc" }, { order: "asc" }],
    });
    const byDate = new Map<string, typeof tasks>();
    for (const t of tasks) {
      const key = t.date.toISOString().slice(0, 10);
      byDate.set(key, [...(byDate.get(key) ?? []), t]);
    }

    // The promise is that practice follows reading in the same sitting, which
    // bites hardest on the day a unit OPENS: that is the "asap" in the rule.
    //
    // Later days of the same unit may legitimately carry reading alone. A
    // unit's question target is capped by the budget the calendar affords and
    // by the exam-weight trim, so when the budget falls below the pacing
    // multiple the bank empties before the reading does and the tail is
    // reading only. Asserting every day would be asserting that no calendar is
    // ever tight.
    const firstReadingDay = new Map<string, string>();
    for (const [date, dayTasks] of byDate) {
      for (const t of dayTasks) {
        if (!READING_KINDS.has(t.kind)) continue;
        const ref = t.readingIds[0];
        if (!ref || firstReadingDay.has(ref)) continue;
        firstReadingDay.set(ref, date);
      }
    }
    expect(firstReadingDay.size).toBeGreaterThan(0);

    let checked = 0;
    for (const [ref, date] of firstReadingDay) {
      const hasQuestionsAnywhere = tasks.some(
        (o) => QUESTION_KINDS.has(o.kind) && o.readingIds[0] === ref,
      );
      if (!hasQuestionsAnywhere) continue;

      const paired = (byDate.get(date) ?? []).some(
        (o) => QUESTION_KINDS.has(o.kind) && o.readingIds[0] === ref,
      );
      expect(paired, `unit ${ref} opened on ${date} with no practice beside it`).toBe(true);
      checked++;
    }
    expect(checked, "no unit with a question bank was exercised").toBeGreaterThan(0);
  });

  test("generation reports the requested ratio and the one the calendar supports", async () => {
    const { planId } = await setupPlanWithCatalogue();
    const result = await generateHorizon(planId, "2027-01-04");

    expect(result.planMode).toBe("curriculum-topic");
    expect(result.reviewPolicy).toBe("decay-triggered");
    expect(result.requestedQuestionMultiple).toBe(2);
    expect(result.effectiveQuestionMultiple).toBeGreaterThan(0);
    expect(result.rejectedTuning).toEqual([]);
  });

  // The exact threshold where calendarTooShort flips is pinned by the unit
  // tests on solveQuestionMultiple, which can state R and A directly. What is
  // worth asserting through the whole engine is the monotonic relationship a
  // candidate actually experiences: a smaller calendar reaches less of the
  // question bank, and the figure stays positive and finite rather than going
  // negative and corrupting every slice.
  test("shrinking the calendar lowers the ratio it can support, and never below zero", async () => {
    const { planId } = await setupPlanWithCatalogue();
    const roomy = await generateHorizon(planId, "2027-01-04");

    await db.studyPlan.update({
      where: { id: planId },
      data: {
        weeklyAvailability: { mon: 1, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
      },
    });
    const tight = await generateHorizon(planId, "2027-01-04");

    expect(tight.effectiveQuestionMultiple).toBeLessThan(roomy.effectiveQuestionMultiple);
    expect(tight.effectiveQuestionMultiple).toBeGreaterThan(0);
    expect(Number.isFinite(tight.effectiveQuestionMultiple)).toBe(true);
    expect(tight.requestedQuestionMultiple).toBe(2);
  });

  test("tuning overrides reach the engine, and bad values are reported rather than thrown", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await db.studyPlan.update({
      where: { id: planId },
      data: { tuning: { firstPassQuestionMultiple: 3, masteryBar: 99 } },
    });
    const result = await generateHorizon(planId, "2027-01-04");
    expect(result.requestedQuestionMultiple).toBe(3);
    expect(result.rejectedTuning.map((r) => r.field)).toContain("masteryBar");
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

  test("effort-return still produces a plan, so the candidate can switch back and compare", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await db.studyPlan.update({
      where: { id: planId },
      data: { planMode: "effort-return" },
    });
    const result = await generateHorizon(planId, "2027-01-04");
    expect(result.created).toBeGreaterThan(0);
    expect(result.planMode).toBe("effort-return");
  });

  test("the review phase explains itself", async () => {
    const { planId } = await setupPlanWithCatalogue();
    const result = await generateHorizon(planId, "2027-01-04");
    expect(typeof result.reviewReason).toBe("string");
    expect(result.reviewReason.length).toBeGreaterThan(0);
    expect(result.injectionCap).toBeGreaterThanOrEqual(0);
    expect(result.injectionCap).toBeLessThanOrEqual(1);
  });

  test("no generated task is zero or negative minutes", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await generateHorizon(planId, "2027-01-04");
    const tasks = await db.planTask.findMany({ where: { planId } });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.estimatedMinutes > 0)).toBe(true);
  });
});
