import { describe, it, expect } from "vitest";
import {
  distinctCovered,
  splitWork,
  hoursBetween,
  readPace,
  missedDays,
  remainingWeekSplit,
  toISODate,
  addUTCDays,
  startOfUTCDay,
} from "./pace";
import type { LogEntry, Plan, WeeklyAvailability } from "./types";

const fullWeek: WeeklyAvailability = { mon: 2, tue: 2, wed: 2, thu: 2, fri: 2, sat: 2, sun: 2 };
const weekdaysOnly: WeeklyAvailability = { mon: 2, tue: 2, wed: 2, thu: 2, fri: 2, sat: 0, sun: 0 };

const log = (losId: string, date: string, id = `${losId}-${date}`): LogEntry => ({
  id,
  planId: "p",
  losId,
  packageId: null,
  date,
  confidence: 3,
  questionsAnswered: 0,
  questionsCorrect: 0,
  note: null,
});

const plan = (p: Partial<Plan> = {}): Plan => ({
  id: "p",
  userId: "u",
  levelId: "II",
  startDate: "2026-09-01",
  examDate: "2027-05-18",
  weeklyAvailability: fullWeek,
  isActive: true,
  createdAt: "2026-09-01",
  timeZone: "UTC",
  planMode: "curriculum-topic",
  reviewPolicy: "decay-triggered",
  reviewStartDate: null,
  emailCoach: "all",
  pushCoach: "all",
  coachSchedule: null,
  horizonGeneratedFor: null,
  city: null,
  countryCode: null,
  latitude: null,
  longitude: null,
  ...p,
});

describe("distinctCovered", () => {
  it("counts an outcome once however many times it was logged", () => {
    const logs = [log("a", "2026-09-01"), log("a", "2026-09-02"), log("b", "2026-09-03")];
    expect(distinctCovered(logs)).toBe(2);
  });
});

describe("splitWork", () => {
  it("counts the first session on an outcome as new and the rest as review", () => {
    const logs = [log("a", "2026-09-01"), log("a", "2026-09-02"), log("a", "2026-09-03")];
    expect(splitWork(logs)).toEqual({ newCoverage: 1, reviewWork: 2 });
  });

  it("decides new versus review by date order, not by array order", () => {
    // The later session arriving first must not be credited as new coverage.
    const logs = [log("a", "2026-09-09"), log("a", "2026-09-01")];
    expect(splitWork(logs)).toEqual({ newCoverage: 1, reviewWork: 1 });
  });

  it("never blends the two, so review can never stand in for breadth", () => {
    const logs = [log("a", "2026-09-01"), log("a", "2026-09-02"), log("b", "2026-09-02")];
    const { newCoverage, reviewWork } = splitWork(logs);
    expect(newCoverage).toBe(2);
    expect(reviewWork).toBe(1);
  });
});

describe("hoursBetween", () => {
  it("includes both ends", () => {
    // 2026-09-07 is a Monday. Mon to Tue inclusive at 2h each.
    expect(hoursBetween(fullWeek, new Date("2026-09-07"), new Date("2026-09-08"))).toBe(4);
  });

  it("skips days the weekly template sets to zero", () => {
    // Sat and Sun are 0 in weekdaysOnly, so a full week gives 5 x 2.
    expect(hoursBetween(weekdaysOnly, new Date("2026-09-07"), new Date("2026-09-13"))).toBe(10);
  });

  it("excludes holiday ranges entirely", () => {
    const holidays = [{ start: new Date("2026-09-08"), end: new Date("2026-09-09") }];
    const without = hoursBetween(fullWeek, new Date("2026-09-07"), new Date("2026-09-10"), holidays);
    expect(without).toBe(4);
  });
});

describe("readPace", () => {
  it("reports zero behind on day one, when nothing is due yet", () => {
    const today = new Date("2026-09-01");
    const r = readPace({ plan: plan(), logs: [], totalOutcomes: 700, holidays: [], today });
    expect(r.target).toBe(0);
    expect(r.delta).toBe(0);
  });

  it("counts a re-logged outcome once, which the API's own delta does not", () => {
    const today = new Date("2026-10-01");
    const logs = [log("a", "2026-09-02"), log("a", "2026-09-03"), log("a", "2026-09-04")];
    const r = readPace({ plan: plan(), logs, totalOutcomes: 700, holidays: [], today });
    expect(r.covered).toBe(1);
  });

  it("goes negative when the candidate is behind", () => {
    const today = new Date("2026-12-01");
    const r = readPace({ plan: plan(), logs: [log("a", "2026-09-02")], totalOutcomes: 700, holidays: [], today });
    expect(r.delta).toBeLessThan(0);
    expect(r.hoursBehind).toBeGreaterThan(0);
  });

  it("prices the gap in hours at the plan's own rate", () => {
    const today = new Date("2026-12-01");
    const p = plan();
    const r = readPace({ plan: p, logs: [], totalOutcomes: 700, holidays: [], today });

    // The plan's rate is its whole outcome count over its whole hour budget.
    const totalHours = hoursBetween(
      p.weeklyAvailability,
      new Date(p.startDate),
      new Date(p.examDate),
    );
    const ratePerHour = 700 / totalHours;

    // Converting back must land on the outcome gap it came from.
    expect(r.hoursBehind * ratePerHour).toBeCloseTo(Math.abs(r.delta), 6);
  });

  it("flags an unrealistic pace when the remaining work cannot fit the remaining days", () => {
    const today = new Date("2027-05-01");
    const r = readPace({ plan: plan(), logs: [], totalOutcomes: 700, holidays: [], today });
    expect(r.realistic).toBe(false);
  });

  it("does not credit today's hours, so it never reports behind every morning", () => {
    const today = new Date("2026-09-08");
    const a = readPace({ plan: plan(), logs: [], totalOutcomes: 700, holidays: [], today });
    const b = readPace({
      plan: plan(),
      logs: [],
      totalOutcomes: 700,
      holidays: [],
      today: addUTCDays(startOfUTCDay(today), 1),
    });
    expect(b.target).toBeGreaterThan(a.target);
  });

  it("survives a plan with no available hours rather than dividing by zero", () => {
    const zero: WeeklyAvailability = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
    const r = readPace({
      plan: plan({ weeklyAvailability: zero }),
      logs: [],
      totalOutcomes: 700,
      holidays: [],
      today: new Date("2026-10-01"),
    });
    expect(Number.isNaN(r.delta)).toBe(false);
    expect(r.realistic).toBe(false);
  });
});

describe("missedDays", () => {
  const base = plan({ startDate: "2026-09-01", examDate: "2027-05-18" });

  it("flags a planned day with no log", () => {
    const from = new Date("2026-09-07");
    const to = new Date("2026-09-09");
    const out = missedDays({ plan: base, logs: [], holidays: [], from, to });
    expect(out).toContain("2026-09-07");
  });

  it("never flags a holiday", () => {
    const holidays = [{ id: "h", startDate: "2026-09-07", endDate: "2026-09-08", note: null }];
    const out = missedDays({
      plan: base,
      logs: [],
      holidays,
      from: new Date("2026-09-07"),
      to: new Date("2026-09-08"),
    });
    expect(out).toEqual([]);
  });

  it("never flags a day the weekly template sets to zero", () => {
    const out = missedDays({
      plan: plan({ weeklyAvailability: weekdaysOnly }),
      logs: [],
      holidays: [],
      from: new Date("2026-09-12"),
      to: new Date("2026-09-13"),
    });
    expect(out).toEqual([]);
  });

  it("never flags today, which is still in progress", () => {
    const today = toISODate(startOfUTCDay(new Date()));
    const out = missedDays({
      plan: base,
      logs: [],
      holidays: [],
      from: new Date(),
      to: new Date(),
    });
    expect(out).not.toContain(today);
  });

  it("never flags a day before the plan started", () => {
    const out = missedDays({
      plan: plan({ startDate: "2026-09-10" }),
      logs: [],
      holidays: [],
      from: new Date("2026-09-07"),
      to: new Date("2026-09-09"),
    });
    expect(out).toEqual([]);
  });

  it("does not flag a day that has a log", () => {
    const out = missedDays({
      plan: base,
      logs: [log("a", "2026-09-07")],
      holidays: [],
      from: new Date("2026-09-07"),
      to: new Date("2026-09-07"),
    });
    expect(out).toEqual([]);
  });
});

describe("remainingWeekSplit", () => {
  it("measures what is left of the week, not the whole week", () => {
    // Friday: Fri, Sat, Sun remain at 2h each.
    const friday = new Date("2026-09-11");
    expect(remainingWeekSplit(fullWeek, friday).totalHours).toBe(6);
  });

  it("holds the 1 to 2 content-practice ratio", () => {
    const monday = new Date("2026-09-07");
    const { contentHours, practiceHours } = remainingWeekSplit(fullWeek, monday);
    expect(practiceHours / contentHours).toBeCloseTo(2);
  });

  it("is zero on the last day of a week with no hours left", () => {
    const sunday = new Date("2026-09-13");
    expect(remainingWeekSplit(weekdaysOnly, sunday).totalHours).toBe(0);
  });
});
