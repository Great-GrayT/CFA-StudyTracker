import { describe, it, expect } from "vitest";
import { schedule, crashFactor, type ScheduleInput } from "./schedule";
import { addDays } from "./dates";
import { caps, item } from "./testkit";
import type { MockSession } from "./mocks";

const base = (o: Partial<ScheduleInput>): ScheduleInput => ({
  today: "2026-01-01", exam: "2026-01-15", caps: caps("2026-01-01", 14, 120), work: [], modules: [],
  mockSessions: [], mockTrim: 99, reviewPolicy: "fixed-date", reviewStartDate: null, order: "curriculum-topic", ...o,
});
const sumBy = (r: ReturnType<typeof schedule>, date: string) =>
  r.tasks.filter((t) => t.date === date).reduce((a, t) => a + t.minutes, 0);

describe("schedule", () => {
  it("spreads exactly the needed work evenly (10 h over 14 days of 120 min = 50%)", () => {
    const r = schedule(base({ work: [item({ minutes: 600 })] }));
    expect(r.unplaced).toEqual([]);
    expect(r.load).toBeCloseTo(600 / 1680, 5);
    const days = new Set(r.tasks.map((t) => t.date));
    expect(days.size).toBe(14);
    for (const d of days) expect(sumBy(r, d)).toBeCloseTo(600 / 14, 3);
    expect(r.tasks.reduce((a, t) => a + t.minutes, 0)).toBeCloseTo(600, 6);
  });

  it("pieces are >= 15 min unless they finish the item", () => {
    const r = schedule(base({ work: [item({ minutes: 100 }), item({ minutes: 40 })] }));
    for (const t of r.tasks) {
      const total = t.item.minutes;
      const done = r.tasks.filter((x) => x.item.id === t.item.id).reduce((a, x) => a + x.minutes, 0);
      const last = r.tasks.filter((x) => x.item.id === t.item.id).slice(-1)[0] === t;
      expect(t.minutes >= 15 - 1e-6 || (last && Math.abs(done - total) < 1e-6)).toBe(true);
    }
  });

  it("respects after: dependent never starts before predecessor finishes", () => {
    const a = item({ minutes: 300, id: "A" });
    const b = item({ minutes: 100, id: "B", after: ["A"], step: 2, kind: "questions" });
    const r = schedule(base({ work: [a, b] }));
    const lastA = r.tasks.filter((t) => t.item.id === "A").map((t) => t.date).sort().slice(-1)[0]!;
    const firstB = r.tasks.filter((t) => t.item.id === "B").map((t) => t.date).sort()[0];
    expect(firstB >= lastA).toBe(true);
  });

  it("steps 1-2 finish by the gate (exam - 30)", () => {
    const exam = "2026-04-01";
    const w = [item({ minutes: 3000, id: "A" }), item({ minutes: 1000, id: "B", step: 3, kind: "review", after: ["A"] })];
    const r = schedule(base({ exam, caps: caps("2026-01-01", 90, 120), work: w }));
    expect(r.unplaced).toEqual([]);
    const lastA = r.tasks.filter((t) => t.item.id === "A").map((t) => t.date).sort().slice(-1)[0]!;
    expect(lastA <= addDays(exam, -30)).toBe(true);
  });

  it("zero-cap days are skipped and load > 1 is reported with unplaced work", () => {
    const c = caps("2026-01-01", 14, 120).map((d, i) => (i % 2 ? { ...d, minutes: 0 } : d));
    const r = schedule(base({ caps: c, work: [item({ minutes: 2000 })] }));
    expect(r.load).toBeGreaterThan(1);
    expect(r.unplaced.length).toBe(1);
    expect(r.tasks.every((t) => c.find((d) => d.date === t.date)!.minutes > 0)).toBe(true);
  });

  it("no capacity at all does not divide by zero", () => {
    const r = schedule(base({ caps: caps("2026-01-01", 14, 0), work: [item({ minutes: 60 })] }));
    expect(r.load).toBe(Infinity);
    expect(r.unplaced.length).toBe(1);
    const r2 = schedule(base({ today: "2026-01-20", work: [item({ minutes: 60 })] }));
    expect(r2.tasks).toEqual([]);
  });

  it("crash shortens scheduled minutes and keeps workMinutes uncrashed", () => {
    const w = [item({ minutes: 150, kind: "read" }), item({ minutes: 100, kind: "questions", step: 2 })];
    const r = schedule(base({ work: w, crash: 1.5 }));
    const s = r.tasks.reduce((a, t) => a + t.minutes, 0);
    expect(s).toBeCloseTo(100 + 75, 5);
    expect(r.tasks.reduce((a, t) => a + t.workMinutes, 0)).toBeCloseTo(250, 5);
    expect(crashFactor(w[1], 1.5)).toBeCloseTo(0.75);
  });

  describe("review policy gating for step 3", () => {
    const mk = () => {
      const q = item({ id: "Q", minutes: 60, step: 2, kind: "questions", readingId: "r1" });
      const v = item({ id: "V", minutes: 30, step: 3, kind: "review", readingId: "r1", after: ["Q"] });
      return [q, v];
    };
    const firstV = (r: ReturnType<typeof schedule>) =>
      r.tasks.filter((t) => t.item.id === "V").map((t) => t.date).sort()[0];
    const lastQ = (r: ReturnType<typeof schedule>) =>
      r.tasks.filter((t) => t.item.id === "Q").map((t) => t.date).sort().slice(-1)[0]!;
    const wide = { exam: "2026-03-01", caps: caps("2026-01-01", 59, 120) };

    it("decay-triggered waits 14 days after step 2", () => {
      const r = schedule(base({ ...wide, work: mk(), reviewPolicy: "decay-triggered" }));
      expect(r.unplaced).toEqual([]);
      expect(firstV(r) >= addDays(lastQ(r), 14)).toBe(true);
    });
    it("after-coverage waits until every module's step 2 is done", () => {
      const other = item({ id: "Q2", minutes: 1500, step: 2, kind: "questions", readingId: "r2" });
      const r = schedule(base({ ...wide, work: [...mk(), other], reviewPolicy: "after-coverage" }));
      const lastQ2 = r.tasks.filter((t) => t.item.id === "Q2").map((t) => t.date).sort().slice(-1)[0]!;
      expect(firstV(r) > lastQ2).toBe(true);
    });
    it("fixed-date holds step 3 until the date", () => {
      const r = schedule(base({ ...wide, work: mk(), reviewPolicy: "fixed-date", reviewStartDate: "2026-02-10" }));
      expect(firstV(r) >= "2026-02-10").toBe(true);
    });
    it("weekly-interleave limits reviews to 20% of a week while steps 1-2 remain", () => {
      const q = item({ id: "Q", minutes: 2400, step: 2, kind: "questions", readingId: "r1" });
      const v = item({ id: "V", minutes: 600, step: 3, kind: "review", readingId: "r2" });
      const r = schedule(base({ ...wide, work: [q, v], reviewPolicy: "weekly-interleave" }));
      expect(r.unplaced).toEqual([]);
      const wk1 = r.tasks.filter((t) => t.item.id === "V" && t.date < "2026-01-05");
      expect(wk1.reduce((a, t) => a + t.minutes, 0)).toBeLessThanOrEqual(0.2 * 120 * 4 + 1e-6);
    });
    it("relaxes the policy rather than leaving work unplaced", () => {
      const r = schedule(base({
        exam: "2026-01-11", caps: caps("2026-01-01", 10, 120), work: mk(), reviewPolicy: "decay-triggered",
      }));
      expect(r.unplaced).toEqual([]);
      expect(r.relaxedPolicy).toBe(true);
    });
  });

  describe("mocks", () => {
    const mbase = (o: Partial<ScheduleInput>) => base({ mockTrim: 0, ...o });
    const exam = "2026-03-01";
    const sessions = (n: number): MockSession[] => Array.from({ length: n }, (_, i) => ({
      ref: `s${i}`, packageId: "pp", resourceId: `res${i}`, title: `Mock ${i}`, questionCount: 90,
      topicOrders: [1], done: false,
    }));
    const modules = [{ readingId: "r1", topicOrder: 1 }];
    // One entry per session: a session split across days keeps its first piece.
    const mockTasks = (r: ReturnType<typeof schedule>) => {
      const seen = new Set<string>();
      return r.tasks.filter((t) => t.item.kind === "mock" && !seen.has(t.item.id) && !!seen.add(t.item.id));
    };
    const weekOf = (d: string) => Math.floor((Date.parse(`${addDays(exam, -1)}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000 / 7) + 1;

    it("places 1/2/3/4 mocks (sessions x2) in weeks -4..-1, none before eligibility", () => {
      const w = [item({ id: "A", minutes: 300, readingId: "r1", step: 1 }),
        item({ id: "C", minutes: 100, readingId: "r1", step: 3, kind: "review", after: ["A"] })];
      const r = schedule(mbase({
        exam, caps: caps("2026-01-01", 59, 300), work: w, modules, mockSessions: sessions(20),
      }));
      expect(r.unplaced).toEqual([]);
      const perWeek: Record<number, number> = {};
      for (const t of mockTasks(r)) perWeek[weekOf(t.date)] = (perWeek[weekOf(t.date)] ?? 0) + 1;
      expect(perWeek).toEqual({ 4: 2, 3: 4, 2: 6, 1: 8 });
      const lastC = r.tasks.filter((t) => t.item.id === "C").map((t) => t.date).sort().slice(-1)[0]!;
      for (const t of mockTasks(r).filter((x) => x.item.mockRef !== null)) expect(t.date > lastC).toBe(true);
      expect(r.tasks.filter((t) => t.item.kind === "mock-review").length).toBeGreaterThanOrEqual(20);
    });

    it("with steps 1-3 done every mock is a real session, in supply order", () => {
      const r = schedule(mbase({ exam, caps: caps("2026-01-01", 59, 300), mockSessions: sessions(20), modules }));
      const refs = mockTasks(r).map((t) => t.item.mockRef);
      expect(refs.every((x) => x !== null)).toBe(true);
      expect(new Set(refs).size).toBe(20);
    });

    it("falls back to generic mocks when supply runs out", () => {
      const r = schedule(mbase({ exam, caps: caps("2026-01-01", 59, 300), mockSessions: sessions(4), modules }));
      const gen = mockTasks(r).filter((t) => t.item.mockRef === null);
      expect(gen.length).toBe(16);
      expect(gen[0].item.label).toBe("Mock (any provider)");
      expect(gen[0].item.packageId).toBe("");
    });

    it("done sessions count toward the week they were done in", () => {
      const s = sessions(20).map((x, i) => (i < 2 ? { ...x, done: true, doneOn: addDays(exam, -26) } : x));
      const r = schedule(mbase({ exam, caps: caps("2026-01-01", 59, 300), mockSessions: s, modules }));
      const wk4 = mockTasks(r).filter((t) => weekOf(t.date) === 4);
      expect(wk4.length).toBe(0);
      expect(mockTasks(r).length).toBe(2 * 2 + 2 * 3 + 2 * 4);
    });

    it("a plan starting inside the gate window still places mocks", () => {
      const r = schedule(mbase({
        exam, today: addDays(exam, -20), caps: caps(addDays(exam, -20), 20, 300), mockSessions: sessions(20), modules,
      }));
      expect(mockTasks(r).length).toBeGreaterThan(0);
    });
  });
});
