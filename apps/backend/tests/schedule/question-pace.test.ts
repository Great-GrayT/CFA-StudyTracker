// Question tasks are sized by the questions in them, at exam pace.
//
// Reported: a module with 8 questions was given about 110 minutes. Each
// module's practice was its topic's average (topic budget split evenly over
// its modules) plus time to read the answer explanations, then sliced by
// time and labelled with the whole bank's count.
import { beforeAll, describe, expect, test } from "vitest";
import { resetDb } from "../helpers/test-db";
import { hasRealSeedData, setupPlanWithRealCatalogue } from "../helpers/fixtures";
import { generateHorizon } from "../../src/lib/FUNC-schedule";
import { db } from "../../src/lib/db";

describe.runIf(hasRealSeedData())("question pace on the real catalogue", () => {
  let tasks: Awaited<ReturnType<typeof db.planTask.findMany>>;
  let reviews: typeof tasks;
  let all: typeof tasks;
  let r3ReadingId: string;

  beforeAll(async () => {
    await resetDb();
    const { planId } = await setupPlanWithRealCatalogue();
    await generateHorizon(planId, "2027-01-04", { horizonDays: 60 });
    all = await db.planTask.findMany({ where: { planId } });
    tasks = all.filter((t) => t.kind === "questions");
    reviews = all.filter((t) => t.kind === "answer-review");
    r3ReadingId = (await db.reading.findFirstOrThrow({ where: { name: "Model Misspecification" } })).id;
  }, 300_000);

  test("answering Model Misspecification's 8 conceptual questions runs under exam pace", () => {
    // Not a cap: a plausibility check on the reported case. No calculation
    // questions puts this bank below the 3.0 min/q average.
    const r3 = tasks.filter((t) => t.readingIds.includes(r3ReadingId));
    expect(r3.length).toBeGreaterThan(0);
    const minutes = r3.reduce((s, t) => s + t.estimatedMinutes, 0);
    expect(minutes).toBeLessThan(8 * 3.0);
    expect(minutes).toBeGreaterThan(8 * 2.0);
  });

  test("its answer review is sized from the explanation text at the default speed", () => {
    // (3103 - 708) words at 200 words a minute, about 12 minutes.
    const r3 = reviews.filter((t) => t.readingIds.includes(r3ReadingId));
    const minutes = r3.reduce((s, t) => s + t.estimatedMinutes, 0);
    expect(minutes).toBeGreaterThanOrEqual(11);
    expect(minutes).toBeLessThanOrEqual(13);
  });

  test("every question task is followed the same day by reviewing the same vignettes", () => {
    for (const q of tasks) {
      const next = all.find(
        (t) => t.date.getTime() === q.date.getTime() && t.order === q.order + 1,
      );
      expect(next?.kind).toBe("answer-review");
      expect(next?.vignetteFrom).toBe(q.vignetteFrom);
      expect(next?.vignetteTo).toBe(q.vignetteTo);
      expect(next?.questionTarget).toBe(q.questionTarget);
    }
  });

  test("every question task says how many questions it holds", () => {
    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) expect(t.questionTarget).toBeGreaterThan(0);
  });

  test("answering stays near exam pace across the catalogue", () => {
    // Anchored calc-share rates span roughly 2.6 to 4.6 min/q; the margin is
    // whole-minute rounding on small slices.
    const minutes = tasks.reduce((s, t) => s + t.estimatedMinutes, 0);
    const questions = tasks.reduce((s, t) => s + (t.questionTarget ?? 0), 0);
    expect(minutes / questions).toBeGreaterThan(2.4);
    expect(minutes / questions).toBeLessThan(3.6);
  });
});
