import { describe, it, expect } from "vitest";
import { buildCatalog, step1Minutes, adequateMinutes } from "./catalog";
import type { ReadingRow, ResourceRow, UnitRow } from "./types";

const readings: ReadingRow[] = [
  { id: "r1", topicId: "t1", order: 1, topicOrder: 1, examWeightMin: 10, examWeightMax: 20 },
  { id: "r2", topicId: "t1", order: 2, topicOrder: 1, examWeightMin: 10, examWeightMax: 20 },
];
const priority = {
  1: ["mm-l2", "kaplan-l2", "cfa-les"], 2: ["uw-l2-2025", "kaplan-l2", "cfa-les"],
  3: ["mm-l2", "kaplan-l2", "cfa-les"], 4: ["uw-l2-2025", "kaplan-l2", "cfa-les"], 5: [],
} as Record<1 | 2 | 3 | 4 | 5, string[]>;
const unit = (id: string, slug: string, readingIds: string[], pages: number | null = null): UnitRow =>
  ({ id, packageSlug: slug, packageId: `pkg-${slug}`, notesPageCount: pages, readingIds });
const res = (id: string, unitId: string, kind: string, o: Partial<ResourceRow> = {}): ResourceRow =>
  ({ id, unitId, kind, durationSeconds: null, questionCount: null, wordCount: null, ...o });

const units = [
  unit("mu1", "mm-l2", ["r1"], 10), unit("ku1", "kaplan-l2", ["r1"]), unit("lu1", "cfa-les", ["r1"]),
  unit("lu2", "cfa-les", ["r2"]), unit("uu1", "uw-l2-2025", ["r1", "r2"]),
];
const resources = [
  res("m-lec", "mu1", "lecture", { durationSeconds: 3600 }),
  res("m-eoc", "mu1", "eocq", { durationSeconds: 1800 }),
  res("m-rev", "mu1", "review", { durationSeconds: 600 }),
  res("k-q", "ku1", "question_set", { questionCount: 20 }),
  res("l1", "lu1", "notes", { durationSeconds: 3000 }),
  res("l2", "lu2", "notes", { durationSeconds: 9000 }),
  res("u-q", "uu1", "question_set", { questionCount: 41 }),
  res("u-a", "uu1", "answer_set", { wordCount: 8200 }),
];
const build = (plan: string[], lesHours = 200, rows = readings) =>
  buildCatalog({ readings: rows, units, resources, planPackageSlugs: plan, priority, lesHours });

describe("buildCatalog", () => {
  const cat = build(["mm-l2", "kaplan-l2", "cfa-les", "uw-l2-2025"]);
  const m1 = cat.find((m) => m.readingId === "r1")!;

  it("orders options by priority and keeps Kaplan out of step 1", () => {
    expect(m1.options[1].map((o) => o.packageSlug)).toEqual(["mm-l2", "cfa-les"]);
    expect(m1.options[2].map((o) => o.packageSlug)).toEqual(["uw-l2-2025", "kaplan-l2", "cfa-les"]);
  });
  it("step 1 is Meldrum lecture + eocq minutes; exam weight is the midpoint", () => {
    expect(step1Minutes(m1)).toBe(90);
    expect(adequateMinutes(m1, 2)).toBe(180);
    expect(adequateMinutes(m1, 4)).toBe(360);
    expect(m1.examWeight).toBeCloseTo(0.15);
  });
  it("step 3 caps notes pages x 2.5 + review video at half of step 1", () => {
    expect(m1.options[3][0].minutes).toBe(35); // 25 + 10 < 45
  });
  it("skips packages not on the plan", () => {
    const c = build(["cfa-les"]);
    expect(c[0].options[1].map((o) => o.packageSlug)).toEqual(["cfa-les"]);
    expect(c[0].options[2].map((o) => o.packageSlug)).toEqual(["cfa-les"]);
  });
  it("scales LES minutes by lesHours / 200", () => {
    expect(build(["cfa-les"], 150)[0].options[1][0].minutes).toBeCloseTo(50 * 0.75);
    expect(build(["cfa-les"], 200)[0].options[1][0].minutes).toBeCloseTo(50);
  });
  it("fan-out splits questions and answer words by LES share, summing to the unit total", () => {
    const m2 = cat.find((m) => m.readingId === "r2")!;
    const u1 = m1.options[2][0], u2 = m2.options[2][0];
    expect(u1.questions! + u2.questions!).toBe(41);
    expect(u1.questions).toBe(10); // LES share 1:3
    const rev = u1.questions! * u1.answerReviewPerQuestion! + u2.questions! * u2.answerReviewPerQuestion!;
    expect(rev).toBeCloseTo(8200 / 200);
  });
  it("answer review falls back to 1/3 of answering time without word counts", () => {
    expect(m1.options[2][1].answerReviewPerQuestion).toBe(1);
  });
  it("splits evenly when LES is absent", () => {
    const c = build(["uw-l2-2025"]);
    expect(c.map((m) => m.options[2][0].questions)).toEqual([21, 20]);
  });
});

describe("adequateMinutes with rules", () => {
  it("k2 and k4 scale step 2 and step 4", () => {
    const base = buildCatalog({ readings, units, resources, planPackageSlugs: ["mm-l2"], priority, lesHours: 200 })[0];
    const s1 = step1Minutes(base);
    expect(adequateMinutes(base, 2)).toBe(2 * s1);
    expect(adequateMinutes(base, 4)).toBe(4 * s1);
    const [m] = buildCatalog({ readings, units, resources, planPackageSlugs: ["mm-l2"], priority, lesHours: 200,
      rules: { step2Multiplier: 3, step4Multiplier: 1.5, accuracyTarget: 80, mockPassTarget: 75, exemptionMultiplier: 2, reviewShare: 35 } });
    expect(adequateMinutes(m, 2)).toBeCloseTo(3 * s1);
    expect(adequateMinutes(m, 4)).toBeCloseTo(4.5 * s1);
  });
});

describe("step 3 review share", () => {
  // s1 = 90 min (mm-l2 lecture + eocq); mm review video varies per case.
  const run = (rev: number | null, share?: number, extraUnits: UnitRow[] = [], extraRes: ResourceRow[] = []) => {
    const rs = [res("m-lec", "mu1", "lecture", { durationSeconds: 3600 }), res("m-eoc", "mu1", "eocq", { durationSeconds: 1800 }),
      ...(rev == null ? [] : [res("m-rev", "mu1", "review", { durationSeconds: rev })]), ...extraRes];
    const rules = share == null ? undefined
      : { step2Multiplier: 2, step4Multiplier: 2, accuracyTarget: 80, mockPassTarget: 75, exemptionMultiplier: 2, reviewShare: share };
    return buildCatalog({ readings: [readings[0]], units: [unit("mu1", "mm-l2", ["r1"], 0), ...extraUnits], resources: rs,
      planPackageSlugs: ["mm-l2", "kaplan-l2"], priority, lesHours: 200, ...(rules ? { rules } : {}) })[0];
  };
  it("floors tiny review content at the share of step 1", () => {
    expect(run(60).options[3][0].minutes).toBeCloseTo(0.35 * 90);
  });
  it("keeps content above the floor", () => {
    expect(run(1800).options[3][0].minutes).toBeCloseTo(31.5);
    expect(run(2400).options[3][0].minutes).toBeCloseTo(40);
  });
  it("caps at 50% of step 1, or the share when higher", () => {
    expect(run(6000).options[3][0].minutes).toBeCloseTo(45);
    expect(run(60, 60).options[3][0].minutes).toBeCloseTo(54);
  });
  it("attaches the next step 3 package material when the lead has none", () => {
    const c = run(null, undefined, [unit("ku1", "kaplan-l2", ["r1"], 4)], [res("k-n", "ku1", "notes", { durationSeconds: 60 })]);
    const [lead] = c.options[3];
    expect(lead.packageSlug).toBe("mm-l2");
    expect(lead.minutes).toBeCloseTo(45); // no own content: half of read, within cap
    expect(lead.resourceIds).toContain("k-n");
  });
});
