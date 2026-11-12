import { expect, test } from "vitest";
import { DEFAULT_TUNING, parseTuning } from "./tuning";

test("an absent column yields every default", () => {
  const { tuning, rejected } = parseTuning(null);
  expect(tuning).toEqual(DEFAULT_TUNING);
  expect(rejected).toEqual([]);
});

test("defaults match the spec exactly", () => {
  expect(DEFAULT_TUNING.planMode).toBe("curriculum-topic");
  expect(DEFAULT_TUNING.reviewPolicy).toBe("decay-triggered");
  expect(DEFAULT_TUNING.firstPassQuestionMultiple).toBe(2.0);
  expect(DEFAULT_TUNING.questionMultipleFloor).toBe(0.5);
  expect(DEFAULT_TUNING.coverageDeadlineWeeks).toBe(6);
  expect(DEFAULT_TUNING.reviewQuestionMultiple).toBe(4.0);
  expect(DEFAULT_TUNING.minNewUnitReadMinutes).toBe(15);
  expect(DEFAULT_TUNING.weeklyInterleaveShare).toBe(0.2);
  expect(DEFAULT_TUNING.reviewInjectionCapShare).toBe(0.35);
  expect(DEFAULT_TUNING.masteryHalfLifeDays).toBe(45);
  expect(DEFAULT_TUNING.masteryBar).toBe(0.75);
  expect(DEFAULT_TUNING.readingWriteOffBar).toBe(0.85);
  expect(DEFAULT_TUNING.confidenceTriggerValue).toBe(1);
  expect(DEFAULT_TUNING.accuracyFloor).toBe(0.5);
  expect(DEFAULT_TUNING.accuracyMinSample).toBe(12);
});

test("an out of range number falls back and is reported, never thrown", () => {
  const { tuning, rejected } = parseTuning({ masteryBar: 1.4 });
  expect(tuning.masteryBar).toBe(0.75);
  expect(rejected).toHaveLength(1);
  expect(rejected[0].field).toBe("masteryBar");
  expect(rejected[0].given).toBe(1.4);
  expect(rejected[0].usedInstead).toBe(0.75);
});

test("garbage of the wrong type falls back and is reported", () => {
  const { tuning, rejected } = parseTuning({
    masteryHalfLifeDays: "soon",
    planMode: "vibes",
  });
  expect(tuning.masteryHalfLifeDays).toBe(45);
  expect(tuning.planMode).toBe("curriculum-topic");
  expect(rejected.map((r) => r.field).sort()).toEqual([
    "masteryHalfLifeDays",
    "planMode",
  ]);
});

test("mastery weights are normalised to sum to one, in any units", () => {
  const { tuning } = parseTuning({
    masteryWeightAccuracy: 6,
    masteryWeightCoverage: 2.5,
    masteryWeightConfidence: 1.5,
  });
  const sum =
    tuning.masteryWeightAccuracy +
    tuning.masteryWeightCoverage +
    tuning.masteryWeightConfidence;
  expect(sum).toBeCloseTo(1, 10);
  expect(tuning.masteryWeightAccuracy).toBeCloseTo(0.6, 10);
});

test("zeroing the confidence weight is allowed and survives normalisation", () => {
  const { tuning, rejected } = parseTuning({
    masteryWeightAccuracy: 0.7,
    masteryWeightCoverage: 0.3,
    masteryWeightConfidence: 0,
  });
  expect(tuning.masteryWeightConfidence).toBe(0);
  expect(rejected).toEqual([]);
});

test("all three weights zero falls back to the default trio rather than dividing by zero", () => {
  const { tuning, rejected } = parseTuning({
    masteryWeightAccuracy: 0,
    masteryWeightCoverage: 0,
    masteryWeightConfidence: 0,
  });
  expect(tuning.masteryWeightAccuracy).toBe(0.6);
  expect(tuning.masteryWeightCoverage).toBe(0.25);
  expect(tuning.masteryWeightConfidence).toBe(0.15);
  expect(rejected.some((r) => r.field === "masteryWeights")).toBe(true);
});

test("fixed-date policy without a date is reported and falls back to the default policy", () => {
  const { tuning, rejected } = parseTuning({
    reviewPolicy: "fixed-date",
    reviewStartDate: null,
  });
  expect(tuning.reviewPolicy).toBe("decay-triggered");
  expect(rejected.some((r) => r.field === "reviewStartDate")).toBe(true);
});

test("fixed-date policy with a date is kept", () => {
  const { tuning, rejected } = parseTuning({
    reviewPolicy: "fixed-date",
    reviewStartDate: "2027-03-01",
  });
  expect(tuning.reviewPolicy).toBe("fixed-date");
  expect(tuning.reviewStartDate).toBe("2027-03-01");
  expect(rejected).toEqual([]);
});

test("a value at either end of its range is accepted, not rejected", () => {
  const { rejected } = parseTuning({
    masteryBar: 0.3,
    masteryHalfLifeDays: 365,
    accuracyMinSample: 5,
  });
  expect(rejected).toEqual([]);
});

test("an unknown key is ignored without being reported as a rejected field", () => {
  const { tuning, rejected } = parseTuning({ favouriteColour: "blue" });
  expect(tuning).toEqual(DEFAULT_TUNING);
  expect(rejected).toEqual([]);
});

test("a non-object column yields defaults rather than throwing", () => {
  for (const raw of ["", 7, true, [], "null"]) {
    expect(parseTuning(raw).tuning).toEqual(DEFAULT_TUNING);
  }
});
