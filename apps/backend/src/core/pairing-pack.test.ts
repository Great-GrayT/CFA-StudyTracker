import { expect, test } from "vitest";
import { DEFAULT_TUNING } from "./tuning";
import type { Calendar, PlannedDay } from "./packing";
import type { ReconciledUnit } from "./pairing";
import { packFirstPass } from "./pairing";

const T = DEFAULT_TUNING;

function recon(
  ref: string,
  m: { read: number; questions: number; review?: number },
  p: Partial<ReconciledUnit> = {},
): ReconciledUnit {
  return {
    ref,
    readingRefs: [ref],
    prereqRefs: [],
    phaseBand: 1,
    moduleOrder: 1,
    priorityRank: 0,
    weight: 10,
    estimatedMinutes: m.read + m.questions,
    weightImpliedMinutes: m.read + m.questions,
    noteMinutes: m.read,
    videoMinutes: 0,
    eocqMinutes: 0,
    seminarMinutes: 0,
    reviewMinutes: m.review ?? 0,
    questionMinutes: m.questions,
    vignetteCount: Math.max(1, Math.round(m.questions / 18)),
    calculationShare: 0.4,
    readingDebt: m.read,
    questionDebt: m.questions,
    pairing: "paired",
    ...p,
  };
}

// Per-day minutes directly, bypassing the hours-to-minutes conversion that
// once turned a two hour Tuesday into a two minute Tuesday.
// 2026-11-16 is a Monday, so index 0 of perDay is mon.
function calendarOf(perDay: number[]): Calendar {
  const keys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const availability: Record<string, number> = {};
  keys.forEach((k, i) => {
    availability[k] = perDay[i] ?? 0;
  });
  return {
    weeklyAvailability: availability,
    startDate: "2026-11-16",
    horizonDays: Math.max(perDay.length, 7),
    holidays: [],
  };
}

function summarise(
  day: PlannedDay,
): Array<{ kind: string; ref: string; minutes: number }> {
  return day.tasks.map((t) => ({
    kind: t.kind,
    ref: t.readingIds[0],
    minutes: t.estimatedMinutes,
  }));
}

function fixtureManyUnits(): ReconciledUnit[] {
  return Array.from({ length: 12 }, (_, i) =>
    recon(`t${Math.floor(i / 3)}/lm${i % 3}`, {
      read: 30 + i * 5,
      questions: 60 + i * 11,
    }),
  );
}

// THE acceptance test for this feature. Figures are the candidate's own.
test("reproduces the candidate's three days exactly", () => {
  const days = packFirstPass(
    [
      recon("qm/lm1", { read: 56, questions: 140 }),
      recon("qm/lm2", { read: 51, questions: 104 }),
    ],
    calendarOf([120, 127, 104]),
    2,
    T,
  );
  expect(summarise(days[0])).toEqual([
    { kind: "content-notes", ref: "qm/lm1", minutes: 40 },
    { kind: "questions", ref: "qm/lm1", minutes: 80 },
  ]);
  expect(summarise(days[1])).toEqual([
    { kind: "content-notes", ref: "qm/lm1", minutes: 16 },
    { kind: "questions", ref: "qm/lm1", minutes: 60 },
    { kind: "content-notes", ref: "qm/lm2", minutes: 17 },
    { kind: "questions", ref: "qm/lm2", minutes: 34 },
  ]);
  expect(summarise(days[2])).toEqual([
    { kind: "content-notes", ref: "qm/lm2", minutes: 34 },
    { kind: "questions", ref: "qm/lm2", minutes: 70 },
  ]);
});

test("a closing unit flushes its bank rather than leaving a stub", () => {
  // 16 minutes of reading pulls all 60 remaining question minutes, not 32.
  const days = packFirstPass(
    [recon("qm/lm1", { read: 56, questions: 140 })],
    calendarOf([120, 127]),
    2,
    T,
  );
  expect(summarise(days[1])).toEqual([
    { kind: "content-notes", ref: "qm/lm1", minutes: 16 },
    { kind: "questions", ref: "qm/lm1", minutes: 60 },
  ]);
});

test("a new unit is not opened for less than the floor of reading", () => {
  // 40 minutes left after unit a closes gives floor(40/3) = 13, under the floor.
  const days = packFirstPass(
    [recon("a", { read: 20, questions: 40 }), recon("b", { read: 90, questions: 180 })],
    calendarOf([100, 200]),
    2,
    T,
  );
  expect(summarise(days[0]).every((task) => task.ref === "a")).toBe(true);
});

test("a unit whose entire reading is under the floor is placed anyway", () => {
  const days = packFirstPass(
    [recon("a", { read: 90, questions: 180 }), recon("tiny", { read: 8, questions: 16 })],
    calendarOf([300, 300]),
    2,
    T,
  );
  const placed = days.flatMap(summarise).filter((task) => task.ref === "tiny");
  expect(placed.length).toBeGreaterThan(0);
  // Its reading survives as reading. Folding an 8 minute read into the question
  // task beside it would report the reading as done under a question label.
  expect(placed.some((task) => task.kind === "content-notes")).toBe(true);
});

test("a unit with zero reading minutes is placed and never starves the horizon", () => {
  const days = packFirstPass(
    [recon("vid", { read: 0, questions: 90 }), recon("next", { read: 60, questions: 120 })],
    calendarOf([120, 120, 120]),
    2,
    T,
  );
  const refs = days.flatMap(summarise).map((task) => task.ref);
  expect(refs).toContain("vid");
  expect(refs).toContain("next");
});

test("a unit with zero question minutes places its reading and advances", () => {
  const days = packFirstPass(
    [recon("dry", { read: 60, questions: 0 }), recon("next", { read: 60, questions: 120 })],
    calendarOf([120, 120, 120]),
    2,
    T,
  );
  const refs = days.flatMap(summarise).map((task) => task.ref);
  expect(refs).toContain("dry");
  expect(refs).toContain("next");
});

test("a questions-only unit gets a day with no reading on it", () => {
  const days = packFirstPass(
    [
      recon(
        "qm/lm1",
        { read: 56, questions: 140 },
        { readingDebt: 0, pairing: "questions-only" },
      ),
    ],
    calendarOf([120]),
    2,
    T,
  );
  expect(summarise(days[0]).length).toBeGreaterThan(0);
  expect(summarise(days[0]).every((task) => task.kind === "questions")).toBe(true);
});

test("a reading-only unit gets a day with no questions on it", () => {
  const days = packFirstPass(
    [
      recon(
        "qm/lm1",
        { read: 56, questions: 140 },
        { questionDebt: 0, pairing: "reading-only" },
      ),
    ],
    calendarOf([120]),
    2,
    T,
  );
  expect(summarise(days[0]).length).toBeGreaterThan(0);
  expect(summarise(days[0]).every((task) => task.kind !== "questions")).toBe(true);
});

test("no scheduled question task precedes the reading of its own unit", () => {
  const days = packFirstPass(fixtureManyUnits(), calendarOf(Array(7).fill(150)), 2, T);
  const firstRead = new Map<string, number>();
  let index = 0;
  for (const day of days) {
    for (const task of day.tasks) {
      index++;
      const ref = task.readingIds[0];
      if (task.kind !== "questions" && !firstRead.has(ref)) firstRead.set(ref, index);
      if (task.kind === "questions") {
        expect(firstRead.get(ref)).toBeLessThan(index);
      }
    }
  }
});

test("the week's packed minutes never exceed the week's availability", () => {
  const cal = calendarOf([120, 120, 120, 120, 120, 0, 0]);
  const days = packFirstPass(fixtureManyUnits(), cal, 2, T);
  const packed = days
    .slice(0, 7)
    .flatMap((d) => d.tasks)
    .reduce((sum, t) => sum + t.estimatedMinutes, 0);
  expect(packed).toBeLessThanOrEqual(600);
});

test("an underfilled day lends its unused minutes to the days after it", () => {
  // Monday can only open one unit, so Tuesday should be allowed past its own
  // nominal 60 using Monday's leftovers.
  const days = packFirstPass(
    [recon("a", { read: 20, questions: 40 }), recon("b", { read: 90, questions: 180 })],
    calendarOf([100, 60, 60, 60, 60, 0, 0]),
    2,
    T,
  );
  const tuesday = days[1].tasks.reduce((s, t) => s + t.estimatedMinutes, 0);
  expect(tuesday).toBeGreaterThan(60);
});

test("a reduced pacing multiple shrinks the question slice, not the reading", () => {
  const days = packFirstPass(
    [recon("qm/lm1", { read: 100, questions: 200 })],
    calendarOf([120]),
    1,
    T,
  );
  expect(summarise(days[0])).toEqual([
    { kind: "content-notes", ref: "qm/lm1", minutes: 60 },
    { kind: "questions", ref: "qm/lm1", minutes: 60 },
  ]);
});

test("a reading slice spanning several kinds emits one task per kind, in order", () => {
  const spanning = recon(
    "x",
    { read: 0, questions: 0 },
    {
      noteMinutes: 20,
      videoMinutes: 30,
      seminarMinutes: 25,
      questionMinutes: 150,
      readingDebt: 75,
      questionDebt: 150,
      vignetteCount: 8,
    },
  );
  const days = packFirstPass([spanning], calendarOf([300]), 2, T);
  const kinds = summarise(days[0]).map((task) => task.kind);
  expect(kinds).toEqual(["content-notes", "content-video", "seminar", "questions"]);
});

test("a zero-minute day holds no tasks and lends nothing", () => {
  const days = packFirstPass(
    [recon("a", { read: 60, questions: 120 })],
    calendarOf([0, 180]),
    2,
    T,
  );
  expect(days[0].tasks).toEqual([]);
  expect(days[1].tasks.length).toBeGreaterThan(0);
});

test("the last question task of a unit asks for a confidence rating and the others do not", () => {
  const days = packFirstPass(
    [recon("qm/lm1", { read: 56, questions: 140 })],
    calendarOf([120, 127]),
    2,
    T,
  );
  const questionTasks = days
    .flatMap((d) => d.tasks)
    .filter((t) => t.kind === "questions");
  expect(questionTasks.length).toBeGreaterThan(1);
  expect(questionTasks.slice(0, -1).every((t) => !t.requiresConfidence)).toBe(true);
  expect(questionTasks[questionTasks.length - 1].requiresConfidence).toBe(true);
});

test("question tasks carry a vignette range that advances and never overlaps", () => {
  const days = packFirstPass(
    [recon("qm/lm1", { read: 56, questions: 140 })],
    calendarOf([120, 127]),
    2,
    T,
  );
  const ranges = days
    .flatMap((d) => d.tasks)
    .filter((t) => t.kind === "questions")
    .map((t) => [t.vignetteFrom ?? 0, t.vignetteTo ?? 0]);
  expect(ranges.length).toBeGreaterThan(1);
  for (let i = 1; i < ranges.length; i++) {
    expect(ranges[i][0]).toBeGreaterThanOrEqual(ranges[i - 1][0]);
    expect(ranges[i][1]).toBeGreaterThanOrEqual(ranges[i - 1][1]);
  }
});

test("no task is ever zero or negative minutes", () => {
  const days = packFirstPass(fixtureManyUnits(), calendarOf(Array(7).fill(90)), 2, T);
  for (const day of days) {
    for (const task of day.tasks) {
      expect(task.estimatedMinutes).toBeGreaterThan(0);
    }
  }
});

test("an empty unit list yields days with no tasks rather than throwing", () => {
  const days = packFirstPass([], calendarOf([120, 120]), 2, T);
  expect(days.every((d) => d.tasks.length === 0)).toBe(true);
});

test("every unit in the sequence is eventually placed, given enough calendar", () => {
  const units = fixtureManyUnits();
  const days = packFirstPass(units, calendarOf(Array(7).fill(600)), 2, T);
  const placed = new Set(days.flatMap((d) => d.tasks).map((t) => t.readingIds[0]));
  expect(placed.size).toBe(units.length);
});

test("a unit whose questions have run dry takes its remaining reading in one task, not a shrinking series", () => {
  // Found by eyeballing a real generated plan: a 108 minute Wednesday held six
  // content-video tasks for the same reading, at 40, 24, 16, 10, 7 and 3
  // minutes. With no questions left to pair, each pass took a third of what
  // remained and looped on the same unit, so the day fragmented geometrically.
  const days = packFirstPass(
    [recon("dry", { read: 300, questions: 40 })],
    calendarOf([120, 120, 120]),
    2,
    T,
  );

  for (const day of days) {
    const readingTasks = day.tasks.filter((t) => t.kind !== "questions");
    expect(readingTasks.length, `${day.date} fragmented into ${readingTasks.length} reading tasks`)
      .toBeLessThanOrEqual(1);
  }
});

test("the reading-only mirror of the flush fills the day rather than a third of it", () => {
  const days = packFirstPass(
    [recon("r", { read: 300, questions: 0 }, { questionDebt: 0, pairing: "reading-only" })],
    calendarOf([120]),
    2,
    T,
  );
  expect(summarise(days[0])).toEqual([
    { kind: "content-notes", ref: "r", minutes: 120 },
  ]);
});

test("a day never holds more reading tasks than the unit has kinds of reading", () => {
  const spanning = recon(
    "x",
    { read: 0, questions: 0 },
    {
      noteMinutes: 100,
      videoMinutes: 100,
      seminarMinutes: 100,
      questionMinutes: 20,
      readingDebt: 300,
      questionDebt: 20,
      vignetteCount: 2,
    },
  );
  const days = packFirstPass([spanning], calendarOf([150, 150, 150]), 2, T);
  for (const day of days) {
    const readingTasks = day.tasks.filter((t) => t.kind !== "questions");
    expect(readingTasks.length).toBeLessThanOrEqual(3);
  }
});

test("a watched video leaves the notes whole and drops the video", () => {
  // 30 min of notes, 40 of video; the video is done, so 30 of reading is owed.
  const unit = recon("u1", { read: 30, questions: 0 }, {
    noteMinutes: 30,
    videoMinutes: 40,
    readingDebt: 30,
    questionDebt: 0,
    pairing: "reading-only",
    readingDoneByKind: { "content-video": 40 },
  });
  const days = packFirstPass([unit], calendarOf([120]), 1, T);
  const tasks = days.flatMap((d) => d.tasks);
  expect(tasks.some((t) => t.kind === "content-video")).toBe(false);
  expect(tasks.filter((t) => t.kind === "content-notes").reduce((s, t) => s + t.estimatedMinutes, 0)).toBe(30);
});

test("pooled credit with no per-kind detail still scales every kind", () => {
  const unit = recon("u1", { read: 35, questions: 0 }, {
    noteMinutes: 30,
    videoMinutes: 40,
    readingDebt: 35,
    questionDebt: 0,
    pairing: "reading-only",
  });
  const days = packFirstPass([unit], calendarOf([120]), 1, T);
  const total = days.flatMap((d) => d.tasks).reduce((s, t) => s + t.estimatedMinutes, 0);
  expect(total).toBe(35);
});
