import { expect, test } from "vitest";
import { formatQuestionNumbers, parseQuestionNumbers } from "./question-numbers";

test("parses lists, ranges, en dashes and mixes", () => {
  expect(parseQuestionNumbers("1,3,4")).toEqual({ numbers: [1, 3, 4], error: null });
  expect(parseQuestionNumbers("2-5").numbers).toEqual([2, 3, 4, 5]);
  expect(parseQuestionNumbers("2\u20135").numbers).toEqual([2, 3, 4, 5]);
  expect(parseQuestionNumbers("1, 3-5, 12  4").numbers).toEqual([1, 3, 4, 5, 12]);
  expect(parseQuestionNumbers("3 - 5").numbers).toEqual([3, 4, 5]);
  expect(parseQuestionNumbers("3,3,1").numbers).toEqual([1, 3]);
});

test("empty is valid", () => {
  expect(parseQuestionNumbers("  ")).toEqual({ numbers: [], error: null });
});

test("rejects bad input with a message", () => {
  for (const bad of ["5-2", "0", "0-3", "-4", "abc", "1,x", "5001", "1-3000", "1.5"]) {
    const r = parseQuestionNumbers(bad);
    expect(r.error, bad).toBeTruthy();
    expect(r.numbers).toEqual([]);
  }
});

test("accepts the upper bounds", () => {
  expect(parseQuestionNumbers("5000").numbers).toEqual([5000]);
  expect(parseQuestionNumbers("1-2000").numbers).toHaveLength(2000);
  expect(parseQuestionNumbers("1-2000, 2001").error).toBeTruthy();
});

test("formats runs", () => {
  expect(formatQuestionNumbers([2, 3, 4, 7])).toBe("2-4, 7");
  expect(formatQuestionNumbers([5, 1, 2])).toBe("1-2, 5");
  expect(formatQuestionNumbers([])).toBe("");
});
