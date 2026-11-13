import { describe, expect, test } from "vitest";
import { DEFAULT_EFFORT_CONSTANTS as C } from "./effort";
import {
  EXAM_MINUTES_PER_QUESTION,
  REVIEW_PACE_RATIO,
  questionPaceAnchor,
  questionRate,
  answerReviewMinutes,
  questionsIn,
  reviewQuestionMinutes,
  splitPractice,
} from "./question-pace";

describe("question pace", () => {
  test("exam pace is 264 minutes over 88 questions", () => {
    expect(EXAM_MINUTES_PER_QUESTION).toBeCloseTo(3.0, 10);
    expect(REVIEW_PACE_RATIO).toBeCloseTo(2.5 / 3.0, 10);
  });

  test("the anchor makes the question-weighted mean rate exactly exam pace", () => {
    const sets = [
      { questionCount: 8, calcCount: 0 },
      { questionCount: 28, calcCount: 5 },
      { questionCount: 12, calcCount: 9 },
    ];
    const anchor = questionPaceAnchor(sets, C);
    const total = sets.reduce((s, q) => s + q.questionCount * questionRate(q.calcCount / q.questionCount, anchor, C), 0);
    const count = sets.reduce((s, q) => s + q.questionCount, 0);
    expect(total / count).toBeCloseTo(3.0, 10);
  });

  test("a calculation-heavy topic is slower than a conceptual one, both near exam pace", () => {
    const anchor = questionPaceAnchor([{ questionCount: 10, calcCount: 0 }, { questionCount: 10, calcCount: 10 }], C);
    const conceptual = questionRate(0, anchor, C);
    const numeric = questionRate(1, anchor, C);
    expect(conceptual).toBeLessThan(3.0);
    expect(numeric).toBeGreaterThan(3.0);
  });

  test("eight conceptual questions fit in thirty minutes at learning pace", () => {
    // The reported case: QUANT reading 3, 8 questions, none calculation.
    const anchor = questionPaceAnchor([{ questionCount: 8, calcCount: 0 }, { questionCount: 28, calcCount: 5 }], C);
    expect(8 * questionRate(0, anchor, C)).toBeLessThanOrEqual(30);
  });

  test("an empty catalogue leaves the raw rates untouched", () => {
    expect(questionPaceAnchor([], C)).toBe(1);
  });

  test("review answers the same questions faster", () => {
    expect(reviewQuestionMinutes(30)).toBeCloseTo(25, 10);
  });

  test("questionsIn turns a slice of minutes back into a whole question count", () => {
    expect(questionsIn(24, 8, 24)).toBe(8);
    expect(questionsIn(9, 8, 24)).toBe(3);
    // Never zero for a real slice, never more than the bank.
    expect(questionsIn(1, 8, 24)).toBe(1);
    expect(questionsIn(40, 8, 24)).toBe(8);
    expect(questionsIn(10, 0, 0)).toBeUndefined();
  });
});

describe("answer review", () => {
  test("is the explanation text, answers minus questions, at the reading speed", () => {
    // QUANT reading 3: answer file 3103 words, question file 708.
    expect(answerReviewMinutes({ answerWords: 3103, questionWords: 708 }, 21, 200)).toBeCloseTo(11.975, 3);
  });

  test("falls back to a third of answering time when the files are not measured", () => {
    expect(answerReviewMinutes({ answerWords: null, questionWords: 708 }, 21, 200)).toBeCloseTo(7, 10);
    expect(answerReviewMinutes({ answerWords: 3103, questionWords: null }, 21, 200)).toBeCloseTo(7, 10);
    expect(answerReviewMinutes({ answerWords: 500, questionWords: 708 }, 21, 200)).toBeCloseTo(7, 10);
  });

  test("a practice slice splits into answering and reviewing that add back up", () => {
    expect(splitPractice(33, 21 / 33)).toEqual({ answering: 21, review: 12 });
    expect(splitPractice(10, 1)).toEqual({ answering: 10, review: 0 });
    const tiny = splitPractice(2, 0.6);
    expect(tiny.answering + tiny.review).toBe(2);
    expect(tiny.answering).toBeGreaterThanOrEqual(1);
  });
});
