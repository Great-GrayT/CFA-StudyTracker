import { describe, expect, test } from "vitest";
import { debriefTime, msUntilDayEnd } from "./day-end";

describe("msUntilDayEnd", () => {
  test("counts to the debrief in the plan's zone, not the browser's", () => {
    // 20:00 UTC is 21:00 in Paris in winter: 90 minutes to a 22:30 debrief.
    const now = Date.parse("2027-01-04T20:00:00Z");
    expect(msUntilDayEnd(now, "Europe/Paris", "22:30")).toBe(90 * 60 * 1000);
  });

  // London springs forward at 01:00 UTC on 28 March 2027. At 00:30 GMT the
  // 22:30 BST debrief is 21:30 UTC, 21 hours away, not the 22 a wall-clock
  // subtraction gives.
  test("is exact across a clock change", () => {
    const now = Date.parse("2027-03-28T00:30:00Z");
    expect(msUntilDayEnd(now, "Europe/London", "22:30")).toBe(21 * 60 * 60 * 1000);
  });

  test("is negative once the debrief has passed", () => {
    const now = Date.parse("2027-01-04T23:00:00Z");
    expect(msUntilDayEnd(now, "UTC", "22:30")).toBeLessThan(0);
  });
});

test("debriefTime falls back to 22:30", () => {
  expect(debriefTime(null)).toBe("22:30");
  expect(debriefTime({ prescription: "06:00", nudge: "19:00", debrief: "21:15" })).toBe("21:15");
});
