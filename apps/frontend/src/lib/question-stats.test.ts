import { describe, expect, test } from "vitest";
import { penaltyExtraQuestions, questionStats, rateMet, ratePercent } from "./question-stats";
import type { StepPerformance } from "./types";

const perf = (o: Partial<StepPerformance> = {}): StepPerformance => ({
  round: 1,
  answered: 10,
  correct: 8,
  minutes: 20,
  adequateMin: 30,
  passed: false,
  adequateQ: 15,
  extraPendingQ: 0,
  perQ: 2,
  ...o,
});
const totals = { answered: 30, correct: 24, mockAnswered: 10, mockCorrect: 6 };

describe("rates", () => {
  test("percent rounds and is null when nothing answered", () => {
    expect(ratePercent(2, 3)).toBe(67);
    expect(ratePercent(0, 0)).toBeNull();
  });
  test("80% is met exactly, 79% is not", () => {
    expect(rateMet(4, 5)).toBe(true);
    expect(rateMet(79, 100)).toBe(false);
    expect(rateMet(0, 0)).toBeNull();
  });
});

describe("questionStats", () => {
  test("null without adequateQ (older server) or perf", () => {
    expect(questionStats(2, null, totals, null, null, null)).toBeNull();
    expect(questionStats(2, perf({ adequateQ: undefined }), totals, null, null, null)).toBeNull();
  });

  test("progress shows n / m and is met only when n reaches m", () => {
    const s = questionStats(2, perf(), totals, perf(), null, null)!;
    expect(s.progress.text).toBe("10 / 15");
    expect(s.progress.met).toBe(false);
    const done = questionStats(2, perf({ answered: 15 }), totals, perf(), null, null)!;
    expect(done.progress.met).toBe(true);
  });

  test("extra shows the round pool, or the task's own count when it is an extra", () => {
    expect(questionStats(2, perf({ extraPendingQ: 3 }), totals, perf(), null, null)!.progress.text).toBe("10 / 15 + 3");
    expect(questionStats(2, perf({ extraPendingQ: 3 }), totals, perf(), null, 1)!.progress.text).toBe("10 / 15 + 1");
  });

  test("total adds topic mocks and compares with m2, plus m4 once step 4 is under way", () => {
    const s2 = perf({ adequateQ: 20, passed: false });
    expect(questionStats(2, s2, totals, s2, perf(), null)!.total).toMatchObject({ text: "40 total", met: true });
    const short = { ...totals, answered: 5, mockAnswered: 5 };
    expect(questionStats(2, s2, short, s2, null, null)!.total!.met).toBe(false);
    const passed = perf({ adequateQ: 20, passed: true });
    // needs 20 + 15 = 35 once step 4 has answers; 40 answered is enough, 30 is not.
    expect(questionStats(2, passed, totals, passed, perf(), null)!.total!.met).toBe(true);
    expect(questionStats(2, passed, { ...totals, mockAnswered: 0 }, passed, perf(), null)!.total!.met).toBe(false);
    expect(questionStats(4, perf({ answered: 0 }), { ...totals, mockAnswered: 0 }, passed, perf({ answered: 0 }), null)!.total!.met).toBe(false);
  });

  test("a passed step 2 is not marked short by an unstarted step 4", () => {
    const passed = perf({ adequateQ: 12, answered: 14, correct: 13, passed: true });
    const s4 = perf({ adequateQ: 31, answered: 0, correct: 0, minutes: 0 });
    const t = { answered: 14, correct: 13, mockAnswered: 0, mockCorrect: 0 };
    expect(questionStats(2, passed, t, passed, s4, null)!.total).toMatchObject({ text: "14 total", met: true });
  });

  test("overall and round rates are judged against 80%", () => {
    const s = questionStats(2, perf(), totals, perf(), null, null)!;
    expect(s.overall).toMatchObject({ text: "overall 75%", met: false });
    expect(s.round).toMatchObject({ text: "this round 80%", met: true });
    expect(s.overall!.hint).toContain("incl. topic mocks");
  });

  test("an untouched round shows 0 / m, not met", () => {
    const s = questionStats(2, perf({ answered: 0, correct: 0, minutes: 0 }), totals, perf(), null, null)!;
    expect(s.progress).toMatchObject({ text: "0 / 15", met: false });
    expect(s.round).toBeNull();
  });

  test("a round with nothing answered has no rate", () => {
    const s = questionStats(4, perf({ answered: 0, correct: 0 }), undefined, null, null, null)!;
    expect(s.round).toBeNull();
    expect(s.total).toBeNull();
  });
});

describe("penaltyExtraQuestions", () => {
  test("only penalty extras show their own count", () => {
    expect(penaltyExtraQuestions({ extraReason: "top-up-80", questionCount: 5 })).toBe(5);
    expect(penaltyExtraQuestions({ extraReason: "mock-retest", questionCount: null })).toBe(0);
    expect(penaltyExtraQuestions({ extraReason: "top-up-adequacy", questionCount: 5 })).toBeNull();
    expect(penaltyExtraQuestions({ extraReason: null, questionCount: 5 })).toBeNull();
  });
});
