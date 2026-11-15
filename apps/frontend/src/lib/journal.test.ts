import { describe, expect, test } from "vitest";
import { filterJournal, groupJournalByDay } from "./journal";
import type { LogEntry } from "./types";

const entry = (id: string, losId: string, date: string, packageId: string | null = null): LogEntry => ({
  id,
  planId: "p",
  losId,
  packageId,
  date,
  confidence: 3,
  questionsAnswered: 0,
  questionsCorrect: 0,
  note: null,
});

const losToTopic = new Map([
  ["l1", "t1"],
  ["l2", "t1"],
  ["l3", "t2"],
]);

const logsFixture: LogEntry[] = [
  entry("a", "l1", "2026-10-30", "pk1"),
  entry("b", "l3", "2026-11-02", "pk1"),
  entry("c", "l2", "2026-11-05", "pk2"),
  entry("d", "l1", "2026-11-03"),
  entry("e", "l1", "2026-11-09T00:00:00.000Z", "pk1"),
];

test("journal filters combine and keep newest first", () => {
  const out = filterJournal(logsFixture, { topicId: "t1", from: "2026-11-01" }, losToTopic);
  expect(out.every((l) => losToTopic.get(l.losId) === "t1" && l.date >= "2026-11-01")).toBe(true);
  expect(out.map((l) => l.date)).toEqual([...out.map((l) => l.date)].sort().reverse());
});

describe("filterJournal", () => {
  test("no filter keeps every entry, newest first", () => {
    expect(filterJournal(logsFixture, {}, losToTopic).map((l) => l.id)).toEqual(["e", "c", "d", "b", "a"]);
  });

  test("package and topic narrow together", () => {
    expect(filterJournal(logsFixture, { topicId: "t1", packageId: "pk1" }, losToTopic).map((l) => l.id)).toEqual([
      "e",
      "a",
    ]);
  });

  test("the date range includes both ends, whatever time a date carries", () => {
    expect(filterJournal(logsFixture, { from: "2026-11-03", to: "2026-11-09" }, losToTopic).map((l) => l.id)).toEqual([
      "e",
      "c",
      "d",
    ]);
  });

  test("an outcome missing from the curriculum never matches a topic", () => {
    const stray = entry("x", "gone", "2026-11-04");
    expect(filterJournal([stray], { topicId: "t1" }, losToTopic)).toEqual([]);
    expect(filterJournal([stray], {}, losToTopic)).toEqual([stray]);
  });

  test("does not reorder the input it was given", () => {
    const copy = [...logsFixture];
    filterJournal(logsFixture, {}, losToTopic);
    expect(logsFixture).toEqual(copy);
  });
});

describe("groupJournalByDay", () => {
  test("one group per calendar day, in the order given", () => {
    const sorted = filterJournal([...logsFixture, entry("f", "l2", "2026-11-05")], {}, losToTopic);
    const groups = groupJournalByDay(sorted);
    expect(groups.map((g) => [g.day, g.entries.length])).toEqual([
      ["2026-11-09", 1],
      ["2026-11-05", 2],
      ["2026-11-03", 1],
      ["2026-11-02", 1],
      ["2026-10-30", 1],
    ]);
  });
});
