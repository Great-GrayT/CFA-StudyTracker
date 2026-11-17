import { expect, test } from "vitest";
import { DEFAULT_PRIORITY, hoursError, movePackage, priorityEqual, withDefaults } from "./priority";

test("defaults match the spec's package order per step", () => {
  expect(DEFAULT_PRIORITY["1"]).toEqual(["mm-l2", "kaplan-l2", "cfa-les"]);
  expect(DEFAULT_PRIORITY["2"]).toEqual(["uw-l2-2025", "kaplan-l2", "premium-l2", "cfa-les"]);
  expect(DEFAULT_PRIORITY["5"]).toEqual(["premium-l2", "cfa-les", "kaplan-l2"]);
});

test("moving a package swaps it with its neighbour and stops at the ends", () => {
  expect(movePackage(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
  expect(movePackage(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  expect(movePackage(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  expect(movePackage(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
});

test("a saved priority that is empty or partial falls back step by step", () => {
  expect(withDefaults(null)).toEqual(DEFAULT_PRIORITY);
  const got = withDefaults({ "1": ["kaplan-l2", "mm-l2"] });
  expect(got["1"]).toEqual(["kaplan-l2", "mm-l2"]);
  expect(got["2"]).toEqual(DEFAULT_PRIORITY["2"]);
});

test("equality ignores nothing: order matters", () => {
  expect(priorityEqual(DEFAULT_PRIORITY, withDefaults(null))).toBe(true);
  expect(priorityEqual(DEFAULT_PRIORITY, { ...DEFAULT_PRIORITY, "1": ["kaplan-l2", "mm-l2", "cfa-les"] })).toBe(false);
});

test("LES reading hours run 50 to 400, whole hours", () => {
  expect(hoursError("120")).toBeNull();
  expect(hoursError("50")).toBeNull();
  expect(hoursError("400")).toBeNull();
  expect(hoursError("49")).toBe("Enter whole hours from 50 to 400.");
  expect(hoursError("401")).toBe("Enter whole hours from 50 to 400.");
  expect(hoursError("")).toBe("Enter whole hours from 50 to 400.");
  expect(hoursError("90.5")).toBe("Enter whole hours from 50 to 400.");
});
