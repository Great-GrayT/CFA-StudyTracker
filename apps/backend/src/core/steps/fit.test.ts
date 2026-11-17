import { describe, it, expect } from "vitest";
import { fitPlan, type FitInput } from "./fit";
import { caps, item } from "./testkit";

const TODAY = "2026-01-01", EXAM = "2026-04-11"; // 100 days, gate 2026-03-12
const input = (o: Partial<FitInput>): FitInput => ({
  today: TODAY, exam: EXAM, caps: caps(TODAY, 100, 300), work: [], modules: [], mockSessions: [],
  reviewPolicy: "fixed-date", reviewStartDate: null, order: "curriculum-topic", belowPassAccepted: false,
  weights: new Map(), ...o,
});

describe("fitPlan", () => {
  it("fits uncrashed when capacity allows", () => {
    const r = fitPlan(input({ work: [item({ minutes: 5000 })] }));
    expect(r.fit).toMatchObject({ crash: 1, cancelledHolidayIds: [], feasible: true, belowPass: false, trims: [] });
  });

  it("crashes before cancelling anything", () => {
    // 24000 read min vs 21300 before the gate: 1.1 is not enough (21818), 1.2 is.
    const r = fitPlan(input({ work: [item({ minutes: 24000 })] }));
    expect(r.fit.crash).toBe(1.2);
    expect(r.fit.cancelledHolidayIds).toEqual([]);
    expect(r.fit.feasible).toBe(true);
    expect(r.result.tasks.reduce((a, t) => a + (t.item.kind === "read" ? t.workMinutes : 0), 0)).toBeCloseTo(24000, 3);
  });

  it("cancels the holiday nearest the exam first, one at a time, at crash 1.5", () => {
    const hol: Record<string, string> = {};
    for (let d = 9; d <= 28; d++) hol[`2026-01-${String(d + 1).padStart(2, "0")}`] = "H1";
    for (let d = 1; d <= 10; d++) hol[`2026-02-${String(d).padStart(2, "0")}`] = "H2";
    // Before the gate: 71 days x 300 = 21300 minus 30 holiday days = 12300 (H2 back: 15300).
    const one = fitPlan(input({ caps: caps(TODAY, 100, 300, hol), work: [item({ minutes: 22500 })] }));
    expect(one.fit.crash).toBe(1.5); // 22500 / 1.5 = 15000 fits 15300
    expect(one.fit.cancelledHolidayIds).toEqual(["H2"]);
    const two = fitPlan(input({ caps: caps(TODAY, 100, 300, hol), work: [item({ minutes: 27000 })] }));
    expect(two.fit.cancelledHolidayIds).toEqual(["H2", "H1"]);
    expect(two.fit.feasible).toBe(true);
  });

  it("an all-day holiday ladder terminates and ends infeasible without consent", () => {
    const hol: Record<string, string> = {};
    for (const c of caps(TODAY, 71, 300)) hol[c.date] = "ALL";
    const r = fitPlan(input({ caps: caps(TODAY, 100, 300, hol), work: [item({ minutes: 60000 })] }));
    expect(r.fit.feasible).toBe(false);
    expect(r.fit.belowPass).toBe(false);
    expect(r.fit.crash).toBe(1.5);
    expect(r.fit.cancelledHolidayIds).toEqual(["ALL"]);
    expect(r.result.tasks.length).toBeGreaterThan(0);
  });

  describe("belowPassAccepted", () => {
    const w = new Map([
      ["low", { examWeight: 0.05, index: 0 }], ["high", { examWeight: 0.4, index: 1 }], ["r1", { examWeight: 0.3, index: 2 }],
    ]);
    const work = () => [
      item({ id: "S1", readingId: "r1", step: 1, minutes: 12000 }),
      item({ id: "S3", readingId: "r1", step: 3, kind: "review", minutes: 3000, after: ["S1"] }),
      item({ id: "low:q", readingId: "low", step: 4, kind: "questions", minutes: 8000, after: ["S3"] }),
      item({ id: "low:q:ar", readingId: "low", step: 4, kind: "answer-review", minutes: 3000, after: ["low:q"] }),
      item({ id: "high:q", readingId: "high", step: 4, kind: "questions", minutes: 8000, after: ["S3"] }),
      item({ id: "high:q:ar", readingId: "high", step: 4, kind: "answer-review", minutes: 3000, after: ["high:q"] }),
      item({ id: "high:x", readingId: "high", step: 4, kind: "questions", minutes: 1000, extraReason: "top-up-80", after: ["S3"] }),
    ];
    it("trims extras, then base lowest weight first; never steps 1-3 or mocks when enough", () => {
      const r = fitPlan(input({ work: work(), weights: w, belowPassAccepted: true }));
      expect(r.fit.feasible).toBe(false);
      expect(r.fit.belowPass).toBe(true);
      expect(r.fit.trims.map((t) => [t.readingId, t.step, t.reason])).toEqual([
        ["high", 4, "step 4 extra"], ["low", 4, "step 4 base, lowest exam weight first"],
      ]);
      expect(r.work.some((x) => x.step <= 3)).toBe(true);
      expect(r.work.map((x) => x.id)).not.toContain("low:q:ar");
      expect(r.result.unplaced).toEqual([]);
    });
    it("trims mocks last, earliest week first", () => {
      const r = fitPlan(input({
        caps: caps(TODAY, 100, 140), weights: w, belowPassAccepted: true,
        work: [item({ id: "S1", readingId: "r1", step: 1, minutes: 7000 })],
      }));
      expect(r.fit.trims.length).toBeGreaterThan(0);
      expect(r.fit.trims.every((t) => t.step === 5 && t.readingId === null)).toBe(true);
      expect(r.work.map((x) => x.id)).toContain("S1");
    });
  });
});
