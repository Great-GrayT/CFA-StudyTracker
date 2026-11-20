import { describe, it, expect } from "vitest";
import { topUpQuestions, roundOutcome, accuracyMet, topUpParts, DEFAULT_RULES } from "./rules";

describe("topUpQuestions", () => {
  it("accuracy only: 24/40 needs 40 more", () => {
    expect(topUpQuestions({ answered: 40, correct: 24, minutes: 200, adequate: 160, perQ: 4 })).toBe(40);
  });
  it("adequacy only: 30 min short at 3 min/q is 10", () => {
    expect(topUpQuestions({ answered: 40, correct: 36, minutes: 130, adequate: 160, perQ: 3 })).toBe(10);
  });
  it("takes the max of both", () => {
    expect(topUpQuestions({ answered: 40, correct: 24, minutes: 130, adequate: 160, perQ: 3 })).toBe(40);
    expect(topUpQuestions({ answered: 10, correct: 8, minutes: 30, adequate: 160, perQ: 4 })).toBe(33);
  });
  it("never negative when passing", () => {
    expect(topUpQuestions({ answered: 40, correct: 36, minutes: 200, adequate: 160, perQ: 4 })).toBe(0);
  });
});

describe("roundOutcome", () => {
  const r = (answered: number, correct: number, minutes: number) =>
    ({ round: 1, answered, correct, minutes, usedByPackage: {} });
  it("pass at 80% and adequate", () => expect(roundOutcome(r(40, 32, 160), 160)).toBe("pass"));
  it("top-up when under adequacy", () => expect(roundOutcome(r(40, 32, 100), 160)).toBe("top-up"));
  it("exemption at 2x adequate with 0.79", () => expect(roundOutcome(r(100, 79, 320), 160)).toBe("exemption"));
  it("2x adequate but passing accuracy is a pass", () => expect(roundOutcome(r(100, 85, 400), 160)).toBe("pass"));
});

describe("non-default rules", () => {
  const r = (answered: number, correct: number, minutes: number) =>
    ({ round: 1, answered, correct, minutes, usedByPackage: {} });
  it("defaults are 2/2/80/75/2", () => {
    expect(DEFAULT_RULES).toEqual({ step2Multiplier: 2, step4Multiplier: 2, accuracyTarget: 80, mockPassTarget: 75, exemptionMultiplier: 2, reviewShare: 35 });
  });
  it("70% target passes 7/10 where 80% does not", () => {
    expect(accuracyMet(10, 7)).toBe(false);
    expect(accuracyMet(10, 7, 0.7)).toBe(true);
    expect(roundOutcome(r(10, 7, 160), 160, 0.7)).toBe("pass");
  });
  it("exemption multiplier moves the exemption point", () => {
    expect(roundOutcome(r(100, 79, 320), 160, 0.8, 3)).toBe("top-up");
    expect(roundOutcome(r(100, 79, 480), 160, 0.8, 3)).toBe("exemption");
  });
  it("top-up generalises: 70% of 10/5 needs ceil((7-5)/0.3) = 7", () => {
    expect(topUpParts({ answered: 10, correct: 5, minutes: 999, adequate: 0, perQ: 3 }, 0.7).n80).toBe(7);
  });
  it("100% target never divides by zero and plans no accuracy top-up", () => {
    const { n80 } = topUpParts({ answered: 10, correct: 9, minutes: 0, adequate: 30, perQ: 3 }, 1);
    expect(n80).toBe(0);
    expect(accuracyMet(10, 10, 1)).toBe(true);
    expect(accuracyMet(10, 9, 1)).toBe(false);
    expect(roundOutcome(r(10, 9, 60), 30, 1)).toBe("exemption");
  });
});
