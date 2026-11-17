import { expect, test } from "vitest";
import { canState, itemsError, patchItem, setStep } from "./starting-point";

test("stating a step adds it, with a middling confidence for reads", () => {
  expect(setStep([], "r1", 1, true)).toEqual([{ readingId: "r1", step: 1, confidence: 3 }]);
  expect(setStep([], "r1", 2, true)).toEqual([{ readingId: "r1", step: 2 }]);
});

test("step 3 needs step 1 and step 4 needs step 2, so they cannot be added alone", () => {
  expect(canState([], "r1", 3)).toBe(false);
  expect(canState([{ readingId: "r1", step: 1 }], "r1", 3)).toBe(true);
  expect(canState([{ readingId: "r1", step: 1 }], "r1", 4)).toBe(false);
  expect(setStep([], "r1", 3, true)).toEqual([]);
});

test("clearing a first step clears the step that depends on it", () => {
  const items = [
    { readingId: "r1", step: 1 as const },
    { readingId: "r1", step: 3 as const },
    { readingId: "r2", step: 1 as const },
  ];
  expect(setStep(items, "r1", 1, false)).toEqual([{ readingId: "r2", step: 1 }]);
});

test("a field edit changes only its own item", () => {
  const items = [{ readingId: "r1", step: 2 as const, answered: 20 }, { readingId: "r1", step: 1 as const }];
  expect(patchItem(items, "r1", 2, { correct: 15 })).toEqual([
    { readingId: "r1", step: 2, answered: 20, correct: 15 },
    { readingId: "r1", step: 1 },
  ]);
});

test("correct above answered is the one thing the list can get wrong", () => {
  expect(itemsError([{ readingId: "r1", step: 2, answered: 20, correct: 25 }])).toBe(
    "Correct answers cannot exceed questions answered.",
  );
  expect(itemsError([{ readingId: "r1", step: 2, answered: 20, correct: 20 }])).toBeNull();
  expect(itemsError([{ readingId: "r1", step: 2, correct: 5 }])).toBe("Enter questions answered before correct.");
  expect(itemsError([])).toBeNull();
});
