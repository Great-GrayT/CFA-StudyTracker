import { expect, test } from "vitest";
import { heatLevel, isMissed, monthCells, monthOf, monthPlannedMin, shiftMonth } from "./calendar";

test("a month grid starts on Monday and pads with nulls", () => {
  // 1 Nov 2026 is a Sunday: six empty cells, then the 1st.
  const cells = monthCells("2026-11");
  expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
  expect(cells[6]).toBe("2026-11-01");
  expect(cells.filter(Boolean)).toHaveLength(30);
  expect(cells.length % 7).toBe(0);
  // 1 Dec 2026 is a Tuesday.
  expect(monthCells("2026-12")[1]).toBe("2026-12-01");
});

test("months shift across year ends", () => {
  expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  expect(monthOf("2026-11-17")).toBe("2026-11");
});

test("heat has four levels, relative to the busiest day", () => {
  expect(heatLevel(0, 240)).toBe(0);
  expect(heatLevel(60, 240)).toBe(1);
  expect(heatLevel(120, 240)).toBe(2);
  expect(heatLevel(240, 240)).toBe(3);
  expect(heatLevel(30, 0)).toBe(0);
});

test("a day is missed only when past, planned and short of its plan", () => {
  const d = (date: string, plannedMin: number, doneMin: number) => ({ date, plannedMin, doneMin });
  expect(isMissed(d("2026-11-10", 120, 30), "2026-11-17")).toBe(true);
  expect(isMissed(d("2026-11-10", 120, 120), "2026-11-17")).toBe(false);
  expect(isMissed(d("2026-11-10", 0, 0), "2026-11-17")).toBe(false);
  expect(isMissed(d("2026-11-17", 120, 0), "2026-11-17")).toBe(false);
  expect(isMissed(d("2026-11-20", 120, 0), "2026-11-17")).toBe(false);
});

test("a month total sums only its own days", () => {
  const days = [
    { date: "2026-11-30", plannedMin: 60, doneMin: 0 },
    { date: "2026-12-01", plannedMin: 90, doneMin: 0 },
    { date: "2026-12-02", plannedMin: 30, doneMin: 0 },
  ];
  expect(monthPlannedMin(days, "2026-12")).toBe(120);
});
