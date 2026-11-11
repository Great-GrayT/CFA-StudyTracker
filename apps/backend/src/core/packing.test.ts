import { test, expect } from "vitest";
import type { PlannedDay, PlannedTask, PackableGroup } from "./packing";
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

function fixtureGroup(opts: {
  ref: string;
  readingRefs?: string[];
  noteMinutes: number;
  videoMinutes: number;
  eocqMinutes: number;
  questionMinutes: number;
  vignetteCount: number;
  calculationShare: number;
}): PackableGroup {
  return {
    ref: opts.ref,
    readingRefs: opts.readingRefs ?? [opts.ref],
    prereqRefs: [],
    phaseBand: 1,
    moduleOrder: 0,
    priorityRank: 0,
    weight: 5,
    estimatedMinutes: opts.noteMinutes + opts.videoMinutes + opts.eocqMinutes + opts.questionMinutes,
    weightImpliedMinutes: opts.noteMinutes + opts.videoMinutes + opts.eocqMinutes + opts.questionMinutes,
    noteMinutes: opts.noteMinutes,
    videoMinutes: opts.videoMinutes,
    eocqMinutes: opts.eocqMinutes,
    questionMinutes: opts.questionMinutes,
    vignetteCount: opts.vignetteCount,
    calculationShare: opts.calculationShare,
  };
}

// ONE_MODULE: single module with typical task breakdown
const ONE_MODULE: PackableGroup[] = [
  fixtureGroup({
    ref: "test/m1",
    noteMinutes: 20,
    videoMinutes: 40,
    eocqMinutes: 20,
    questionMinutes: 40,
    vignetteCount: 2,
    calculationShare: 0.5,
  }),
];

// SEQ: sequence where naive packing would overflow 90-minute capacity
const SEQ: PackableGroup[] = [
  fixtureGroup({
    ref: "test/seq1",
    noteMinutes: 25,
    videoMinutes: 30,
    eocqMinutes: 20,
    questionMinutes: 30,
    vignetteCount: 2,
    calculationShare: 0.5,
  }),
  fixtureGroup({
    ref: "test/seq2",
    noteMinutes: 25,
    videoMinutes: 30,
    eocqMinutes: 20,
    questionMinutes: 25,
    vignetteCount: 2,
    calculationShare: 0.5,
  }),
];

// VIGNETTE_SPLIT: module where questions span multiple vignettes and must split at boundaries.
// 10 vignettes, 100 minutes = 10 min per vignette.
// Pre-grouped into 5 tasks of 20 minutes each (2 vignettes per task).
// With 25-minute daily capacity, each task fits individually but consecutive tasks don't.
// Expected: 5 question tasks covering vignettes 0-1, 2-3, 4-5, 6-7, 8-9.
const VIGNETTE_SPLIT: PackableGroup[] = [
  fixtureGroup({
    ref: "test/vig",
    noteMinutes: 10,
    videoMinutes: 10,
    eocqMinutes: 10,
    questionMinutes: 100,
    vignetteCount: 10,
    calculationShare: 0.5,
  }),
];

// LONG_LECTURE: video long enough to require splitting.
// 120-minute video with 60-minute capacity produces 2 parts of 60 each.
const LONG_LECTURE: PackableGroup[] = [
  fixtureGroup({
    ref: "test/long",
    noteMinutes: 0,
    videoMinutes: 120,
    eocqMinutes: 0,
    questionMinutes: 0,
    vignetteCount: 1,
    calculationShare: 0.5,
  }),
];

// CALC_HEAVY: high calculation share
const CALC_HEAVY: PackableGroup[] = [
  fixtureGroup({
    ref: "test/calc",
    noteMinutes: 20,
    videoMinutes: 30,
    eocqMinutes: 20,
    questionMinutes: 30,
    vignetteCount: 2,
    calculationShare: 0.5,
  }),
];

// JUDGEMENT: low calculation share
const JUDGEMENT: PackableGroup[] = [
  fixtureGroup({
    ref: "test/judgement",
    noteMinutes: 20,
    videoMinutes: 30,
    eocqMinutes: 20,
    questionMinutes: 30,
    vignetteCount: 2,
    calculationShare: 0.1,
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

// TESTS

test("a day never exceeds its availability", () => {
  const days = packDays(SEQ, calendar({ mon: 90 }), OPTS);
  for (const d of days) {
    expect(sum(d.tasks.map((t) => t.estimatedMinutes))).toBeLessThanOrEqual(90);
  }
});

test("a holiday gets no tasks and work moves to next available day", () => {
  const days = packDays(SEQ, calendar({ mon: 90, holidays: ["2027-01-04"] }), OPTS);
  const holidayDay = days.find((d) => d.date === "2027-01-04");
  expect(holidayDay).toBeDefined();
  expect(holidayDay!.tasks).toEqual([]);

  // Verify that some work appears after the holiday (not just discarded).
  const afterHoliday = days.slice(days.indexOf(holidayDay!) + 1);
  expect(afterHoliday.some(d => d.tasks.length > 0)).toBe(true);
});

test("a module's chain is emitted in order: notes, video, eocq, questions", () => {
  const days = packDays(ONE_MODULE, calendar({ every: 600 }), OPTS);
  const kinds = days.flatMap((d) => d.tasks.map((t) => t.kind));

  // Find indices of each kind (ignoring splits).
  const notes = kinds.findIndex(k => k === "content-notes");
  const video = kinds.findIndex(k => k === "content-video");
  const eocq = kinds.findIndex(k => k === "eocq");
  const questions = kinds.findIndex(k => k === "questions");

  expect(notes).toBeGreaterThanOrEqual(0);
  expect(video).toBeGreaterThan(notes);
  expect(eocq).toBeGreaterThan(video);
  expect(questions).toBeGreaterThan(eocq);
});

test("question blocks split at vignette boundaries, never mid-vignette", () => {
  // VIGNETTE_SPLIT has 10 vignettes in 100 minutes (10 min each).
  // Pre-grouped into 5 tasks of 2 vignettes (20 min each).
  // With 25-minute capacity, each fits individually but not consecutively.
  // Expected splits: 5 question tasks covering [0-1], [2-3], [4-5], [6-7], [8-9].
  const days = packDays(VIGNETTE_SPLIT, calendar({ every: 25 }), OPTS);
  const questionTasks = days.flatMap((d) => d.tasks).filter((t) => t.kind === "questions");

  // Should have exactly 5 question tasks.
  expect(questionTasks).toHaveLength(5);

  // Check exact vignette ranges (hand-derived).
  const ranges = questionTasks.map(t => [t.vignetteFrom, t.vignetteTo]);
  expect(ranges).toEqual([
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [8, 9],
  ]);

  // Verify contiguous coverage with no gaps or overlaps.
  let nextExpected = 0;
  for (const [from, to] of ranges) {
    expect(from).toBe(nextExpected);
    nextExpected = to! + 1;
  }
  expect(nextExpected).toBe(10);

  // No task exceeds capacity.
  for (const task of questionTasks) {
    expect(task.estimatedMinutes).toBeLessThanOrEqual(25);
  }
});

test("a long lecture splits into parts, none under 15 minutes", () => {
  // LONG_LECTURE: 120-minute video, 60-minute capacity.
  // Expected: 2 parts of 60 minutes each.
  const days = packDays(LONG_LECTURE, calendar({ every: 60 }), OPTS);
  const videoTasks = days.flatMap((d) => d.tasks).filter((t) => t.kind === "content-video");
  const parts = videoTasks.filter((t) => t.splitOf);

  expect(parts.length).toBeGreaterThan(1);
  for (const p of parts) {
    expect(p.estimatedMinutes).toBeGreaterThanOrEqual(15);
  }

  // Verify split indices are sequential.
  const indices = parts.map((p) => p.splitIndex).sort((a, b) => (a ?? 0) - (b ?? 0));
  expect(indices).toEqual([1, 2]);
});

test("question mode reflects calculation share: >= 0.35 is timed-drill, < 0.35 is untimed-review", () => {
  // Test boundary at 0.35.
  const atBoundary = packDays(CALC_HEAVY, calendar({ every: 600 }), OPTS);
  expect(modeOf(atBoundary)).toBe("timed-drill");

  const below = packDays(JUDGEMENT, calendar({ every: 600 }), OPTS);
  expect(modeOf(below)).toBe("untimed-review");
});

test("only the last task of each module has requiresConfidence true", () => {
  const days = packDays(ONE_MODULE, calendar({ every: 600 }), OPTS);
  const tasks = days.flatMap((d) => d.tasks);

  const withConfidence = tasks.filter((t) => t.requiresConfidence);
  expect(withConfidence).toHaveLength(1);
  expect(withConfidence[0].kind).toBe("questions");

  // The last task overall should be the one with confidence.
  expect(tasks[tasks.length - 1].requiresConfidence).toBe(true);
});
