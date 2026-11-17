import { describe, test, expect } from "vitest";
import { ladderFacts, behindDays, type FactsInput } from "./coach-facts";

const w = (step: number, status: string) => ({ step, status });
function input(over: Partial<FactsInput> = {}): FactsInput {
  return {
    asOf: "2027-01-10",
    fit: { feasible: true, belowPass: false },
    sections: [{ modules: [{ name: "Ethics", windows: [w(1, "done"), w(2, "overdue")] }] }],
    daily: [],
    extras: [],
    readiness: 0.456,
    readinessPlanToday: 0.5,
    ...over,
  };
}

describe("behindDays", () => {
  const day = (date: string, plannedMin: number, doneMin: number) => ({ date, plannedMin, doneMin });
  test("net shortfall over average planned day, rounded up", () => {
    const daily = [day("2027-01-08", 120, 0), day("2027-01-09", 120, 60), day("2027-01-10", 120, 0)];
    expect(behindDays(daily, "2027-01-10")).toBe(2); // 180 / 120 = 1.5
  });
  test("ahead is zero", () => {
    expect(behindDays([day("2027-01-09", 60, 120), day("2027-01-11", 60, 0)], "2027-01-10")).toBe(0);
  });
});

describe("ladderFacts", () => {
  test("stage comes from done windows, formatted vars from the projection", () => {
    const f = ladderFacts(input(), 100, false);
    expect(f.stage).toBe("steps-1-2");
    expect(f.overdueList).toBe("Ethics (step 2)");
    expect(f.readiness).toBe(46);
    expect(f.readinessPlan).toBe(50);
    expect(f.extraReason).toBe("none");
  });
  test("mock window within 30 days", () => {
    expect(ladderFacts(input(), 30, false).stage).toBe("mock-window");
  });
  test("overdue list caps at three", () => {
    const mods = ["A", "B", "C", "D", "E"].map((name) => ({ name, windows: [w(1, "overdue")] }));
    expect(ladderFacts(input({ sections: [{ modules: mods }] }), 100, false).overdueList).toBe(
      "A (step 1); B (step 1); C (step 1); and 2 more",
    );
  });
  test("infeasible only when not consented", () => {
    const fit = { feasible: false, belowPass: true };
    expect(ladderFacts(input({ fit }), 100, false).infeasible).toBe(true);
    const ok = ladderFacts(input({ fit }), 100, true);
    expect(ok.infeasible).toBe(false);
    expect(ok.belowPass).toBe(true);
  });
  test("extra reason prefers today's", () => {
    const extras = [{ reason: "mock-retest", date: "2027-01-11" }, { reason: "top-up-80", date: "2027-01-10" }];
    expect(ladderFacts(input({ extras }), 100, false).extraReason).toBe("top-up-80");
  });
});
