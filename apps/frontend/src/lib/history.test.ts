import { describe, expect, test } from "vitest";
import {
  deleteEffect,
  extraReasonLabel,
  minutesText,
  mockFormError,
  questionProgress,
  recordedText,
  sourceOf,
  stepMinutes,
  stepRates,
  taskFormError,
  taskFormOf,
  taskPatch,
} from "./history";
import type { HistoryStep, HistoryTaskRecord } from "./types";

const task = (o: Partial<HistoryTaskRecord> = {}): HistoryTaskRecord => ({
  type: "task",
  id: "t1",
  date: "2026-11-17",
  recordedAt: "2026-11-17T14:32:00.000Z",
  kind: "questions",
  step: 2,
  round: 1,
  status: "done",
  offPlan: false,
  extraReason: null,
  packageId: "p1",
  packageName: "Bank",
  materials: [],
  estimatedMinutes: 30,
  actualMinutes: 28,
  answerReviewDone: false,
  answerReviewMinutes: null,
  answered: 10,
  correct: 8,
  confidence: 4,
  note: null,
  ...o,
});

describe("sourceOf", () => {
  test("names each origin", () => {
    expect(sourceOf(task()).label).toBe("Recorded");
    expect(sourceOf(task({ offPlan: true })).kind).toBe("off-plan");
    expect(sourceOf(task({ extraReason: "top-up-80" })).label).toBe("Extra: Accuracy top-up");
    expect(extraReasonLabel("answer-review-owed")).toBe("Owed answer review");
    expect(extraReasonLabel("new-thing")).toBe("New thing");
    expect(
      sourceOf({ type: "declaration", step: 1, date: "2026-10-01", createdAt: "", updatedAt: "", confidence: 3, answered: null, correct: null }).label,
    ).toBe("Self-stated");
  });
});

describe("display text", () => {
  test("question progress omits a zero extra", () => {
    expect(questionProgress({ n: 10, m: 15, q: 0 })).toBe("10 / 15");
    expect(questionProgress({ n: 10, m: 15, q: 3 })).toBe("10 / 15 + 3");
  });
  test("minutes", () => {
    expect(stepMinutes({ doneMin: 45, targetMin: 130 })).toBe("45m of 2h 10m");
    expect(minutesText({ estimatedMinutes: 30, actualMinutes: null })).toBe("est 30m, not timed");
    expect(minutesText({ estimatedMinutes: 30, actualMinutes: 28 })).toBe("est 30m, actual 28m");
  });
  test("calendar day is not shifted by time zone", () => {
    expect(recordedText("2026-11-17", undefined)).toBe("Tue 17 Nov");
  });
  test("step rates: round from the engine, overall over records", () => {
    const s = {
      step: 2,
      status: "in-progress",
      round: 2,
      doneMin: 0,
      targetMin: 0,
      questions: { n: 5, m: 15, q: 0, answered: 5, correct: 5, adequateMin: 30, minutes: 10, passed: false },
      records: [task({ answered: 10, correct: 5 }), task({ id: "t2", answered: 5, correct: 5 })],
    } as HistoryStep;
    expect(stepRates(s)).toEqual({ round: "100%", overall: "67%" });
  });
});

describe("deleteEffect", () => {
  test("explains the replan per kind", () => {
    expect(deleteEffect(task({ offPlan: true }))).toContain("removed");
    expect(deleteEffect(task())).toContain("back to your plan");
  });
});

describe("task form", () => {
  const rec = task();
  const today = "2026-11-18";
  test("round trips an unchanged form into a patch with no date or package", () => {
    const p = taskPatch(taskFormOf(rec), rec);
    expect(p).toMatchObject({ status: "done", actualMinutes: 28, questionsAnswered: 10, questionsCorrect: 8 });
    expect(p).not.toHaveProperty("date");
    expect(p).not.toHaveProperty("packageId");
  });
  test("sends date and package only when changed", () => {
    const f = { ...taskFormOf(rec), date: "2026-11-16", packageId: "p2" };
    expect(taskPatch(f, rec)).toMatchObject({ date: "2026-11-16", packageId: "p2" });
  });
  test("validation", () => {
    const f = taskFormOf(rec);
    expect(taskFormError(f, rec, today)).toBeNull();
    expect(taskFormError({ ...f, date: "2026-11-19" }, rec, today)).toMatch(/future/);
    expect(taskFormError({ ...f, correct: "11" }, rec, today)).toMatch(/exceed/);
    expect(taskFormError({ ...f, status: "partial", minutes: "" }, rec, today)).toMatch(/partial/);
    expect(taskFormError({ ...f, reviewed: true, reviewMinutes: "" }, rec, today)).toMatch(/review/);
    expect(taskFormError({ ...f, minutes: "0" }, rec, today)).toMatch(/Minutes/);
  });
  test("a reading record ignores question fields", () => {
    const r = task({ kind: "content-notes", answered: 0, correct: 0 });
    expect(taskPatch(taskFormOf(r), r)).not.toHaveProperty("questionsAnswered");
  });
});

describe("mockFormError", () => {
  test("checks date, score and counts", () => {
    const ok = { date: "2026-11-10", score: "72", answered: "20", correct: "15" };
    expect(mockFormError(ok, "2026-11-18")).toBeNull();
    expect(mockFormError({ ...ok, score: "101" }, "2026-11-18")).toMatch(/Score/);
    expect(mockFormError({ ...ok, correct: "21" }, "2026-11-18")).toMatch(/exceed/);
    expect(mockFormError({ ...ok, date: "2026-12-01" }, "2026-11-18")).toMatch(/future/);
  });
});
