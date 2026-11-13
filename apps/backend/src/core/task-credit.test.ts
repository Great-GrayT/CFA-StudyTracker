import { describe, expect, test } from "vitest";
import { creditedMinutes, countsForCalibration } from "./task-credit";

describe("creditedMinutes", () => {
  test("a finished task settles its whole estimate, however long it took", () => {
    expect(creditedMinutes({ status: "done", estimatedMinutes: 60, actualMinutes: 240 })).toBe(60);
    expect(creditedMinutes({ status: "done", estimatedMinutes: 60, actualMinutes: 20 })).toBe(60);
  });

  test("a partly done task settles only the minutes worked, capped at the estimate", () => {
    expect(creditedMinutes({ status: "partial", estimatedMinutes: 60, actualMinutes: 25 })).toBe(25);
    expect(creditedMinutes({ status: "partial", estimatedMinutes: 60, actualMinutes: 90 })).toBe(60);
  });

  test("a partial with no minutes settles nothing", () => {
    expect(creditedMinutes({ status: "partial", estimatedMinutes: 60, actualMinutes: null })).toBe(0);
  });

  test("pending and skipped tasks settle nothing", () => {
    expect(creditedMinutes({ status: "pending", estimatedMinutes: 60, actualMinutes: null })).toBe(0);
    expect(creditedMinutes({ status: "skipped", estimatedMinutes: 60, actualMinutes: null })).toBe(0);
  });
});

describe("countsForCalibration", () => {
  test("only finished tasks with measured minutes teach pace", () => {
    expect(countsForCalibration({ status: "done", estimatedMinutes: 60, actualMinutes: 70 })).toBe(true);
    expect(countsForCalibration({ status: "done", estimatedMinutes: 60, actualMinutes: null })).toBe(false);
    // A partial's minutes cover an unknown share of the material, so their
    // ratio to the whole estimate says nothing about pace.
    expect(countsForCalibration({ status: "partial", estimatedMinutes: 60, actualMinutes: 30 })).toBe(false);
  });
});
