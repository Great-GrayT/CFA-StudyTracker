import { expect, test } from "vitest";
import { DEFAULT_TUNING } from "./tuning";
import type { Calendar } from "./packing";
import type { ReviewUnit } from "./review";
import {
  injectionCap,
  packReview,
  projectCoverageDate,
  reviewPhaseStart,
  reviewQueue,
} from "./review";

const T = DEFAULT_TUNING;
const NOW = new Date("2026-11-16T00:00:00Z");

function ru(ref: string, p: Partial<ReviewUnit> = {}): ReviewUnit {
  return {
    ref,
    readingRefs: [ref],
    topicOrder: 1,
    moduleOrder: 1,
    reviewReadMinutes: 40,
    questionMinutes: 160,
    mastery: 0.5,
    eligible: true,
    vignetteCount: 8,
    calculationShare: 0.4,
    ...p,
  };
}

// 2026-11-16 is a Monday, so index 0 of perDay is mon.
function calendarOf(perDay: number[], horizonDays?: number): Calendar {
  const keys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const availability: Record<string, number> = {};
  keys.forEach((k, i) => {
    availability[k] = perDay[i] ?? 0;
  });
  return {
    weeklyAvailability: availability,
    startDate: "2026-11-16",
    horizonDays: horizonDays ?? Math.max(perDay.length, 7),
    holidays: [],
  };
}

function fixtureQueue(): ReviewUnit[] {
  return Array.from({ length: 10 }, (_, i) =>
    ru(`t${i}/lm1`, {
      topicOrder: i + 1,
      reviewReadMinutes: 20 + i * 4,
      questionMinutes: 80 + i * 16,
      mastery: 0.2 + i * 0.05,
    }),
  );
}

function fixtureQuestionHeavyQueue(): ReviewUnit[] {
  // Deep question banks and almost no review video, so a naive packer spends
  // the whole week on questions and never touches the reading budget.
  return Array.from({ length: 6 }, (_, i) =>
    ru(`q${i}/lm1`, {
      topicOrder: i + 1,
      reviewReadMinutes: 16,
      questionMinutes: 900,
      mastery: 0.2 + i * 0.05,
    }),
  );
}

function minutesOf(tasks: Array<{ estimatedMinutes: number }>): number {
  return tasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

test("the queue serves the weakest first", () => {
  const q = reviewQueue(
    [
      ru("a", { mastery: 0.8, topicOrder: 1 }),
      ru("b", { mastery: 0.2, topicOrder: 2 }),
      ru("c", { mastery: 0.5, topicOrder: 3 }),
    ],
    "curriculum-topic",
  );
  expect(q.map((u) => u.ref)).toEqual(["b", "c", "a"]);
});

test("curriculum-strict keeps the queue in curriculum order whatever the mastery", () => {
  const q = reviewQueue(
    [
      ru("b", { mastery: 0.2, topicOrder: 2 }),
      ru("a", { mastery: 0.9, topicOrder: 1 }),
    ],
    "curriculum-strict",
  );
  expect(q.map((u) => u.ref)).toEqual(["a", "b"]);
});

test("only eligible units may jump the order under curriculum-topic", () => {
  const q = reviewQueue(
    [
      ru("a", { mastery: 0.9, topicOrder: 1, eligible: false }),
      ru("b", { mastery: 0.2, topicOrder: 2, eligible: false }),
    ],
    "curriculum-topic",
  );
  expect(q.map((u) => u.ref)).toEqual(["a", "b"]);
});

test("an eligible weak unit overtakes an ineligible one", () => {
  const q = reviewQueue(
    [
      ru("a", { mastery: 0.9, topicOrder: 1, eligible: false }),
      ru("b", { mastery: 0.2, topicOrder: 2, eligible: true }),
    ],
    "curriculum-topic",
  );
  expect(q.map((u) => u.ref)).toEqual(["b", "a"]);
});

test("effort-return orders the queue by mastery like the default mode", () => {
  const q = reviewQueue(
    [ru("a", { mastery: 0.8, topicOrder: 1 }), ru("b", { mastery: 0.2, topicOrder: 2 })],
    "effort-return",
  );
  expect(q.map((u) => u.ref)).toEqual(["b", "a"]);
});

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

test("the week owes one part reading to four parts questions", () => {
  const days = packReview(fixtureQueue(), calendarOf([120, 120, 120, 120, 120, 0, 0]), T);
  const week = days.slice(0, 7).flatMap((d) => d.tasks);
  const read = minutesOf(week.filter((t) => t.kind !== "questions"));
  const quest = minutesOf(week.filter((t) => t.kind === "questions"));
  expect(read + quest).toBeLessThanOrEqual(600);
  expect(quest / read).toBeCloseTo(4, 0);
});

test("a single day may be entirely questions", () => {
  const days = packReview(fixtureQueue(), calendarOf([120, 120, 120, 120, 120, 0, 0]), T);
  expect(
    days.some((d) => d.tasks.length > 0 && d.tasks.every((t) => t.kind === "questions")),
  ).toBe(true);
});

test("reading is forced in when two days remain and its budget is underspent", () => {
  const days = packReview(
    fixtureQuestionHeavyQueue(),
    calendarOf([120, 120, 120, 120, 120, 0, 0]),
    T,
  );
  const read = minutesOf(
    days
      .slice(0, 7)
      .flatMap((d) => d.tasks)
      .filter((t) => t.kind !== "questions"),
  );
  expect(read).toBeGreaterThan(0);
});

test("the review phase draws its reading from review videos, not the original notes", () => {
  const days = packReview(
    [ru("a", { reviewReadMinutes: 40, questionMinutes: 400 })],
    calendarOf([200, 200]),
    T,
  );
  const reading = days.flatMap((d) => d.tasks).filter((t) => t.kind !== "questions");
  expect(reading.length).toBeGreaterThan(0);
  expect(reading.every((t) => t.kind === "review")).toBe(true);
});

test("the week's packed minutes never exceed the week's availability", () => {
  const days = packReview(fixtureQueue(), calendarOf([120, 120, 120, 120, 120, 0, 0]), T);
  expect(minutesOf(days.slice(0, 7).flatMap((d) => d.tasks))).toBeLessThanOrEqual(600);
});

test("a zero-minute day holds no review tasks", () => {
  const days = packReview(fixtureQueue(), calendarOf([0, 180, 180, 0, 0, 0, 0]), T);
  expect(days[0].tasks).toEqual([]);
  expect(days[3].tasks).toEqual([]);
});

test("an empty queue yields days with no tasks rather than throwing", () => {
  const days = packReview([], calendarOf([120, 120]), T);
  expect(days.every((d) => d.tasks.length === 0)).toBe(true);
});

test("no review task is ever zero or negative minutes", () => {
  const days = packReview(fixtureQueue(), calendarOf(Array(7).fill(95)), T);
  for (const day of days) {
    for (const task of day.tasks) {
      expect(task.estimatedMinutes).toBeGreaterThan(0);
    }
  }
});

test("a reduced review multiple shifts the week towards reading", () => {
  const twoToOne = { ...T, reviewQuestionMultiple: 1 };
  const days = packReview(fixtureQueue(), calendarOf([120, 120, 120, 120, 120, 0, 0]), twoToOne);
  const week = days.slice(0, 7).flatMap((d) => d.tasks);
  const read = minutesOf(week.filter((t) => t.kind !== "questions"));
  const quest = minutesOf(week.filter((t) => t.kind === "questions"));
  expect(quest / read).toBeCloseTo(1, 0);
});

// ---------------------------------------------------------------------------
// Coverage projection and the injection throttle
// ---------------------------------------------------------------------------

test("coverage projection rejects a non-positive pace rather than returning Infinity", () => {
  expect(() => projectCoverageDate(1000, 0, NOW, calendarOf([120]), "2027-05-01", T)).toThrow();
  expect(() => projectCoverageDate(1000, -5, NOW, calendarOf([120]), "2027-05-01", T)).toThrow();
});

test("coverage projection walks only the days the candidate actually studies", () => {
  // 300 minutes left at 100 a day is three study days. With only mon to wed
  // available, that lands on the Wednesday.
  const r = projectCoverageDate(300, 100, NOW, calendarOf([100, 100, 100, 0, 0, 0, 0]), "2027-05-01", T);
  expect(r.date).toBe("2026-11-18");
});

test("coverage slack is measured against the exam date less the deadline weeks", () => {
  // Deadline is 2027-05-01 less 6 weeks, which is 2027-03-20.
  const r = projectCoverageDate(300, 100, NOW, calendarOf(Array(7).fill(100)), "2027-05-01", T);
  expect(r.slackDays).toBeGreaterThan(0);
  const late = projectCoverageDate(
    600_000,
    100,
    NOW,
    calendarOf(Array(7).fill(100)),
    "2027-05-01",
    T,
  );
  expect(late.slackDays).toBeLessThan(0);
});

test("injections run at the full cap while coverage has slack", () => {
  expect(injectionCap(60, T)).toBe(0.35);
  expect(injectionCap(42, T)).toBe(0.35);
});

test("the cap ramps down as the coverage deadline approaches, with no cliff", () => {
  const far = injectionCap(30, T);
  const near = injectionCap(10, T);
  expect(far).toBeGreaterThan(near);
  expect(near).toBeGreaterThan(0);
  expect(far).toBeLessThan(0.35);
});

test("injections stop entirely once coverage would miss its deadline", () => {
  expect(injectionCap(0, T)).toBe(0);
  expect(injectionCap(-1, T)).toBe(0);
  expect(injectionCap(-40, T)).toBe(0);
});

// ---------------------------------------------------------------------------
// The four start policies
// ---------------------------------------------------------------------------

test("after-coverage keeps review inactive until the whole curriculum is read", () => {
  const t = { ...T, reviewPolicy: "after-coverage" as const };
  const before = reviewPhaseStart(
    calendarOf([120]),
    { unreadMinutes: 500, realisedPacePerDay: 100, allCovered: false },
    "2027-05-01",
    NOW,
    t,
  );
  expect(before.active).toBe(false);
  const after = reviewPhaseStart(
    calendarOf([120]),
    { unreadMinutes: 0, realisedPacePerDay: 100, allCovered: true },
    "2027-05-01",
    NOW,
    t,
  );
  expect(after.active).toBe(true);
  expect(after.cap).toBe(1);
});

test("weekly-interleave is active from the first week at its configured share", () => {
  const t = { ...T, reviewPolicy: "weekly-interleave" as const };
  const r = reviewPhaseStart(
    calendarOf([120]),
    { unreadMinutes: 5000, realisedPacePerDay: 100, allCovered: false },
    "2027-05-01",
    NOW,
    t,
  );
  expect(r.active).toBe(true);
  expect(r.cap).toBe(T.weeklyInterleaveShare);
});

test("fixed-date is inactive before the date and active on it", () => {
  const t = {
    ...T,
    reviewPolicy: "fixed-date" as const,
    reviewStartDate: "2026-12-01",
  };
  const coverage = { unreadMinutes: 100, realisedPacePerDay: 10, allCovered: false };
  expect(
    reviewPhaseStart(calendarOf([120]), coverage, "2027-05-01", new Date("2026-11-30T00:00:00Z"), t)
      .active,
  ).toBe(false);
  expect(
    reviewPhaseStart(calendarOf([120]), coverage, "2027-05-01", new Date("2026-12-01T00:00:00Z"), t)
      .active,
  ).toBe(true);
});

test("fixed-date without a date throws rather than guessing one", () => {
  const t = { ...T, reviewPolicy: "fixed-date" as const, reviewStartDate: null };
  expect(() =>
    reviewPhaseStart(
      calendarOf([120]),
      { unreadMinutes: 100, realisedPacePerDay: 10, allCovered: false },
      "2027-05-01",
      NOW,
      t,
    ),
  ).toThrow();
});

test("decay-triggered throttles itself when coverage is at risk, and says why", () => {
  const t = { ...T, reviewPolicy: "decay-triggered" as const };
  const safe = reviewPhaseStart(
    calendarOf(Array(7).fill(120)),
    { unreadMinutes: 600, realisedPacePerDay: 120, allCovered: false },
    "2027-05-01",
    NOW,
    t,
  );
  const risky = reviewPhaseStart(
    calendarOf(Array(7).fill(120)),
    { unreadMinutes: 600_000, realisedPacePerDay: 120, allCovered: false },
    "2027-05-01",
    NOW,
    t,
  );
  expect(safe.active).toBe(true);
  expect(safe.cap).toBe(0.35);
  expect(risky.cap).toBe(0);
  expect(risky.reason).toMatch(/coverage/i);
});

test("decay-triggered hands the whole calendar to review once coverage is done", () => {
  const t = { ...T, reviewPolicy: "decay-triggered" as const };
  const r = reviewPhaseStart(
    calendarOf(Array(7).fill(120)),
    { unreadMinutes: 0, realisedPacePerDay: 120, allCovered: true },
    "2027-05-01",
    NOW,
    t,
  );
  expect(r.active).toBe(true);
  expect(r.cap).toBe(1);
});

test("a plan with no logged work yet does not crash the throttle", () => {
  const t = { ...T, reviewPolicy: "decay-triggered" as const };
  const r = reviewPhaseStart(
    calendarOf(Array(7).fill(120)),
    { unreadMinutes: 5000, realisedPacePerDay: 0, allCovered: false },
    "2027-05-01",
    NOW,
    t,
  );
  expect(Number.isFinite(r.cap)).toBe(true);
  expect(r.cap).toBeGreaterThanOrEqual(0);
});
