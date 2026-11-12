import { beforeEach, describe, test, expect } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { addQuestionBank, setupPlanWithCatalogue } from "../helpers/fixtures";
import { projectCampaign } from "../../src/lib/FUNC-campaign";
import { generateHorizon } from "../../src/lib/FUNC-schedule";

const TODAY = "2027-01-04";

describe("projectCampaign", () => {
  beforeEach(async () => {
    await resetDb();
  });

  test("writes nothing at all", async () => {
    const { planId } = await setupPlanWithCatalogue();
    await projectCampaign(planId, { today: TODAY });
    expect(await db.planTask.count({ where: { planId } })).toBe(0);
  });

  test("covers the whole span to the exam, not the fourteen day horizon", async () => {
    const { planId } = await setupPlanWithCatalogue();
    const campaign = await projectCampaign(planId, { today: TODAY });

    expect(campaign.examDate).toBe("2027-06-01");
    expect(campaign.periods.length).toBeGreaterThan(14);
    expect(campaign.periods[0].start).toBe(TODAY);
    expect(campaign.periods[campaign.periods.length - 1].end >= campaign.examDate).toBe(true);
  });

  test("default periods are seven days long and do not overlap", async () => {
    const { planId } = await setupPlanWithCatalogue();
    const { periods } = await projectCampaign(planId, { today: TODAY });

    for (let i = 1; i < periods.length; i++) {
      expect(periods[i].start > periods[i - 1].end).toBe(true);
    }
    expect(periods[0].start).toBe("2027-01-04");
    expect(periods[0].end).toBe("2027-01-10");
  });

  test("periodDays controls the bucket width", async () => {
    const { planId } = await setupPlanWithCatalogue();
    const weekly = await projectCampaign(planId, { today: TODAY, periodDays: 7 });
    const fortnightly = await projectCampaign(planId, { today: TODAY, periodDays: 14 });

    expect(fortnightly.periods.length).toBeLessThan(weekly.periods.length);
    expect(fortnightly.periods[0].end).toBe("2027-01-17");
  });

  test("the first pass shows reading and questions in the early periods", async () => {
    // Needs a question bank: the base catalogue fixture seeds lecture
    // resources only, so without this the question bucket is legitimately
    // zero and the assertion would prove nothing.
    const { planId } = await setupPlanWithCatalogue();
    await addQuestionBank();
    const { periods } = await projectCampaign(planId, { today: TODAY });

    const early = periods.slice(0, 4).reduce(
      (sum, p) => ({
        reading: sum.reading + p.minutes.firstPassReading,
        questions: sum.questions + p.minutes.firstPassQuestions,
      }),
      { reading: 0, questions: 0 },
    );
    expect(early.reading).toBeGreaterThan(0);
    expect(early.questions).toBeGreaterThan(0);
  });

  test("every bucket is a non-negative number of minutes", async () => {
    const { planId } = await setupPlanWithCatalogue();
    const { periods } = await projectCampaign(planId, { today: TODAY });

    for (const period of periods) {
      for (const value of Object.values(period.minutes)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  test("a logged mock exam lands in the period that contains its date", async () => {
    const { planId } = await setupPlanWithCatalogue();
    const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
    await db.mockExam.create({
      data: {
        userId: plan.userId,
        planId,
        date: new Date("2027-01-20T00:00:00Z"),
        scorePercent: 62,
      },
    });

    const { periods } = await projectCampaign(planId, { today: TODAY });
    const containing = periods.find((p) => p.start <= "2027-01-20" && p.end >= "2027-01-20");
    expect(containing).toBeDefined();
    expect(containing!.minutes.mocks).toBeGreaterThan(0);
    expect(periods.filter((p) => p.minutes.mocks > 0)).toHaveLength(1);
  });

  test("reports the ratio the candidate asked for alongside the one the calendar supports", async () => {
    const { planId } = await setupPlanWithCatalogue();
    const campaign = await projectCampaign(planId, { today: TODAY });

    expect(campaign.requestedQuestionMultiple).toBe(2);
    expect(campaign.budgetQuestionMultiple).toBeGreaterThan(0);
    expect(campaign.planMode).toBe("curriculum-topic");
    expect(campaign.reviewPolicy).toBe("decay-triggered");
    expect(typeof campaign.calendarTooShort).toBe("boolean");
  });

  test("agrees with the horizon on the days they share", async () => {
    // The reason this projection runs the real pipeline rather than its own:
    // the long view and the fourteen day plan must not be able to disagree.
    const { planId } = await setupPlanWithCatalogue();
    const horizon = await generateHorizon(planId, TODAY);
    const campaign = await projectCampaign(planId, { today: TODAY, periodDays: 1 });

    const horizonByDate = new Map<string, number>();
    for (const day of horizon.days) {
      horizonByDate.set(
        day.date,
        day.tasks.reduce((sum, t) => sum + t.estimatedMinutes, 0),
      );
    }

    let compared = 0;
    for (const period of campaign.periods) {
      const expected = horizonByDate.get(period.start);
      if (expected === undefined) continue;
      const actual =
        period.minutes.firstPassReading +
        period.minutes.firstPassQuestions +
        period.minutes.reviewReading +
        period.minutes.reviewQuestions;
      expect(actual).toBe(expected);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });

  test("a plan whose exam has already passed still yields one period rather than none", async () => {
    const { planId } = await setupPlanWithCatalogue();
    const campaign = await projectCampaign(planId, { today: "2027-07-01" });
    expect(campaign.periods.length).toBeGreaterThanOrEqual(1);
  });
});
