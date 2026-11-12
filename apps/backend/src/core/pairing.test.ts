import { expect, test } from "vitest";
import { DEFAULT_TUNING } from "./tuning";
import type { MasteryObservation } from "./mastery";
import { masteryOfUnit } from "./mastery";
import type { PackableGroup } from "./packing";
import {
  questionMinutesOf,
  readingMinutesOf,
  reconcile,
  solveQuestionMultiple,
} from "./pairing";

const T = DEFAULT_TUNING;
const NOW = new Date("2026-11-12T00:00:00Z");

function unit(
  ref: string,
  m: { read: number; questions: number; review?: number },
): PackableGroup {
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
  };
}

function obs(p: Partial<MasteryObservation> = {}): MasteryObservation {
  return {
    losId: "l1",
    answered: 0,
    correct: 0,
    available: 100,
    confidence: null,
    lastTouch: null,
    questionMinutes: 60,
    ...p,
  };
}

test("reading is notes, video and seminar; questions are question sets and eocq", () => {
  const g: PackableGroup = {
    ...unit("x", { read: 0, questions: 0 }),
    noteMinutes: 10,
    videoMinutes: 20,
    seminarMinutes: 5,
    reviewMinutes: 99,
    questionMinutes: 40,
    eocqMinutes: 7,
  };
  expect(readingMinutesOf(g)).toBe(35);
  expect(questionMinutesOf(g)).toBe(47);
});

test("review video minutes are held back from the first pass entirely", () => {
  const g = unit("x", { read: 30, questions: 60, review: 25 });
  expect(readingMinutesOf(g)).toBe(30);
  expect(questionMinutesOf(g)).toBe(60);
});

test("pacing is the candidate's preference and the calendar never moves it", () => {
  for (const available of [0, 600, 2580, 5000, 50_000]) {
    expect(solveQuestionMultiple(1000, available, T).pacing).toBe(2);
  }
});

test("a roomy calendar reaches past the requested ratio, so the whole bank stays in play", () => {
  // The candidate's own topic 1 sits at 1 to 2.5 and their days consumed all of
  // it. A budget capped at the requested 2.0 would have abandoned the rest.
  const r = solveQuestionMultiple(1000, 5000, T);
  expect(r.budget).toBeCloseTo(4, 10);
  expect(r.budget).toBeGreaterThan(r.requested);
  expect(r.calendarTooShort).toBe(false);
});

test("a tight calendar budgets the largest ratio that fits, reported against the request", () => {
  // R = 1000, A = 2580, so (A - R) / R = 1.58.
  const r = solveQuestionMultiple(1000, 2580, T);
  expect(r.budget).toBeCloseTo(1.58, 10);
  expect(r.requested).toBe(2);
  expect(r.budget).toBeLessThan(r.requested);
  expect(r.calendarTooShort).toBe(false);
});

test("a calendar shorter than the reading alone clamps to the floor and flags, never goes negative", () => {
  const r = solveQuestionMultiple(1000, 600, T);
  expect(r.budget).toBe(T.questionMultipleFloor);
  expect(r.budget).toBeGreaterThan(0);
  expect(r.calendarTooShort).toBe(true);
});

test("a zero-availability calendar clamps to the floor and flags", () => {
  const r = solveQuestionMultiple(1000, 0, T);
  expect(r.budget).toBe(T.questionMultipleFloor);
  expect(r.calendarTooShort).toBe(true);
});

test("zero reading minutes does not divide by zero", () => {
  const r = solveQuestionMultiple(0, 500, T);
  expect(Number.isFinite(r.budget)).toBe(true);
  expect(r.budget).toBe(2);
});

test("a fresh unit owes all its reading and multiple times its reading in questions", () => {
  const { units } = reconcile(
    [unit("qm/lm1", { read: 56, questions: 140 })],
    new Map(),
    new Map(),
    new Map(),
    2,
    NOW,
    T,
  );
  expect(units[0]).toMatchObject({
    readingDebt: 56,
    questionDebt: 112,
    pairing: "paired",
  });
});

test("question debt never exceeds the stock that exists", () => {
  const { units, underPractised } = reconcile(
    [unit("qm/lm1", { read: 100, questions: 50 })],
    new Map(),
    new Map(),
    new Map(),
    2,
    NOW,
    T,
  );
  expect(units[0].questionDebt).toBe(50);
  expect(underPractised).toEqual([{ ref: "qm/lm1", shortfallMinutes: 150 }]);
});

test("reading already done off plan yields a questions-only unit", () => {
  const { units } = reconcile(
    [unit("qm/lm1", { read: 56, questions: 140 })],
    new Map(),
    new Map([["qm/lm1", 56]]),
    new Map(),
    2,
    NOW,
    T,
  );
  expect(units[0]).toMatchObject({ readingDebt: 0, pairing: "questions-only" });
  expect(units[0].questionDebt).toBeGreaterThan(0);
});

test("questions done but proficiency not shown yields a reading-only unit", () => {
  const weak = [
    obs({
      answered: 40,
      correct: 14,
      available: 40,
      confidence: 2,
      lastTouch: NOW,
      questionMinutes: 140,
    }),
  ];
  const { units, writeOffs } = reconcile(
    [unit("qm/lm1", { read: 56, questions: 140 })],
    new Map([["qm/lm1", weak]]),
    new Map(),
    new Map([["qm/lm1", 140]]),
    2,
    NOW,
    T,
  );
  expect(units[0]).toMatchObject({
    questionDebt: 0,
    readingDebt: 56,
    pairing: "reading-only",
  });
  expect(writeOffs).toEqual([]);
});

test("questions done and proficiency shown writes the reading off, with the mastery that justified it", () => {
  const strong = [
    obs({
      answered: 140,
      correct: 133,
      available: 140,
      confidence: 5,
      lastTouch: NOW,
      questionMinutes: 140,
    }),
  ];
  const { units, writeOffs } = reconcile(
    [unit("qm/lm1", { read: 56, questions: 140 })],
    new Map([["qm/lm1", strong]]),
    new Map(),
    new Map([["qm/lm1", 140]]),
    2,
    NOW,
    T,
  );
  expect(units).toEqual([]);
  expect(writeOffs).toHaveLength(1);
  expect(writeOffs[0]).toMatchObject({ ref: "qm/lm1", readingMinutesDropped: 56 });
  expect(writeOffs[0].mastery).toBeGreaterThanOrEqual(T.readingWriteOffBar);
});

test("the write-off bar is stricter than the learned bar, so a unit can leave review without skipping its reading", () => {
  const middling = [
    obs({
      answered: 140,
      correct: 112,
      available: 140,
      confidence: 4,
      lastTouch: NOW,
      questionMinutes: 140,
    }),
  ];
  const m = masteryOfUnit(middling, NOW, T);
  expect(m).toBeGreaterThanOrEqual(T.masteryBar);
  expect(m).toBeLessThan(T.readingWriteOffBar);

  const { units, writeOffs } = reconcile(
    [unit("qm/lm1", { read: 56, questions: 140 })],
    new Map([["qm/lm1", middling]]),
    new Map(),
    new Map([["qm/lm1", 140]]),
    2,
    NOW,
    T,
  );
  expect(writeOffs).toEqual([]);
  expect(units[0].pairing).toBe("reading-only");
});

test("over-practising one unit earns no credit against another", () => {
  const { units } = reconcile(
    [
      unit("qm/lm1", { read: 56, questions: 140 }),
      unit("qm/lm2", { read: 51, questions: 104 }),
    ],
    new Map(),
    new Map(),
    new Map([["qm/lm1", 500]]),
    2,
    NOW,
    T,
  );
  expect(units.find((u) => u.ref === "qm/lm1")!.questionDebt).toBe(0);
  expect(units.find((u) => u.ref === "qm/lm2")!.questionDebt).toBe(102);
});

test("a fully settled unit leaves the first pass entirely", () => {
  const { units } = reconcile(
    [unit("qm/lm1", { read: 56, questions: 140 })],
    new Map(),
    new Map([["qm/lm1", 56]]),
    new Map([["qm/lm1", 140]]),
    2,
    NOW,
    T,
  );
  expect(units).toEqual([]);
});

test("a settled unit is not reported as under-practised, because nothing is owed", () => {
  const { underPractised } = reconcile(
    [unit("qm/lm1", { read: 56, questions: 140 })],
    new Map(),
    new Map([["qm/lm1", 56]]),
    new Map([["qm/lm1", 140]]),
    2,
    NOW,
    T,
  );
  expect(underPractised).toEqual([]);
});

test("the sequence order is preserved through reconciliation", () => {
  const { units } = reconcile(
    [
      unit("a", { read: 30, questions: 60 }),
      unit("b", { read: 30, questions: 60 }),
      unit("c", { read: 30, questions: 60 }),
    ],
    new Map(),
    new Map(),
    new Map(),
    2,
    NOW,
    T,
  );
  expect(units.map((u) => u.ref)).toEqual(["a", "b", "c"]);
});

test("a reduced multiple lowers the question debt, never the reading debt", () => {
  const { units } = reconcile(
    [unit("qm/lm1", { read: 56, questions: 140 })],
    new Map(),
    new Map(),
    new Map(),
    1,
    NOW,
    T,
  );
  expect(units[0].readingDebt).toBe(56);
  expect(units[0].questionDebt).toBe(56);
});
