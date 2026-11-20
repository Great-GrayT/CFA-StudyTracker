import { describe, it, expect } from "vitest";
import {
  planWindow, barGeometry, circlePos, axisTicks, formatReadiness, formatHours, stepFractions,
  weakestSection, owedMinutes, trackingBuckets, cumulative, sortModules, behindCount, hasAnyProgress,
  sectionWindows, day, DAY, moduleHref, accuracy, perfRows,
  planTotalsLine, dailyNeed, stepSlices, topicMetrics,
} from "./pace-view";
import {
  dayInfo, formatWeight, hourFigures, planVsSchedule, planDays, monthGrid, monthMarks, clusterMocks, daySegments,
  splitMinutes, budgetSplit, budgetTicks, stepLedger, verdictLine, keyFigures, MOCK_FULL_MIN,
} from "./pace-view";
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

describe("planDays and monthGrid", () => {
  it("lists every day from plan start to the exam and groups them by month", () => {
    const days = planDays(base());
    expect(days[0]!.date).toBe("2026-11-01");
    expect(days[days.length - 1]!.date).toBe("2027-05-18");
    expect(days).toHaveLength(199);
    expect(days.find((d) => d.today)!.idx).toBe(19);
    const m = monthGrid(days);
    expect(m.map((x) => x.key)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05"]);
    expect(m[0]!.label).toBe("November 2026");
    expect(m[0]!.lead).toBe(6);
    expect(m[0]!.days).toHaveLength(30);
    expect(m[6]!.days).toHaveLength(18);
    expect(monthMarks(days).map((x) => x.label).slice(0, 3)).toEqual(["Nov 2026", "Dec", "Jan 2027"]);
  });
  it("starts a partial first month at the plan start", () => {
    const m = monthGrid(planDays(base({ calendar: { start: "2026-11-18", mocks: [] } })));
    expect(m[0]!.days).toHaveLength(13);
    expect(m[0]!.lead).toBe(2);
  });
  it("includes today when it falls after the exam", () => {
    const days = planDays(base({ asOf: "2027-06-01" }));
    expect(days[days.length - 1]!.date).toBe("2027-06-01");
  });
});

describe("mock sessions", () => {
  it("clusters near sessions into one counted ring", () => {
    const c = clusterMocks([20, 23, 26, 28, 30].map((idx) => ({ idx, done: false })));
    expect(c.map((x) => x.count)).toEqual([3, 2]);
    expect(c[0]!.idx).toBe(23);
    expect(clusterMocks([{ idx: 1, done: true }, { idx: 2, done: false }])[0]!.done).toBe(false);
  });
  it("names sessions per mock and splits sitting from review", () => {
    const mocks = ["2027-04-20", "2027-04-23", "2027-04-26"].map((date) => ({ date, done: false, title: null }));
    const p = base({
      calendar: { start: "2026-11-01", mocks },
      daily: [{ date: "2027-04-23", plannedMin: 198, doneMin: 0, byStep: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 198 } }],
    });
    const d = dayInfo(p, "2027-04-23");
    expect(d.events.map((e) => e.text)).toEqual(["Mock 1 session 2"]);
    expect(d.steps.map((x) => [x.key, x.min])).toEqual([["5", 132], ["5r", 66]]);
    expect(dayInfo(p, "2027-04-26").events[0]!.text).toBe("Mock 2 session 1");
    expect(daySegments({ "5": 66 }, false)).toEqual([{ key: "5r", min: 66 }]);
  });
});

describe("budget split", () => {
  const trims = [
    { readingId: "r", step: 4, minutes: 300, reason: "step 4 base" },
    { readingId: null, step: 5, minutes: 0, reason: "mock-window-full" },
  ];
  const fit = { crash: 1.5, cancelledHolidayIds: [], feasible: false, belowPass: true, trims };
  const p = () => base({ fit, daily: [row("2026-11-19", 60, 60), row("2026-11-20", 600), row("2026-11-21", 300)] });
  it("adds up to the required hours and counts only today onwards as ahead", () => {
    const b = budgetSplit(p())!;
    expect(b.aheadMin).toBe(900);
    expect(b.cutMin).toBe(300 + MOCK_FULL_MIN);
    expect(b.doneMin + b.aheadMin + b.paceMin + b.cutMin).toBe(b.requiredMin);
    expect(b.paceMin).toBe(944 * 60 - 540 - 900 - 300 - MOCK_FULL_MIN);
    expect(b.cutMocks).toBe(1);
  });
  it("never goes negative or past the total when parts overshoot", () => {
    const s = splitMinutes(100, 60, 60, 60);
    expect(s).toEqual({ doneMin: 60, aheadMin: 40, cutMin: 0, paceMin: 0 });
    expect(budgetSplit(base({ totals: undefined }))).toBeNull();
  });
  it("gives round ticks ending at the exact total", () => {
    expect(budgetTicks(494 * 60)).toEqual([0, 100, 200, 300, 400, 494]);
    expect(budgetTicks(0)).toEqual([0]);
  });
  it("builds a ledger row per step with its split", () => {
    const t = { ...totals, byStep: Object.fromEntries(["1", "2", "3", "4", "5"].map((k) => [k, { requiredMin: k === "4" ? 1000 : 0, doneMin: 0 }])) };
    const rows = stepLedger(base({ fit, totals: t, daily: [{ date: "2026-11-21", plannedMin: 500, doneMin: 0, byStep: { "1": 0, "2": 0, "3": 0, "4": 500, "5": 0 } }] }));
    expect(rows.map((r) => r.key)).toEqual(["4", "5"]);
    expect(rows[0]).toMatchObject({ fullMin: 1000, aheadMin: 500, cutMin: 300, paceMin: 200 });
    expect(rows[1]!.cutMocks).toBe(1);
  });
  it("words the verdict and figures", () => {
    expect(verdictLine(p())).toMatch(/^Your plan holds 16 of 944 hours by studying at 1\.5x pace\./);
    expect(verdictLine(p())).toContain("The cut is 5 h of review questions and 1 mock.");
    expect(verdictLine(base({ totals: undefined }))).toBeNull();
    const f = keyFigures(base({ totals: { ...totals, questions: { required: 3915, answered: 97, correct: 83 } } }));
    expect(f[0]!.value).toBe("16 h");
    expect(f.find((x) => x.note.startsWith("to finish everything"))!.alarm).toBe(true);
    expect(f[f.length - 1]!.value).toBe("0.5 of 0.5 mocks");
  });
});

describe("dayInfo", () => {
  const byStep = { "1": 120, "2": 0, "3": 60, "4": 0, "5": 0 };
  it("splits planned hours by non-zero step and lists events", () => {
    const p = base({
      daily: [{ date: "2026-12-25", plannedMin: 180, doneMin: 0, byStep }, row("2026-11-20", 60, 30)],
      calendar: { start: "2026-11-01", mocks: [{ date: "2026-12-25", done: false, title: "Mock 1" }] },
    });
    const d = dayInfo(p, "2026-12-25");
    expect(d.label).toBe("Fri 25 Dec");
    expect(d.steps.map((x) => x.key)).toEqual(["1", "3"]);
    expect(d.doneMin).toBeNull();
    expect(d.events.map((e) => e.text)).toEqual(["Holiday 24 Dec to 2 Jan", "Mock 1 session 1"]);
    expect(d.text).toContain("3 h planned");
  });
  it("marks today with done hours, the gate and the exam day", () => {
    const p = base();
    expect(dayInfo(p, "2026-11-20").events[0]!.kind).toBe("today");
    expect(dayInfo(p, "2026-11-20").doneMin).toBe(0);
    expect(dayInfo(p, "2027-04-18").events.map((e) => e.text)).toEqual(["Mocks start"]);
    expect(dayInfo(p, "2027-05-18").events.map((e) => e.text)).toEqual(["Exam day"]);
    expect(dayInfo(p, "2027-05-18").text).toContain("Nothing planned");
  });
});

describe("planVsSchedule", () => {
  const t = (req: number[]) => ({
    ...totals,
    byStep: Object.fromEntries(req.map((r, i) => [String(i + 1), { requiredMin: r, doneMin: 0 }])),
  });
  const d = (n: number[]) => ({ date: "2026-11-20", plannedMin: 0, doneMin: 0, byStep: Object.fromEntries(n.map((x, i) => [String(i + 1), x])) });
  it("cuts only step 4, by its trims; other gaps are pace, not cuts", () => {
    const fit = { crash: 1.5, cancelledHolidayIds: [], feasible: false, belowPass: true,
      trims: [{ readingId: "r", step: 4, minutes: 400, reason: "step 4 base" }] };
    const r = planVsSchedule(base({ totals: t([600, 300, 0, 600, 0]), daily: [d([400, 200, 0, 133, 0])], calendar: undefined, fit }))!;
    expect(r.rows.map((x) => x.key)).toEqual(["1", "2", "4"]);
    expect(r.rows[0]!.text).toBe("10 h kept whole in 6.7 h at 1.5x pace");
    expect(r.rows[0]!.whole).toBe(true);
    expect(r.rows[2]!.text).toBe("10 h planned, 6.7 h cut, the rest in 2.2 h at 1.5x pace");
    expect(r.rows[2]!.kept).toBeCloseTo(1 / 3);
    expect(r.note).toMatch(/1\.5x your normal pace/);
  });
  it("counts mocks as two sessions and groups trim reasons", () => {
    const mocks = Array.from({ length: 14 }, (_, i) => ({ date: `2027-05-${String(i + 1).padStart(2, "0")}`, done: false, title: null }));
    const trims = [1, 2, 3].map(() => ({ readingId: null, step: 5, minutes: 120, reason: "mock-window-full" }));
    const fit = { crash: 1, cancelledHolidayIds: [], feasible: false, belowPass: true, trims };
    const r = planVsSchedule(base({ totals: t([60, 0, 0, 0, 600]), daily: [d([60, 0, 0, 0, 420])], calendar: { start: "2026-11-01", mocks }, fit }))!;
    const m = r.rows.find((x) => x.key === "5")!;
    expect(m.text).toBe("10 mocks, 7 scheduled, 3 cut (mock window full)");
    expect(m.kept).toBeCloseTo(0.7);
    expect(r.note).toMatch(/^Your hours cannot hold/);
  });
  it("is null without totals", () => {
    expect(planVsSchedule(base({ totals: undefined }))).toBeNull();
  });
});
