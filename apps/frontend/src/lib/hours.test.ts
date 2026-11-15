import { test, expect } from "vitest";
import { clampHours, MAX_HOURS } from "./hours";

test("keeps half hours", () => {
  expect(clampHours(2.5)).toBe(2.5);
});

test("rounds to the nearest half hour", () => {
  expect(clampHours(2.3)).toBe(2.5);
  expect(clampHours(2.2)).toBe(2);
});

test("clamps to the planner range", () => {
  expect(clampHours(-1)).toBe(0);
  expect(clampHours(MAX_HOURS + 3)).toBe(MAX_HOURS);
});

test("treats non-finite input as zero", () => {
  expect(clampHours(Number.NaN)).toBe(0);
  expect(clampHours(Number.POSITIVE_INFINITY)).toBe(0);
});
