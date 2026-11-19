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
  expect(DEFAULT_TUNING.answerReviewWordsPerMinute).toBe(200);
});

test("an out of range number falls back and is reported, never thrown", () => {
  const { tuning, rejected } = parseTuning({ answerReviewWordsPerMinute: 900 });
  expect(tuning.answerReviewWordsPerMinute).toBe(200);
  expect(rejected).toHaveLength(1);
  expect(rejected[0].field).toBe("answerReviewWordsPerMinute");
  expect(rejected[0].given).toBe(900);
  expect(rejected[0].usedInstead).toBe(200);
});

test("garbage of the wrong type falls back and is reported", () => {
  const { tuning, rejected } = parseTuning({
    answerReviewWordsPerMinute: "soon",
    planMode: "vibes",
  });
  expect(tuning.answerReviewWordsPerMinute).toBe(200);
  expect(tuning.planMode).toBe("curriculum-topic");
  expect(rejected.map((r) => r.field).sort()).toEqual(["answerReviewWordsPerMinute", "planMode"]);
});

test("the removed effort-return mode maps to curriculum-topic without being rejected", () => {
  const { tuning, rejected } = parseTuning({ planMode: "effort-return" });
  expect(tuning.planMode).toBe("curriculum-topic");
  expect(rejected).toEqual([]);
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
  const { rejected } = parseTuning({ answerReviewWordsPerMinute: 100 });
  expect(parseTuning({ answerReviewWordsPerMinute: 400 }).rejected).toEqual([]);
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

test("step rules default, accept in-range values and reject out-of-range ones", () => {
  expect(parseTuning(null).tuning).toMatchObject({
    step2Multiplier: 2, step4Multiplier: 2, accuracyTarget: 80, mockPassTarget: 75, exemptionMultiplier: 2,
  });
  const ok = parseTuning({ step2Multiplier: 3, accuracyTarget: 70, mockPassTarget: 60, exemptionMultiplier: 1.25 });
  expect(ok.rejected).toEqual([]);
  expect(ok.tuning).toMatchObject({ step2Multiplier: 3, accuracyTarget: 70, mockPassTarget: 60, exemptionMultiplier: 1.25 });
  const bad = parseTuning({ accuracyTarget: 40, step4Multiplier: 7, exemptionMultiplier: 1 });
  expect(bad.rejected.map((r) => r.field).sort()).toEqual(["accuracyTarget", "exemptionMultiplier", "step4Multiplier"]);
  expect(bad.tuning.accuracyTarget).toBe(80);
});
