import { describe, it, expect } from "vitest";
import { planSteps, type EngineInput } from "./index";
import { addDays } from "./dates";
import { caps, fullCatalog, module as mod } from "./testkit";
import type { MockSession } from "./mocks";
import type { Declaration } from "./state";

const TODAY = "2026-01-01", EXAM = "2026-07-01";
const sessions = (n: number): MockSession[] => Array.from({ length: n }, (_, i) => ({
  ref: `s${i}`, packageId: "pp", resourceId: `res${i}`, title: `Mock ${i}`, questionCount: 90,
  topicOrders: [(i % 10) + 1], done: false,
}));
const input = (o: Partial<EngineInput> = {}): EngineInput => ({
  today: TODAY, exam: EXAM, catalog: fullCatalog(), history: [], declarations: [], mockResults: [],
  caps: caps(TODAY, 181, 300), mockSessions: sessions(20), reviewPolicy: "decay-triggered",
  reviewStartDate: null, order: "curriculum-topic", belowPassAccepted: false, ...o,
});

describe("planSteps", () => {
  it("fresh plan: feasible, readiness 0, every module windowed, daily sums to tasks", () => {
    const r = planSteps(input());
    expect(r.unplaced).toEqual([]);
    expect(r.metrics.readiness).toBe(0);
    expect(r.windows).toHaveLength(51);
    expect(r.windows[0].steps.map((s) => s.status)).toEqual(["planned", "planned", "planned", "planned"]);
    const w = r.windows[0].steps;
    expect(w[0].start! <= w[0].due!).toBe(true);
    expect(w[0].due! <= w[1].start! || w[0].due === w[1].start).toBe(true);
    expect(r.metrics.daily).toHaveLength(181);
    const sum = r.metrics.daily.reduce((a, d) => a + d.minutes, 0);
    expect(sum).toBeCloseTo(r.tasks.reduce((a, t) => a + t.minutes, 0), 4);
    // 51 x (60 + 120 + 20 + 240) of module work + 10 mocks
    expect(r.metrics.requiredMinutes).toBeCloseTo(51 * 440 + 10 * 396, 3);
    expect(r.metrics.extras).toEqual({ tasks: 0, minutes: 0 });
    for (const d of r.metrics.daily) {
      expect(d.byStep[1] + d.byStep[2] + d.byStep[3] + d.byStep[4] + d.byStep[5]).toBeCloseTo(d.minutes, 6);
    }
  });

  it("all steps passed: readiness 1, only mocks remain", () => {
    const cat = fullCatalog();
    const declarations: Declaration[] = cat.flatMap((m) => ([
      { readingId: m.readingId, step: 1 as const, confidence: 5, answered: null, correct: null },
      { readingId: m.readingId, step: 2 as const, confidence: null, answered: null, correct: null },
      { readingId: m.readingId, step: 3 as const, confidence: null, answered: null, correct: null },
      { readingId: m.readingId, step: 4 as const, confidence: null, answered: null, correct: null },
    ]));
    const r = planSteps(input({ declarations }));
    expect(r.metrics.readiness).toBeCloseTo(1, 9);
    expect(r.metrics.readinessPlanToday).toBeCloseTo(1, 9);
    expect(r.tasks.every((t) => t.item.step === 5)).toBe(true);
    expect(r.tasks.length).toBeGreaterThan(0);
    expect(r.windows.every((w) => w.steps.every((s) => s.status === "done"))).toBe(true);
  });

  it("doneOn is passed through for done steps", () => {
    const cat = [mod("r1", 1, 1)];
    const r = planSteps(input({
      catalog: cat, caps: caps(TODAY, 181, 300),
      declarations: [{ readingId: "r1", step: 1, confidence: 5, answered: null, correct: null }],
      doneOn: { r1: { 1: "2025-12-20" } },
    }));
    expect(r.windows[0].steps[0]).toMatchObject({ status: "done", doneOn: "2025-12-20" });
  });

  it("a plan born inside the gate window has no separate gate and still plans mocks", () => {
    const today = addDays(EXAM, -20);
    const r = planSteps(input({
      today, caps: caps(today, 20, 300), catalog: [mod("r1", 1, 1)], mockSessions: sessions(20),
    }));
    expect(r.windows[0].steps[0].status).toBe("planned");
    expect(r.tasks.some((t) => t.item.step === 5)).toBe(true);
  });

  it("runs a full-size plan (51 modules x ~180 days) in under 300 ms", () => {
    const warm = planSteps(input());
    expect(warm.tasks.length).toBeGreaterThan(0);
    const t0 = performance.now();
    planSteps(input());
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(300);
  });

  it("is deterministic", () => {
    const a = planSteps(input());
    const b = planSteps(input());
    expect(JSON.stringify(a.tasks)).toBe(JSON.stringify(b.tasks));
  });

  it("light 4-module 120-day plan is feasible with all mocks placed", () => {
    const cat = [1, 2, 3, 4].map((i) => mod(`r${i}`, i, 1));
    const r = planSteps(input({
      catalog: cat, caps: caps(TODAY, 120, 360), exam: addDays(TODAY, 120),
    }));
    expect(r.fit.feasible).toBe(true);
    expect(r.unplaced).toEqual([]);
  });
});
