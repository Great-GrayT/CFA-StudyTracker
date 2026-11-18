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

import { applyDateToAll, dateError, defaultDeclaredDate, todayIn } from "./starting-point";

test("a new step carries the date it was stated with", () => {
  expect(setStep([], "r1", 1, true, "2026-09-01")).toEqual([
    { readingId: "r1", step: 1, confidence: 3, date: "2026-09-01" },
  ]);
});

test("default date is the first study day, never after today", () => {
  expect(defaultDeclaredDate("2026-09-01T00:00:00.000Z", "2026-11-18")).toBe("2026-09-01");
  expect(defaultDeclaredDate("2027-01-05", "2026-11-18")).toBe("2026-11-18");
  expect(defaultDeclaredDate(undefined, "2026-11-18")).toBe("2026-11-18");
});

test("today is read in the plan's zone", () => {
  const t = new Date("2026-11-18T23:30:00Z");
  expect(todayIn("Asia/Tokyo", t)).toBe("2026-11-19");
  expect(todayIn("America/New_York", t)).toBe("2026-11-18");
  expect(todayIn("Not/AZone", t)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("apply to all stamps every item", () => {
  const out = applyDateToAll([{ readingId: "a", step: 1 }, { readingId: "b", step: 2 }], "2026-10-02");
  expect(out.every((i) => i.date === "2026-10-02")).toBe(true);
});

test("date rules mirror the server", () => {
  const today = "2026-11-18";
  expect(dateError([{ readingId: "r1", step: 1, date: "2026-11-19" }], [], today)).toMatch(/after today/);
  const first = { readingId: "r1", step: 1 as const, date: "2026-10-10" };
  expect(dateError([{ readingId: "r1", step: 3, date: "2026-10-09" }], [first], today)).toMatch(/Review reading/);
  expect(dateError([{ readingId: "r1", step: 3, date: "2026-10-10" }], [first], today)).toBeNull();
  const q = { readingId: "r1", step: 2 as const, date: "2026-10-10" };
  expect(dateError([{ readingId: "r1", step: 4, date: "2026-10-01" }], [q], today)).toMatch(/Review questions/);
});
