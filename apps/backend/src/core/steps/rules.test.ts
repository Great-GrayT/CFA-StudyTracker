import { describe, it, expect } from "vitest";
import { topUpQuestions, roundOutcome } from "./rules";

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
