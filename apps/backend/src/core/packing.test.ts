import { test, expect } from "vitest";
import type { SchedulableGroup } from "./ordering";
import type { PlannedDay, PlannedTask } from "./packing";
import { packDays } from "./packing";

// Test helpers
function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

type CalendarOpts = {
  mon?: number;
  tue?: number;
  wed?: number;
  thu?: number;
  fri?: number;
  sat?: number;
  sun?: number;
  every?: number;
  holidays?: string[];
  startDate?: string;
  horizonDays?: number;
};

type Calendar = {
  weeklyAvailability: Record<string, number>;
  startDate: string;
  horizonDays: number;
  holidays: string[];
};

function calendar(opts: CalendarOpts): Calendar {
  const every = opts.every ?? 0;
  return {
    weeklyAvailability: {
      mon: opts.mon ?? every,
      tue: opts.tue ?? every,
      wed: opts.wed ?? every,
      thu: opts.thu ?? every,
      fri: opts.fri ?? every,
      sat: opts.sat ?? every,
      sun: opts.sun ?? every,
    },
    startDate: opts.startDate ?? "2027-01-01",
    horizonDays: opts.horizonDays ?? 365,
    holidays: opts.holidays ?? [],
  };
}

// Test fixtures extend SchedulableGroup with properties needed for task generation
type FixtureGroup = SchedulableGroup & {
  noteMinutes?: number;
  videoMinutes?: number;
  eocqMinutes?: number;
  questionMinutes?: number;
  vignetteCount?: number;
  calculationShare?: number;
};

function fixtureGroup(opts: {
  ref: string;
  readingRefs?: string[];
  estimatedMinutes?: number;
  noteMinutes?: number;
  videoMinutes?: number;
  eocqMinutes?: number;
  questionMinutes?: number;
  vignetteCount?: number;
  calculationShare?: number;
}): FixtureGroup {
  return {
    ref: opts.ref,
    readingRefs: opts.readingRefs ?? [opts.ref],
    prereqRefs: [],
    phaseBand: 1,
    moduleOrder: 0,
    priorityRank: 0,
    weight: 5,
    estimatedMinutes: opts.estimatedMinutes ?? 120,
    weightImpliedMinutes: opts.estimatedMinutes ?? 120,
    noteMinutes: opts.noteMinutes,
    videoMinutes: opts.videoMinutes,
    eocqMinutes: opts.eocqMinutes,
    questionMinutes: opts.questionMinutes,
    vignetteCount: opts.vignetteCount,
    calculationShare: opts.calculationShare,
  };
}

// ONE_MODULE: single module with balanced task breakdown
const ONE_MODULE: FixtureGroup[] = [
  fixtureGroup({
    ref: "test/m1",
    estimatedMinutes: 120,
    noteMinutes: 30,
    videoMinutes: 30,
    eocqMinutes: 30,
    questionMinutes: 30,
    vignetteCount: 2,
    calculationShare: 0.5,
  }),
];

// SEQ: a sequence that would overflow with capacity 90 if not managed
const SEQ: FixtureGroup[] = [
  fixtureGroup({
    ref: "test/seq1",
    estimatedMinutes: 100,
    noteMinutes: 25,
    videoMinutes: 25,
    eocqMinutes: 25,
    questionMinutes: 25,
    vignetteCount: 2,
    calculationShare: 0.5,
  }),
  fixtureGroup({
    ref: "test/seq2",
    estimatedMinutes: 95,
    noteMinutes: 25,
    videoMinutes: 25,
    eocqMinutes: 20,
    questionMinutes: 25,
    vignetteCount: 2,
    calculationShare: 0.5,
  }),
];

// BIG_QUESTION_MODULE: module with multiple vignettes to test vignette boundary splitting
const BIG_QUESTION_MODULE: FixtureGroup[] = [
  fixtureGroup({
    ref: "test/bigq",
    estimatedMinutes: 120,
    noteMinutes: 20,
    videoMinutes: 20,
    eocqMinutes: 10,
    questionMinutes: 70,
    vignetteCount: 6, // 6 vignettes, 12 questions per vignette
    calculationShare: 0.5,
  }),
];

// LONG_LECTURE: module with a long video that needs to split
const LONG_LECTURE: FixtureGroup[] = [
  fixtureGroup({
    ref: "test/long",
    estimatedMinutes: 150,
    noteMinutes: 20,
    videoMinutes: 110, // Long video that needs to split
    eocqMinutes: 10,
    questionMinutes: 10,
    vignetteCount: 2,
    calculationShare: 0.5,
  }),
];

// CALC_HEAVY: module with high calculation share
const CALC_HEAVY: FixtureGroup[] = [
  fixtureGroup({
    ref: "test/calc",
    estimatedMinutes: 100,
    noteMinutes: 25,
    videoMinutes: 25,
    eocqMinutes: 25,
    questionMinutes: 25,
    vignetteCount: 2,
    calculationShare: 0.5, // At boundary, should be timed-drill
  }),
];

// JUDGEMENT: module with low calculation share
const JUDGEMENT: FixtureGroup[] = [
  fixtureGroup({
    ref: "test/judgement",
    estimatedMinutes: 100,
    noteMinutes: 25,
    videoMinutes: 25,
    eocqMinutes: 25,
    questionMinutes: 25,
    vignetteCount: 2,
    calculationShare: 0.1, // Low calc share, should be untimed-review
  }),
];

const OPTS = {};

// Helper to extract mode from packed days
function modeOf(days: PlannedDay[]): string | undefined {
  const questionTasks = days
    .flatMap((d) => d.tasks)
    .filter((t) => t.kind === "questions");
  return questionTasks[0]?.mode;
}

// Tests
test("a day never exceeds its availability", () => {
  const days = packDays(SEQ, calendar({ mon: 90 }), OPTS);
  for (const d of days) {
    expect(sum(d.tasks.map((t) => t.estimatedMinutes))).toBeLessThanOrEqual(90);
  }
});

test("a holiday gets no tasks", () => {
  const days = packDays(SEQ, calendar({ mon: 90, holidays: ["2027-01-04"] }), OPTS);
  const holidayDay = days.find((d) => d.date === "2027-01-04");
  expect(holidayDay).toBeDefined();
  expect(holidayDay!.tasks).toEqual([]);
});

test("a module's chain is emitted in order", () => {
  const kinds = packDays(ONE_MODULE, calendar({ every: 600 }), OPTS)
    .flatMap((d) => d.tasks.map((t) => t.kind));
  expect(kinds).toEqual(["content-notes", "content-video", "eocq", "questions"]);
});

test("a question block never splits inside a vignette", () => {
  const days = packDays(BIG_QUESTION_MODULE, calendar({ every: 60 }), OPTS);
  for (const t of days.flatMap((d) => d.tasks).filter((t) => t.kind === "questions")) {
    expect(t.vignetteFrom).toBeLessThanOrEqual(t.vignetteTo!);
    expect(Number.isInteger(t.vignetteFrom)).toBe(true);
    expect(Number.isInteger(t.vignetteTo!)).toBe(true);
  }
});

test("a long lecture splits into parts, none under 15 minutes", () => {
  const tasks = packDays(LONG_LECTURE, calendar({ every: 60 }), OPTS).flatMap((d) => d.tasks);
  const parts = tasks.filter((t) => t.splitOf);
  expect(parts.length).toBeGreaterThan(1);
  for (const p of parts) expect(p.estimatedMinutes).toBeGreaterThanOrEqual(15);
  expect(parts.map((p) => p.splitIndex)).toEqual([1, 2, 3]);
});

test("question mode follows the reading's calculation share", () => {
  expect(modeOf(packDays(CALC_HEAVY, calendar({ every: 600 }), OPTS))).toBe("timed-drill");
  expect(modeOf(packDays(JUDGEMENT, calendar({ every: 600 }), OPTS))).toBe("untimed-review");
});

test("only the last task of a module asks for confidence", () => {
  const tasks = packDays(ONE_MODULE, calendar({ every: 600 }), OPTS).flatMap((d) => d.tasks);
  expect(tasks.filter((t) => t.requiresConfidence)).toHaveLength(1);
  expect(tasks[tasks.length - 1].requiresConfidence).toBe(true);
});
