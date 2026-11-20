import { describe, it, expect } from "vitest";
import {
  planWindow, barGeometry, circlePos, axisTicks, formatReadiness, formatHours, stepFractions,
  weakestSection, owedMinutes, trackingBuckets, cumulative, sortModules, behindCount, hasAnyProgress,
  sectionWindows, day, DAY, moduleHref, accuracy, perfRows,
  planTotalsLine, dailyNeed, stepSlices, topicMetrics,
} from "./pace-view";
import { calendarStrip, formatWeight, hourFigures } from "./pace-view";
import type { PlanTotals, Projection, ProjectionSection, ProjectionWindow } from "./types";

const TODAY = "2026-11-16";
const EXAM = "2027-05-20";
const w = (
  step: 1 | 2 | 3 | 4,
  start: string | null,
  due: string | null,
  status: ProjectionWindow["status"] = "planned",
): ProjectionWindow => ({ step, start, due, doneOn: null, status });

describe("planWindow", () => {
  it("spans 6 days back to the exam day for To exam", () => {
    const x = planWindow("exam", TODAY, EXAM);
    expect(x.start).toBe(day("2026-11-10"));
    expect(x.end).toBe(day(EXAM) + DAY);
  });
  it("month is 3 back and 28 ahead, week is 1 back and 7 ahead", () => {
    expect(planWindow("month", TODAY, EXAM)).toEqual({ start: day("2026-11-13"), end: day("2026-12-14") });
    expect(planWindow("week", TODAY, EXAM)).toEqual({ start: day("2026-11-15"), end: day("2026-11-23") });
  });
});

describe("bar geometry", () => {
  const win = planWindow("week", TODAY, EXAM);
  it("clamps a bar that starts before the window", () => {
    const g = barGeometry("2026-11-01", "2026-11-17", win)!;
    expect(g.left).toBe(0);
    expect(g.width).toBeCloseTo(((day("2026-11-18") - win.start) / (win.end - win.start)) * 100);
  });
  it("is null outside the window and with no dates", () => {
    expect(barGeometry("2027-01-01", "2027-01-05", win)).toBeNull();
    expect(barGeometry(null, null, win)).toBeNull();
  });
  it("a due-only window is a one day bar", () => {
    expect(barGeometry(null, "2026-11-17", win)!.width).toBeCloseTo(100 / 8);
  });
  it("circle sits at the end of the due day, null when outside", () => {
    expect(circlePos("2026-11-16", win)).toBeCloseTo(((day("2026-11-17") - win.start) / (win.end - win.start)) * 100);
    expect(circlePos("2026-12-30", win)).toBeNull();
    expect(circlePos(null, win)).toBeNull();
  });
});

describe("axisTicks", () => {
  it("exam: first of each month", () => {
    const t = axisTicks("exam", planWindow("exam", TODAY, EXAM));
    expect(t[0].label).toBe("Dec");
    expect(t[t.length - 1].label).toBe("May");
    expect(t).toHaveLength(6);
  });
  it("week: a tick per day inside, month: weekly", () => {
    expect(axisTicks("week", planWindow("week", TODAY, EXAM))).toHaveLength(7);
    expect(axisTicks("month", planWindow("month", TODAY, EXAM))).toHaveLength(5);
  });
});

describe("formatting", () => {
  it("readiness formats and never yields NaN", () => {
    expect(formatReadiness(0.041)).toBe("4.1%");
    expect(formatReadiness(0)).toBe("0%");
    expect(formatReadiness(1)).toBe("100%");
    expect(formatReadiness(NaN)).toBe("0%");
    expect(formatReadiness(2)).toBe("100%");
  });
  it("hours", () => {
    expect(formatHours(360)).toBe("6 h");
    expect(formatHours(108)).toBe("1.8 h");
    expect(formatHours(0)).toBe("0 h");
  });
});

describe("stepFractions", () => {
  it("fractions of planned minutes, spent capped to the remainder", () => {
    expect(
      stepFractions({ step: 1, plannedMin: 100, donePassedMin: 40, spentUnpassedMin: 80, planTodayMin: 50 }),
    ).toEqual({ done: 0.4, spent: 0.6, tick: 0.5 });
  });
  it("zero planned is all zero", () => {
    expect(
      stepFractions({ step: 1, plannedMin: 0, donePassedMin: 5, spentUnpassedMin: 0, planTodayMin: 0 }),
    ).toEqual({ done: 0, spent: 0, tick: 0 });
  });
});

const sec = (id: string, initial: { answered: number; correct: number } | null): ProjectionSection => ({
  topicId: id,
  name: id,
  examWeight: 0.1,
  steps: [],
  modules: [],
  performance: { initial, review: null, mocks: null, extras: { tasks: 0, minutes: 0 } },
});

describe("performance and behind", () => {
  it("weakest section is lowest accuracy with answers", () => {
    expect(
      weakestSection([sec("a", { answered: 10, correct: 9 }), sec("b", { answered: 10, correct: 6 }), sec("c", null)]),
    ).toEqual({ topicId: "b", name: "b", accuracy: 0.6 });
    expect(weakestSection([sec("c", null), sec("d", { answered: 0, correct: 0 })])).toBeNull();
    expect(accuracy({ answered: 0, correct: 0 })).toBeNull();
  });
  it("owed minutes sums past days only, never negative", () => {
    const daily = [
      { date: "2026-11-14", plannedMin: 120, doneMin: 60, byStep: {} },
      { date: "2026-11-15", plannedMin: 60, doneMin: 60, byStep: {} },
      { date: "2026-11-16", plannedMin: 90, doneMin: 0, byStep: {} },
    ] as unknown as Projection["daily"];
    expect(owedMinutes(daily, TODAY)).toBe(60);
    expect(owedMinutes([], TODAY)).toBe(0);
  });
});

describe("tracking buckets", () => {
  const mk = (date: string, p: number, d: number) => ({
    date,
    plannedMin: p,
    doneMin: d,
    byStep: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
  });
  const daily = [mk("2026-11-15", 60, 30), mk("2026-11-16", 60, 0), mk("2026-12-02", 60, 0)];
  it("exam groups by month with owed only for past days", () => {
    const b = trackingBuckets("exam", daily, [], TODAY);
    expect(b.map((x) => x.label)).toEqual(["Nov", "Dec"]);
    expect(b[0]).toMatchObject({ plannedMin: 120, doneMin: 30, owedMin: 30 });
    const c = cumulative(b, day(TODAY));
    expect(c.planned).toEqual([120, 180]);
    expect(c.done).toEqual([30, null]);
  });
  it("week gives seven days from Monday, holidays and empty days off", () => {
    const b = trackingBuckets("week", daily, [{ id: "h", start: "2026-11-17", end: "2026-11-17", cancelled: false }], TODAY);
    expect(b).toHaveLength(7);
    expect(b[0].key).toBe("2026-11-16");
    expect(b[1].off).toBe(true);
    expect(b[0].off).toBe(false);
  });
  it("a cancelled holiday is not greyed", () => {
    const b = trackingBuckets("week", [mk("2026-11-17", 60, 0)], [{ id: "h", start: "2026-11-17", end: "2026-11-17", cancelled: true }], TODAY);
    expect(b[1].off).toBe(false);
  });
  it("month gives weeks that cover the month once", () => {
    const b = trackingBuckets("month", daily, [], TODAY);
    expect(b.length).toBeGreaterThanOrEqual(4);
    expect(b.reduce((a, x) => a + x.plannedMin, 0)).toBe(120);
  });
});

describe("sorting modules", () => {
  const m = (name: string, ws: ProjectionWindow[]) => ({ name, windows: ws });
  const mods = [
    m("a", [w(1, null, "2026-11-20")]),
    m("b", [w(1, null, "2026-11-10"), w(2, null, "2026-11-12")]),
    m("c", [w(1, null, "2026-11-10", "done")]),
    m("d", [w(2, null, "2026-11-30", "overdue")]),
  ];
  it("counts past-due and overdue windows, not done ones", () => {
    expect(mods.map((x) => behindCount(x, TODAY))).toEqual([0, 2, 0, 1]);
  });
  it("most behind first is stable, only behind filters", () => {
    expect(sortModules(mods, "behind", TODAY).map((x) => x.name)).toEqual(["b", "d", "a", "c"]);
    expect(sortModules(mods, "only-behind", TODAY).map((x) => x.name)).toEqual(["b", "d"]);
    expect(sortModules(mods, "curriculum", TODAY)).toBe(mods);
  });
});

describe("misc", () => {
  it("section window spans earliest start to latest due per step", () => {
    const r = sectionWindows([
      { windows: [w(1, "2026-11-10", "2026-11-12", "done")] },
      { windows: [w(1, "2026-11-13", "2026-11-15")] },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ step: 1, start: "2026-11-10", due: "2026-11-15", status: "planned" });
  });
  it("empty projection has no progress", () => {
    const p = { sections: [sec("a", null)], daily: [] } as unknown as Projection;
    expect(hasAnyProgress(p)).toBe(false);
  });
  it("module href carries the reading", () => {
    expect(moduleHref("qm", "r 1")).toBe("/syllabus/qm?reading=r%201");
  });
});

import { reasonText, shortDate } from "./pace-view";
describe("copy helpers", () => {
  it("names known extra reasons and tolerates unknown ones", () => {
    expect(reasonText("top-up-80")).toBe("Top-up to reach 80%");
    expect(reasonText("some-new-reason")).toBe("Some new reason");
  });
  it("short dates", () => {
    expect(shortDate("2027-04-20")).toBe("20 Apr");
    expect(shortDate(null)).toBe("");
  });
});

describe("perfRows", () => {
  const perf = (answered: number, correct: number, minutes: number, adequateMin: number) => ({
    round: 1, answered, correct, minutes, adequateMin, passed: false,
  });
  const proj = {
    sections: [
      {
        topicId: "qm",
        name: "QM",
        modules: [
          { readingId: "r1", name: "Fit", windows: [], performance: { s2: perf(40, 24, 140, 120), s4: null } },
          { readingId: "r2", name: "Idle", windows: [], performance: { s2: null, s4: null } },
          { readingId: "r3", name: "Both", windows: [], performance: { s2: perf(24, 20, 80, 110), s4: perf(10, 9, 30, 30) } },
        ],
      },
    ],
    extras: [
      { taskId: "t1", readingId: "r1", step: 2, reason: "top-up-80", questions: 40, minutes: 70, date: "2026-11-18" },
      { taskId: null, readingId: "r1", step: 3, reason: "exemption-review", questions: null, minutes: 20, date: null },
      { taskId: "t3", readingId: "r3", step: 4, reason: "top-up-adequacy", questions: 10, minutes: 30, date: "2026-11-20" },
      { taskId: "t9", readingId: "elsewhere", step: 2, reason: "top-up-80", questions: 5, minutes: 9, date: null },
    ],
  } as unknown as Projection;

  it("lists only modules with attempts, one row per question step", () => {
    expect(perfRows(proj).map((r) => r.key)).toEqual(["r1|2", "r3|2", "r3|4"]);
  });
  it("computes accuracy, the 80% flag and whether the time was enough", () => {
    const [a, b] = perfRows(proj);
    expect(a).toMatchObject({ label: "QM · Fit", accuracy: 0.6, low: true, enough: true, minutes: 140, adequateMin: 120 });
    expect(b).toMatchObject({ low: false, enough: false, minutes: 80, adequateMin: 110 });
  });
  it("attaches extras by module and step, strays to the first row, with reason copy", () => {
    const rows = perfRows(proj);
    expect(rows[0]!.extras.map((e) => e.taskId)).toEqual(["t1", null]);
    expect(rows[0]!.extras[0]).toEqual({ taskId: "t1", text: "+40 q, due 18 Nov", reason: "Top-up to reach 80%", date: "2026-11-18" });
    expect(rows[0]!.extras[1]!.text).toBe("+20 min");
    expect(rows[1]!.extras).toEqual([]);
    expect(rows[2]!.extras.map((e) => e.taskId)).toEqual(["t3"]);
  });
});

describe("plan metrics", () => {
  const step = (k: string, requiredMin: number, doneMin: number) => [k, { requiredMin, doneMin }] as const;
  const totals: PlanTotals = {
    requiredMin: 1000, doneMin: 250, leftMin: 750,
    byStep: Object.fromEntries([step("1", 400, 200), step("2", 300, 50), step("3", 100, 0), step("4", 100, 0), step("5", 100, 0)]) as PlanTotals["byStep"],
    questions: { required: 1840, answered: 100, correct: 70 },
    daysLeft: 100, minPerDayNeeded: 90, minPerDayAvailable: 60,
  };
  const sec = (q?: { required: number; answered: number; correct: number }) =>
    ({
      topicId: "t", name: "Ethics", examWeight: 15, questions: q,
      steps: [1, 2, 3, 4].map((n) => ({ step: n, plannedMin: 60, donePassedMin: 30, spentUnpassedMin: 10, planTodayMin: 0 })),
      modules: [], performance: { initial: null, review: null, mocks: null, extras: { tasks: 0, minutes: 0 } },
    }) as unknown as ProjectionSection;
  const proj = (over: Partial<Projection>) => ({ mocks: { done: 1, planned: 5, firstDate: null }, sections: [], ...over }) as unknown as Projection;

  it("summarises totals in one line", () => {
    expect(planTotalsLine(proj({ totals }))).toBe("16.7 h planned, 1,840 questions, 6 mock sessions");
    expect(planTotalsLine(proj({}))).toBeNull();
  });
  it("flags a shortfall only when need exceeds availability", () => {
    expect(dailyNeed(totals).short).toBe(true);
    expect(dailyNeed({ ...totals, minPerDayNeeded: 60 }).short).toBe(false);
  });
  it("slices the bar by required share with done share per slice", () => {
    const sl = stepSlices(totals);
    expect(sl.map((x) => x.width)).toEqual([40, 30, 10, 10, 10]);
    expect(sl[0]!.done).toBe(0.5);
    expect(sl[4]!.label).toBe("Mocks");
    expect(stepSlices({ ...totals, requiredMin: 0, byStep: { ...totals.byStep, "1": { requiredMin: 0, doneMin: 0 } } })[0]!.done).toBe(0);
  });
  it("marks a topic below target by integer compare, default 80", () => {
    const [a] = topicMetrics(proj({ sections: [sec({ required: 50, answered: 10, correct: 8 })] }));
    expect(a!.below).toBe(false);
    expect(a!.plannedMin).toBe(240);
    expect(a!.doneMin).toBe(160);
    expect(topicMetrics(proj({ sections: [sec({ required: 50, answered: 10, correct: 8 })], rules: { accuracyTarget: 85 } as Projection["rules"] }))[0]!.below).toBe(true);
    const [none] = topicMetrics(proj({ sections: [sec(undefined)] }));
    expect(none!.accuracy).toBeNull();
    expect(none!.below).toBe(false);
  });
});

describe("formatWeight", () => {
  it("shows a 0..1 fraction as a percent, decimal only when needed", () => {
    expect(formatWeight(0.125)).toBe("12.5%");
    expect(formatWeight(0.08)).toBe("8%");
    expect(formatWeight(0)).toBe("0%");
  });
});

const row = (date: string, plannedMin: number, doneMin = 0) => ({
  date, plannedMin, doneMin, byStep: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
});
const totals = { requiredMin: 944 * 60, doneMin: 9 * 60, leftMin: 425 * 60, minPerDayAvailable: 120, workDays: 100, daysLeft: 150 };
const base = (over: Record<string, unknown> = {}) => ({
  asOf: "2026-11-20", exam: "2027-05-18", gate: "2027-04-18",
  fit: { crash: 1, cancelledHolidayIds: [], feasible: true, belowPass: false, trims: [] },
  totals, daily: [row("2026-11-19", 60, 60), row("2026-11-20", 600), row("2026-11-21", 300)],
  holidays: [{ id: "h", start: "2026-12-24", end: "2027-01-02", cancelled: false }],
  mocks: { done: 0, planned: 0, firstDate: null },
  calendar: { start: "2026-11-01", mocks: [{ date: "2027-04-20", done: false, title: "Mock 1" }] },
  ...over,
}) as unknown as Projection;

describe("hourFigures", () => {
  it("splits required into done, on schedule and not in schedule", () => {
    const f = hourFigures(base())!;
    expect(f.scheduled).toBe(960);
    expect(f.left).toBe(960 - 540);
    expect(f.unscheduled).toBe(944 * 60 - 540 - f.left);
    expect(f.perDaySchedule).toBeCloseTo(f.left / 100);
    expect(f.reason).toBe("Does not fit your available hours");
  });
  it("names the below-pass trim and shows no reason when everything is scheduled", () => {
    const fit = { crash: 1, cancelledHolidayIds: [], feasible: false, belowPass: true, trims: [] };
    expect(hourFigures(base({ fit }))!.reason).toMatch(/^Below-pass plan/);
    expect(hourFigures(base({ totals: { ...totals, requiredMin: 960 } }))!.reason).toBeNull();
  });
  it("flags a day over the available hours and never divides by zero", () => {
    expect(hourFigures(base())!.shortAll).toBe(true);
    const z = hourFigures(base({ totals: { ...totals, workDays: undefined } }))!;
    expect(z.perDayAll).toBe(0);
  });
});

describe("calendarStrip", () => {
  it("places today, exam, gate, holidays and mocks along the plan span", () => {
    const c = calendarStrip(base());
    expect(c.today).toBeGreaterThan(0);
    expect(c.today!).toBeLessThan(c.gate!);
    expect(c.gate!).toBeLessThan(c.exam);
    expect(c.exam).toBeLessThanOrEqual(100);
    expect(c.holidays).toHaveLength(1);
    expect(c.mocks[0]!.pct).toBeGreaterThan(c.gate!);
    expect(c.months[0]!.label).toBe("Dec");
    expect(c.caption).toBe(
      "Today 20 Nov. Exam 18 May 2027, 179 days away. Mocks from 18 Apr. 1 mock session planned, 20 Apr. Holidays: 24 Dec to 2 Jan.",
    );
  });
  it("merges mocks days apart into one counted marker", () => {
    const mocks = ["2027-05-11", "2027-05-12", "2027-05-13"].map((date) => ({ date, done: false, title: null }));
    const c = calendarStrip(base({ calendar: { start: "2026-11-01", mocks } }));
    expect(c.mocks).toHaveLength(1);
    expect(c.mocks[0]!.count).toBe(3);
    expect(c.caption).toContain("3 mock sessions planned, 11 May to 13 May.");
  });
  it("falls back to the first daily date and marks cancelled holidays", () => {
    const c = calendarStrip(base({ calendar: undefined, holidays: [{ id: "h", start: "2026-12-24", end: "2026-12-24", cancelled: true }] }));
    expect(c.win.start).toBe(Date.parse("2026-11-19T00:00:00Z"));
    expect(c.holidays[0]!.label).toBe("24 Dec (cancelled)");
    expect(c.caption).not.toContain("Holidays");
  });
});
