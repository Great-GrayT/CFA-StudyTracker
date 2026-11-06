import { test, expect } from "vitest";
import {
  remainingHours,
  targetDailyPace,
  studyNextList,
  coverageCount,
  behindAhead,
  missedStudyDays,
  missedDaysWindow,
  classifyLosFlag,
  weightedCoveragePercent,
  splitProgress,
  isPaceRealistic,
  shouldNudgeDiversity,
  recommendedSessionSplit,
  DEFAULT_PACE_CEILING_HOURS,
  DEFAULT_CONTENT_RATIO,
  type WeeklyAvailability,
} from "./pace";

// Today's real-world date per project context; also a Wednesday, which keeps
// the classifyLosFlag "same day" tests and the holiday fixture below coherent.
const today = new Date("2026-11-04");
const pastDate = new Date("2026-01-01");

// Monday-tue-wed fixtures: Tuesday is deliberately a 0-hour day so the
// missedStudyDays tests can distinguish "planned but missed" from "not planned".
const monday = new Date("2026-11-02");
const wednesday = new Date("2026-11-04");
const nextMonday = new Date("2026-11-09");

const availability: WeeklyAvailability = {
  mon: 2,
  tue: 0,
  wed: 2,
  thu: 2,
  fri: 2,
  sat: 0,
  sun: 0,
};

test("remainingHours is 0, not negative, when examDate is in the past", () => {
  expect(remainingHours(availability, today, pastDate, [])).toBe(0);
});

test("remainingHours excludes a day that falls inside a holiday range", () => {
  const withoutHoliday = remainingHours(availability, monday, nextMonday, []);
  const withHoliday = remainingHours(availability, monday, nextMonday, [
    { start: wednesday, end: wednesday },
  ]);
  expect(withHoliday).toBe(withoutHoliday - availability.wed);
});

test("targetDailyPace is 0 when no hours remain, not Infinity or NaN", () => {
  expect(targetDailyPace(100, 100, 0)).toBe(0);
});

test("coverageCount counts a LOS once no matter how many times it's logged", () => {
  expect(coverageCount([{ losId: "a" }, { losId: "a" }, { losId: "b" }])).toBe(2);
});

test("studyNextList puts flagged-for-review LOS before not-yet-studied ones, oldest rating first", () => {
  const result = studyNextList([
    { losId: "a", status: "not-started", order: 1 },
    { losId: "b", status: "flagged", lastRatedAt: new Date("2026-01-02"), order: 2 },
    { losId: "c", status: "flagged", lastRatedAt: new Date("2026-01-01"), order: 3 },
  ]);
  expect(result.map((r) => r.losId)).toEqual(["c", "b", "a"]);
});

test("behindAhead reports a negative delta when actual trails target", () => {
  expect(behindAhead(5, 10)).toEqual({ delta: -5, percent: 50 });
});

test("missedStudyDays flags a planned weekday with no logged date, and skips a 0-hour day", () => {
  const monday = new Date("2026-11-02"); // planned 2h, nothing logged
  const tuesday = new Date("2026-11-03"); // planned 0h, nothing logged, not a miss
  const result = missedStudyDays(availability, [], { from: monday, to: tuesday }, []);
  expect(result).toEqual(["2026-11-02"]);
});

test("missedStudyDays does not flag a planned day that has a log on it", () => {
  const monday = new Date("2026-11-02");
  const result = missedStudyDays(availability, [monday], { from: monday, to: monday }, []);
  expect(result).toEqual([]);
});

test("classifyLosFlag flags low confidence regardless of accuracy", () => {
  expect(
    classifyLosFlag(
      { confidence: 2, questionsAnswered: 10, questionsCorrect: 10, lastTouchedAt: today },
      today
    )
  ).toBe(true);
});

test("classifyLosFlag flags poor accuracy once enough questions have been answered", () => {
  expect(
    classifyLosFlag(
      { confidence: 5, questionsAnswered: 5, questionsCorrect: 1, lastTouchedAt: today },
      today
    )
  ).toBe(true);
});

test("classifyLosFlag does not flag poor accuracy below the minimum question count", () => {
  expect(
    classifyLosFlag(
      { confidence: 5, questionsAnswered: 2, questionsCorrect: 0, lastTouchedAt: today },
      today
    )
  ).toBe(false);
});

test("classifyLosFlag flags a stale LOS even with a high confidence and good accuracy", () => {
  const thirtyFiveDaysAgo = new Date(today.getTime() - 35 * 24 * 60 * 60 * 1000);
  expect(
    classifyLosFlag(
      {
        confidence: 5,
        questionsAnswered: 10,
        questionsCorrect: 10,
        lastTouchedAt: thirtyFiveDaysAgo,
      },
      today
    )
  ).toBe(true);
});

test("classifyLosFlag does not flag a LOS with high confidence, good accuracy, and a recent touch", () => {
  expect(
    classifyLosFlag(
      { confidence: 5, questionsAnswered: 10, questionsCorrect: 10, lastTouchedAt: today },
      today
    )
  ).toBe(false);
});

test("weightedCoveragePercent weights by each item's weightShare, not a flat count", () => {
  const result = weightedCoveragePercent([
    { covered: true, weightShare: 20 },
    { covered: false, weightShare: 80 },
  ]);
  expect(result).toBe(20);
});

test("splitProgress partitions first-time coverage from review work", () => {
  expect(
    splitProgress([{ isFirstEverLog: true }, { isFirstEverLog: true }, { isFirstEverLog: false }])
  ).toEqual({ newCoverage: 2, reviewWork: 1 });
});

test("isPaceRealistic is false once required daily hours exceed the ceiling", () => {
  expect(isPaceRealistic(7, 6)).toBe(false);
  expect(isPaceRealistic(5, 6)).toBe(true);
});

test("isPaceRealistic defaults its ceiling to DEFAULT_PACE_CEILING_HOURS", () => {
  expect(isPaceRealistic(DEFAULT_PACE_CEILING_HOURS + 1)).toBe(false);
});

test("shouldNudgeDiversity is true for 20+ questions from a single package at mid confidence", () => {
  expect(shouldNudgeDiversity({ uworld: 25 }, 3)).toBe(true);
});

test("shouldNudgeDiversity is false once a second package contributes questions", () => {
  expect(shouldNudgeDiversity({ uworld: 15, kaplan: 10 }, 3)).toBe(false);
});

test("shouldNudgeDiversity is false once confidence is high regardless of source count", () => {
  expect(shouldNudgeDiversity({ uworld: 25 }, 4)).toBe(false);
});

test("recommendedSessionSplit applies a 1:2 content-to-practice ratio by default", () => {
  expect(recommendedSessionSplit(9)).toEqual({ contentHours: 3, practiceHours: 6 });
});

test("recommendedSessionSplit honors a custom ratio", () => {
  expect(recommendedSessionSplit(10, 0.5)).toEqual({ contentHours: 5, practiceHours: 5 });
});

// --- remainingHours closed-form rewrite (Critical fix: no more one Date
// allocation per calendar day - see pace.ts's sumAvailability) ---

test("remainingHours matches an exact-multiple-of-7-days span against a hand-computed weekly total", () => {
  // monday is 2026-11-02; +27 days lands on 2026-11-29, a Sunday - 28 days
  // inclusive is exactly 4 full weeks, zero remainder, so the result must be
  // precisely 4x this week's total (2+0+2+2+2+0+0 = 8).
  const fourWeeksLater = new Date("2026-11-29");
  expect(remainingHours(availability, monday, fourWeeksLater, [])).toBe(4 * 8);
});

test("remainingHours matches a hand-computed total across a partial (non-week-aligned) span", () => {
  // monday (2h) through wednesday (2h) is 3 days: mon=2, tue=0, wed=2 -> 4.
  const wed = new Date("2026-11-04");
  expect(remainingHours(availability, monday, wed, [])).toBe(4);
});

test("remainingHours still subtracts overlapping holiday ranges only once (union, not double-counted)", () => {
  const fourWeeksLater = new Date("2026-11-29");
  const withoutHolidays = remainingHours(availability, monday, fourWeeksLater, []);
  // Two overlapping ranges both covering the same Wednesday (worth 2h): if
  // they were summed independently instead of merged, this would wrongly
  // subtract 4h instead of 2h.
  const wed = new Date("2026-11-04");
  const withOverlappingHolidays = remainingHours(availability, monday, fourWeeksLater, [
    { start: wed, end: wed },
    { start: wed, end: new Date("2026-11-05") }, // wed..thu, overlaps the first range on wed
  ]);
  // thu is also worth 2h, so total excluded should be wed(2) + thu(2) = 4,
  // not wed(2) counted twice + thu(2) = 6.
  expect(withOverlappingHolidays).toBe(withoutHolidays - 4);
});

test("remainingHours completes near-instantly across a multi-year span (closed-form, not a day-by-day loop)", () => {
  const start = new Date("2026-01-01");
  const tenYearsLater = new Date("2036-01-01");
  const t0 = Date.now();
  const result = remainingHours(availability, start, tenYearsLater, []);
  const elapsedMs = Date.now() - t0;
  // A day-by-day loop over a 10-year span allocates ~3650 Date objects per
  // call; this is called twice per /api/progress request and once per plan
  // per cron tick. The closed-form rewrite is O(1) in the span length, so
  // this must stay fast regardless of how far examDate is pushed out -
  // generously budgeted well under what even a slow CI runner would need.
  expect(elapsedMs).toBeLessThan(200);
  expect(result).toBeGreaterThan(0);
});

// --- missedDaysWindow: the shared clipping logic behind the fixed
// missedStudyDays bug (new plans showing missed days before they existed;
// missed-day alerts continuing forever after the exam date passes) ---

test("missedDaysWindow clips the start up to the plan's startDate", () => {
  const plan = { startDate: new Date("2026-11-04"), examDate: new Date("2027-06-01") };
  const result = missedDaysWindow(plan, { from: new Date("2026-10-01"), to: new Date("2026-11-10") }, new Date("2026-11-10"));
  expect(result).toEqual({ start: new Date("2026-11-04"), end: new Date("2026-11-09") });
});

test("missedDaysWindow clips the end down to yesterday, never including today", () => {
  const plan = { startDate: new Date("2026-01-01"), examDate: new Date("2027-06-01") };
  const today = new Date("2026-11-10");
  const result = missedDaysWindow(plan, { from: new Date("2026-11-01"), to: today }, today);
  expect(result?.end).toEqual(new Date("2026-11-09"));
});

test("missedDaysWindow returns null once the plan's exam date has already passed", () => {
  const plan = { startDate: new Date("2026-01-01"), examDate: new Date("2026-11-01") };
  const today = new Date("2026-11-10");
  const result = missedDaysWindow(plan, { from: new Date("2026-11-01"), to: today }, today);
  expect(result).toBeNull();
});

test("missedDaysWindow returns null for a brand-new plan whose only requested day is today", () => {
  const today = new Date("2026-11-10");
  const plan = { startDate: today, examDate: new Date("2027-06-01") };
  const result = missedDaysWindow(plan, { from: today, to: today }, today);
  expect(result).toBeNull();
});
