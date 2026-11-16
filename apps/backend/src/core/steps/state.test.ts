import { describe, it, expect } from "vitest";
import { deriveState, type HistoryTask, type Declaration } from "./state";
import type { ModuleCatalog } from "./types";

// s1 = 60 min, s3 = 20 min, one UW bank of 100 q at 3 + 1 min: adequate2 = 120 (30 q), adequate4 = 240.
const q = { packageSlug: "uw", packageId: "p", resourceIds: [], kind: "questions" as const, minutes: 400,
  questions: 100, minutesPerQuestion: 3, answerReviewPerQuestion: 1, label: "uw" };
const mod = (id = "r1", topicId = "t1"): ModuleCatalog => ({
  readingId: id, topicId, topicOrder: 1, readingOrder: 1, examWeight: 0.1,
  options: {
    1: [{ ...q, kind: "read", packageSlug: "mm", minutes: 60, questions: undefined }],
    2: [q],
    3: [{ ...q, kind: "read", packageSlug: "mm", minutes: 20, questions: undefined }],
    4: [q],
  },
});
const cat = [mod()];
let n = 0;
const task = (o: Partial<HistoryTask>): HistoryTask => ({
  id: `t${++n}`, date: "2026-01-01", kind: "read", step: null, round: null, readingIds: ["r1"],
  status: "done", minutes: 0, answered: 0, correct: 0, answerReviewDone: true, packageSlug: "uw", ...o,
});
const st = (tasks: HistoryTask[], decls: Declaration[] = [], mocks: any[] = []) =>
  deriveState(cat, tasks, decls, mocks).get("r1")!;

describe("deriveState", () => {
  it("fresh module is all open", () => {
    const s = st([]);
    expect(s.s1.done).toBe(false);
    expect(s.s2.passed).toBe(false);
    expect(s.s3.owed).toBe(0);
    expect(s.s3.done).toBe(false);
  });

  it("old step-1 kinds credit step 1", () => {
    for (const kind of ["content-notes", "content-video", "seminar", "eocq"]) {
      expect(st([task({ kind, minutes: 60 })]).s1.done, kind).toBe(true);
    }
  });

  it("old review credits step 3", () => {
    const s = st([task({ kind: "review", minutes: 20 })]);
    expect(s.s3.done).toBe(true);
    expect(s.s1.doneMin).toBe(0);
  });

  it("old questions count to step 2 until it passes, then step 4 once step 3 is done", () => {
    let s = st([task({ kind: "questions", minutes: 90, answered: 30, correct: 27 })]);
    expect(s.s2.passed).toBe(true); // 30 q + review = 120 min, 90%
    s = st([
      task({ kind: "questions", date: "2026-01-01", minutes: 90, answered: 30, correct: 27 }),
      task({ kind: "questions", date: "2026-01-02", minutes: 30, answered: 10, correct: 5 }),
    ]);
    expect(s.s4.answered).toBe(0); // s3 not done: stays in step 2
    expect(s.s2.answered).toBe(40);
    s = st([
      task({ kind: "questions", date: "2026-01-01", minutes: 90, answered: 30, correct: 27 }),
      task({ kind: "review", date: "2026-01-02", minutes: 20 }),
      task({ kind: "questions", date: "2026-01-03", minutes: 30, answered: 10, correct: 5 }),
    ]);
    expect(s.s4.answered).toBe(10);
    expect(s.s4.correct).toBe(5);
  });

  it("partial credits min(actual, estimate)", () => {
    const s = st([task({ kind: "read", status: "partial", minutes: 50, estimateMinutes: 30 })]);
    expect(s.s1.doneMin).toBe(30);
  });

  it("ignores pending tasks and undo returns the fresh state", () => {
    const done = task({ kind: "questions", step: 2, minutes: 90, answered: 30, correct: 27 });
    expect(st([{ ...done, status: "pending" }])).toEqual(st([]));
    expect(st([done])).not.toEqual(st([]));
  });

  it("questions without answer review are pending, an answer-review task clears them", () => {
    const qt = task({ kind: "questions", step: 2, minutes: 90, answered: 30, correct: 27, answerReviewDone: false });
    let s = st([qt]);
    expect(s.s2.pendingAnswerReview).toBe(30);
    expect(s.s2.passed).toBe(false);
    s = st([qt, task({ kind: "answer-review", step: 2, date: "2026-01-02", minutes: 30 })]);
    expect(s.s2.pendingAnswerReview).toBe(0);
    expect(s.s2.passed).toBe(true);
  });

  it("exemption opens round 2 and owes a review", () => {
    // 60 q at 67%: 240 min = 2 x adequate
    const s = st([task({ kind: "questions", step: 2, minutes: 180, answered: 60, correct: 40 })]);
    expect(s.s2.round).toBe(2);
    expect(s.s2.answered).toBe(0);
    expect(s.s3.owed).toBe(1);
  });

  it("declared step 2 passing marks it passed, otherwise counts become attempts", () => {
    expect(st([], [{ readingId: "r1", step: 2, confidence: null, answered: 40, correct: 36 }]).s2.passed).toBe(true);
    const s = st([], [{ readingId: "r1", step: 2, confidence: null, answered: 40, correct: 24 }]);
    expect(s.s2.passed).toBe(false);
    expect(s.s2.answered).toBe(40);
    expect(s.s2.pendingAnswerReview).toBe(0);
  });

  it("step 3 declaration is ignored without step 1; step 4 without step 2", () => {
    const s3 = { readingId: "r1", step: 3 as const, confidence: null, answered: null, correct: null };
    expect(st([], [s3]).s3.done).toBe(false);
    expect(st([task({ kind: "read", minutes: 60 })], [s3]).s3.done).toBe(true);
    const s4 = { readingId: "r1", step: 4 as const, confidence: null, answered: null, correct: null };
    expect(st([], [s4]).s4.passed).toBe(false);
  });

  it("low-confidence step 1 needs half the minutes", () => {
    const d = { readingId: "r1", step: 1 as const, confidence: 2, answered: null, correct: null };
    let s = st([], [d]);
    expect(s.s1.lowConfidence).toBe(true);
    expect(s.s1.done).toBe(false);
    s = st([task({ kind: "read", minutes: 30 })], [d]);
    expect(s.s1.done).toBe(true);
    expect(st([], [{ ...d, confidence: 4 }]).s1.done).toBe(true);
  });

  it("mock topic below 75% reopens a passed step 4 and owes a review", () => {
    const base = [
      task({ kind: "read", step: 1, minutes: 60, date: "2026-01-01" }),
      task({ kind: "questions", step: 2, minutes: 90, answered: 30, correct: 27, date: "2026-01-02" }),
      task({ kind: "review", step: 3, minutes: 20, date: "2026-01-03" }),
      task({ kind: "questions", step: 4, minutes: 180, answered: 60, correct: 54, date: "2026-01-04" }),
    ];
    expect(st(base).s4.passed).toBe(true);
    const s = st(base, [], [{ date: "2026-02-01", topicScores: [{ topicId: "t1", answered: 20, correct: 14 }] }]);
    expect(s.s4.passed).toBe(false);
    expect(s.s4.round).toBe(2);
    expect(s.s3.owed).toBe(1);
    expect(s.mockRetestFrom).toBe("2026-02-01");
    const ok = st(base, [], [{ date: "2026-02-01", topicScores: [{ topicId: "t1", answered: 20, correct: 15 }] }]);
    expect(ok.s4.passed).toBe(true);
  });
});
