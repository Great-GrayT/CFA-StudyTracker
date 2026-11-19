import { expect, test } from "vitest";
import { accuracyPct, fraction, hoursLabel, pctLabel, questionChips } from "./coverage-view";

test("fraction clamps and survives empty totals", () => {
  expect(fraction(3, 12)).toBe(0.25);
  expect(fraction(5, 0)).toBe(0);
  expect(fraction(15, 10)).toBe(1);
});

test("accuracy is null before any answer", () => {
  expect(accuracyPct(0, 0)).toBeNull();
  expect(accuracyPct(7, 9)).toBe(78);
  expect(pctLabel(null)).toBe("none yet");
});

test("hours label", () => {
  expect(hoursLabel(16200)).toBe("4.5 h");
  expect(hoursLabel(115200)).toBe("32 h");
});

test("chips mark answered numbers", () => {
  expect(questionChips(4, [2, 3])).toEqual([
    { n: 1, answered: false },
    { n: 2, answered: true },
    { n: 3, answered: true },
    { n: 4, answered: false },
  ]);
});
