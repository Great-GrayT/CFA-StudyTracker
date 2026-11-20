import { test, expect } from "vitest";
import { examPhase, studyNextRows, minutesShort, kindLabel, daysLeft, sortCells, postponedLabel, zoneSuffix, paceHint } from "./today";
import type { Progress, StudyNextItem } from "./types";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

const studyNext: StudyNextItem[] = [
  { losId: "a", status: "flagged", lastRatedAt: daysAgo(40), order: 3 },
  { losId: "b", status: "flagged", lastRatedAt: daysAgo(5), order: 1 },
  { losId: "c", status: "flagged", order: 7 },
  { losId: "d", status: "not-started", order: 0 },
  { losId: "e", status: "not-started", order: 2 },
  { losId: "f", status: "not-started", order: 4 },
];

const progressFixture = { studyNext } as Progress;

test("exam phase", () => {
  expect(examPhase("2027-05-20", "2027-05-19")).toBe("before");
  expect(examPhase("2027-05-20", "2027-05-20")).toBe("exam-day");
  expect(examPhase("2027-05-20", "2027-05-21")).toBe("after");
});

test("exam phase reads a full instant as its calendar day", () => {
  expect(examPhase("2027-05-20T00:00:00.000Z", "2027-05-20")).toBe("exam-day");
});

test("study next keeps backend order and caps at five", () => {
  const rows = studyNextRows(progressFixture);
  expect(rows).toHaveLength(5);
  expect(rows[0].losId).toBe(progressFixture.studyNext[0].losId);
});

test("study next derives each reason from status and last rating, as the old list did", () => {
  const rows = studyNextRows(progressFixture, 5, NOW);
  expect(rows.map((r) => r.reason)).toEqual(["stale", "weak", "flagged", "untouched", "untouched"]);
  expect(rows.map((r) => r.label)).toEqual([
    "Stale, rated 40d ago",
    "Weak, rated 5d ago",
    "Flagged",
    "Not started",
    "Not started",
  ]);
});

test("study next honours a smaller limit and an empty list", () => {
  expect(studyNextRows(progressFixture, 2)).toHaveLength(2);
  expect(studyNextRows({ studyNext: [] } as unknown as Progress)).toEqual([]);
});

test("minutes read the way the header sketches them", () => {
  expect(minutesShort(0)).toBe("0m");
  expect(minutesShort(40)).toBe("40m");
  expect(minutesShort(120)).toBe("2h");
  expect(minutesShort(130)).toBe("2h 10m");
});

test("task kinds read as words, unknown kinds pass through", () => {
  expect(kindLabel("content-notes")).toBe("Reading");
  expect(kindLabel("eocq")).toBe("Questions");
  expect(kindLabel("mock-review")).toBe("Mock review");
  expect(kindLabel("something-new")).toBe("Something new");
});

test("days left counts calendar days and never goes negative", () => {
  expect(daysLeft("2027-05-20", "2027-05-19")).toBe(1);
  expect(daysLeft("2027-05-20T00:00:00.000Z", "2026-11-15")).toBe(186);
  expect(daysLeft("2027-05-20", "2027-05-25")).toBe(0);
});

test("off-plan cells sit after planned ones, order kept otherwise", () => {
  const cells = [
    { id: "x", offPlan: true },
    { id: "a", offPlan: false },
    { id: "y", offPlan: true },
    { id: "b", offPlan: false },
  ];
  expect(sortCells(cells).map((c) => c.id)).toEqual(["a", "b", "x", "y"]);
});

test("a postponed cell names the day its work was first planned for", () => {
  expect(postponedLabel("2026-11-10")).toBe("Postponed from Tue 10 Nov");
});

test("the debrief time names the plan's zone only when the device is elsewhere", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  expect(zoneSuffix("Europe/London", "Europe/London", now)).toBe("");
  expect(zoneSuffix("America/New_York", "Europe/London", now)).toBe(" EST");
  expect(zoneSuffix("UTC", "Asia/Tokyo", now)).toBe(" UTC");
});

test("paceHint names the speed-up per kind and stays quiet at normal pace", () => {
  expect(paceHint("content-video", 1.5)!.short).toBe("Watch at 1.5x");
  expect(paceHint("review", 1.5)!.short).toBe("Read at 1.5x");
  expect(paceHint("questions", 1.3)!.short).toBe("2.3 min a question");
  expect(paceHint("answer-review", 1.3)!.long).toMatch(/^Review the worked answers faster/);
  expect(paceHint("questions", 1)).toBeNull();
  expect(paceHint("questions", null)).toBeNull();
});
