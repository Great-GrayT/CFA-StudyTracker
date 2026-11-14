import { describe, expect, test } from "vitest";
import { debriefTime, fetchRange, missedTasks, missedWindow, msUntilDayEnd } from "./day-end";
import type { PrescribedDay, PrescribedTask } from "./types";

function task(id: string, status: string, order = 0): PrescribedTask {
  return {
    id,
    order,
    kind: "reading",
    status,
    estimatedMinutes: 30,
    actualMinutes: null,
    confidence: null,
    readingIds: [],
    topicName: null,
    moduleTitle: null,
    materials: [],
  };
}

function day(date: string, tasks: PrescribedTask[]): PrescribedDay {
  return { date, totalMinutes: 0, tasks } as unknown as PrescribedDay;
}

describe("fetchRange", () => {
  test("covers the missed window and the week in one request", () => {
    expect(fetchRange("2027-01-08", "2027-01-03", "2027-01-09")).toEqual({
      from: "2027-01-01",
      to: "2027-01-09",
    });
  });
});

describe("missedWindow", () => {
  test("is the seven days before today while the day is open", () => {
    expect(missedWindow("2027-01-08", false)).toEqual({ from: "2027-01-01", to: "2027-01-07" });
  });

  test("takes in today once the day has closed", () => {
    expect(missedWindow("2027-01-08", true)).toEqual({ from: "2027-01-01", to: "2027-01-08" });
  });
});

describe("missedTasks", () => {
  const days = [
    day("2027-01-06", [task("a", "pending", 0), task("b", "done", 1), task("c", "pending", 2)]),
    day("2027-01-07", [task("d", "partial"), task("e", "pending")]),
    day("2027-01-05", []),
    day("2027-01-08", [task("today", "pending")]),
  ];

  test("keeps only what was not started, newest day first, in task order", () => {
    expect(missedTasks(days, "2027-01-08", false).map((m) => m.task.id)).toEqual(["e", "a", "c"]);
  });

  test("today counts only once the day has closed", () => {
    expect(missedTasks(days, "2027-01-08", true).map((m) => m.task.id)[0]).toBe("today");
  });
});

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
