import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { registerUser } from "../helpers/fixtures";
import { generateHorizon } from "../../src/lib/FUNC-schedule";

const TODAY = "2027-01-04";

// 2 topics x 2 readings; a Meldrum-like video package and a UWorld-like bank. 6 h/day and a 7 month runway:
// ten full mocks in the last 30 days alone need about 66 h, and a 4 month plan of 4 modules
// currently comes back infeasible (engine mock placement, see the phase 2 report).
async function seedPlan(examDate = "2027-04-20") {
  await db.level.create({ data: { id: "II", version: "2026-test" } });
  const readingIds: string[] = [];
  for (const [i, name] of ["Quantitative Methods", "Economics"].entries()) {
    const topic = await db.topic.create({
      data: { levelId: "II", name, order: i + 1, examWeightMin: 10, examWeightMax: 15 },
    });
    for (const order of [1, 2]) {
      const r = await db.reading.create({ data: { topicId: topic.id, name: `${name} ${order}`, order } });
      await db.lOS.create({ data: { readingId: r.id, text: "outcome", order: 1 } });
      readingIds.push(r.id);
    }
  }
  const mm = await db.studyPackage.create({ data: { slug: "mm-l2", name: "Meldrum" } });
  const uw = await db.studyPackage.create({ data: { slug: "uw-l2-2025", name: "UWorld" } });
  for (const [pkg, kinds] of [[mm, ["lecture"]], [uw, ["question_set", "answer_set"]]] as const) {
    const ed = await db.packageEdition.create({ data: { packageId: pkg.id, levelId: "II", year: "2026" } });
    for (const [i, readingId] of readingIds.entries()) {
      const unit = await db.packageUnit.create({
        data: { editionId: ed.id, ref: `${pkg.slug}/r${i + 1}`, order: i + 1 },
      });
      await db.packageUnitReading.create({ data: { unitId: unit.id, readingId } });
      for (const kind of kinds) {
        await db.packageResource.create({
          data: {
            editionId: ed.id, unitId: unit.id, ref: `${unit.ref}/${kind}`, kind,
            durationSeconds: kind === "lecture" ? 3600 : null,
            questionCount: kind === "question_set" ? 40 : null,
            wordCount: kind === "answer_set" ? 40 * 270 : null,
          },
        });
      }
    }
  }
  const user = await registerUser();
  const plan = await db.studyPlan.create({
    data: {
      userId: user.id, levelId: "II", examDate: new Date(examDate), startDate: new Date(TODAY),
      weeklyAvailability: { mon: 6, tue: 6, wed: 6, thu: 6, fri: 6, sat: 6, sun: 6 },
    },
  });
  for (const pkg of [mm, uw]) await db.planPackage.create({ data: { planId: plan.id, packageId: pkg.id, roles: [] } });
  return { planId: plan.id, userId: user.id, readingIds };
}

describe("step engine through generateHorizon", () => {
  beforeEach(resetDb);

  test("first rebuild writes 14 days of step-tagged read then question work and a feasible fit", async () => {
    const { planId } = await seedPlan();
    const res = await generateHorizon(planId, TODAY);
    expect(res.created).toBeGreaterThan(0);

    const rows = await db.planTask.findMany({ where: { planId }, orderBy: [{ date: "asc" }, { order: "asc" }] });
    const last = Math.max(...rows.map((r) => r.date.getTime()));
    expect(last).toBeLessThanOrEqual(Date.parse("2027-01-17"));
    expect(rows.every((r) => r.step !== null && r.workMinutes !== null)).toBe(true);
    expect(rows[0]).toMatchObject({ kind: "read", step: 1 });
    expect(rows.some((r) => r.kind === "questions" && r.step === 2)).toBe(true);

    const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
    expect((plan.fitReport as { feasible: boolean }).feasible).toBe(true);
  });

  test("a step 2 task recorded at 50% inserts a top-up-80 task on the next rebuild", async () => {
    const { planId, userId } = await seedPlan();
    await generateHorizon(planId, TODAY);
    const rows = await db.planTask.findMany({ where: { planId }, orderBy: [{ date: "asc" }, { order: "asc" }] });

    // Step 1 reading done for every module, so only step 2 is in play.
    for (const r of rows.filter((x) => x.kind === "read")) {
      await db.planTask.update({ where: { id: r.id }, data: { status: "done", actualMinutes: r.estimatedMinutes } });
    }
    const q = rows.find((r) => r.kind === "questions" && r.step === 2)!;
    // A long session (100 min, 24 questions) so adequacy is met and only the 80% rule is short.
    await db.planTask.update({
      where: { id: q.id },
      data: { status: "done", estimatedMinutes: 100, workMinutes: 100, actualMinutes: 100, questionCount: 24 },
    });
    const los = await db.lOS.findFirstOrThrow({ where: { readingId: q.readingIds[0] } });
    await db.studyLogEntry.create({
      data: {
        userId, planId, losId: los.id, confidence: 3, taskId: q.id, date: q.date,
        questionsAnswered: 24, questionsCorrect: 12,
      },
    });

    // The schedule is spread evenly, so the extra may sit past the 14 persisted days.
    const after = await generateHorizon(planId, TODAY);
    const extra = after.tasks.filter((t) => t.item.extraReason === "top-up-80");
    expect(extra.some((t) => t.item.kind === "questions" && t.item.readingId === q.readingIds[0])).toBe(true);
  });

  test("dryRun writes nothing and returns the whole schedule to the exam", async () => {
    const { planId } = await seedPlan();
    const res = await generateHorizon(planId, TODAY, { dryRun: true });
    expect(await db.planTask.count({ where: { planId } })).toBe(0);
    expect(res.created).toBe(0);
    expect(res.fit.feasible).toBe(true);
    expect(res.windows.length).toBe(4);
    expect(res.metrics.daily.length).toBeGreaterThan(100);
    expect(res.tasks.some((t) => t.item.kind === "mock")).toBe(true);
    // Answer review follows its questions, usually beyond the persisted horizon.
    expect(res.tasks.some((t) => t.item.kind === "answer-review" && t.item.step === 2)).toBe(true);
    expect((await db.studyPlan.findUniqueOrThrow({ where: { id: planId } })).fitReport).toBeNull();
  });
});
