import { expect, test } from "vitest";
import { mockError, rowsFromMix, toTopicScores, totals } from "./mock-entry";

const mix = [
  { topicId: "t1", name: "Ethics", order: 1, questions: 10 },
  { topicId: "t2", name: "Quant", order: 2, questions: 20 },
];

test("a known topic mix prefills answered per topic and leaves correct empty", () => {
  expect(rowsFromMix(mix)).toEqual([
    { topicId: "t1", answered: "10", correct: "" },
    { topicId: "t2", answered: "20", correct: "" },
  ]);
  expect(rowsFromMix([])).toEqual([]);
});

test("totals add answered and correct, and give a whole-percent score", () => {
  const rows = [{ topicId: "t1", answered: "10", correct: "7" }, { topicId: "t2", answered: "20", correct: "14" }];
  expect(totals(rows)).toEqual({ answered: 30, correct: 21, percent: 70 });
  expect(totals([{ topicId: "t1", answered: "", correct: "" }]).percent).toBeNull();
});

test("every row needs a topic, whole counts and correct no higher than answered", () => {
  const ok = [{ topicId: "t1", answered: "10", correct: "7" }];
  expect(mockError(ok, null)).toBeNull();
  expect(mockError([], null)).toBe("Add at least one topic with its question counts.");
  expect(mockError([{ topicId: "", answered: "10", correct: "7" }], null)).toBe("Choose a topic for every row.");
  expect(mockError([{ topicId: "t1", answered: "10", correct: "11" }], null)).toBe(
    "Correct answers cannot exceed questions answered.",
  );
  expect(mockError([{ topicId: "t1", answered: "10", correct: "" }], null)).toBe("Enter the correct count for every topic.");
  expect(mockError([{ topicId: "t1", answered: "0", correct: "0" }], null)).toBe("Enter questions answered for every topic.");
  expect(mockError([{ topicId: "t1", answered: "1.5", correct: "1" }], null)).toBe("Use whole numbers for questions.");
});

test("a topic cannot appear twice, and a known session size must be matched", () => {
  const dup = [{ topicId: "t1", answered: "5", correct: "4" }, { topicId: "t1", answered: "5", correct: "4" }];
  expect(mockError(dup, null)).toBe("Each topic can appear once.");
  const rows = [{ topicId: "t1", answered: "10", correct: "7" }];
  expect(mockError(rows, 30)).toBe("Questions answered add up to 10, but this session has 30.");
  expect(mockError([{ topicId: "t1", answered: "30", correct: "7" }], 30)).toBeNull();
});

test("topic scores are sent as numbers", () => {
  expect(toTopicScores([{ topicId: "t1", answered: "10", correct: "7" }])).toEqual([
    { topicId: "t1", answered: 10, correct: 7 },
  ]);
});
