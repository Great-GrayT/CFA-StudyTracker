import { expect, test } from "vitest";
import { fitNotes, fitState } from "./fit";

const base = { crash: 1, cancelledHolidayIds: [] as string[], feasible: true, belowPass: false, trims: [] };
const holidays = [
  { id: "h1", start: "2026-12-24", end: "2027-01-01", cancelled: true },
  { id: "h2", start: "2027-02-01", end: "2027-02-03", cancelled: false },
];

test("a plan that fits shows nothing", () => {
  expect(fitState(base, false)).toBe("ok");
});

test("an infeasible plan asks for consent until it is given, then stays flagged", () => {
  const bad = { ...base, feasible: false, belowPass: true };
  expect(fitState(bad, false)).toBe("warn");
  expect(fitState(bad, true)).toBe("below-pass");
  // The server may report belowPass once trimmed; still flagged.
  expect(fitState({ ...base, belowPass: true }, true)).toBe("below-pass");
});

test("crash and cancelled holidays are named when present", () => {
  expect(fitNotes(base, holidays)).toEqual([]);
  expect(fitNotes({ ...base, crash: 1.3, cancelledHolidayIds: ["h1"] }, holidays)).toEqual([
    "Planned at 1.3x pace",
    "Cancelled holiday 24 Dec to 1 Jan",
  ]);
  expect(fitNotes({ ...base, cancelledHolidayIds: ["gone"] }, holidays)).toEqual([]);
});
