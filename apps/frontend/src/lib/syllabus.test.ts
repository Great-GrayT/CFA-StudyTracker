import { test, expect } from "vitest";
import {
  syllabusTree,
  confidenceFill,
  cellLabel,
  outcomeStatus,
  flagReasons,
  questionSources,
  isMonoculture,
  topicRows,
  syllabusTotals,
  weightLine,
} from "./syllabus";
import type { Curriculum, LogEntry } from "./types";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const oneTopicTwoReadings: Curriculum = {
  levelId: "II",
  curriculumVersion: "2027",
  topics: [
    {
      id: "t1",
      name: "Equity valuation",
      order: 1,
      examWeightMin: 10,
      examWeightMax: 15,
      readings: [
        {
          id: "r1",
          name: "Free cash flow",
          order: 1,
          los: [
            { id: "l1", text: "a", order: 1 },
            { id: "l2", text: "b", order: 2 },
            { id: "l3", text: "c", order: 3 },
          ],
        },
        { id: "r2", name: "Residual income", order: 2, los: [{ id: "l4", text: "d", order: 1 }] },
      ],
    },
  ],
};

let seq = 0;
function log(losId: string, p: Partial<LogEntry> = {}): LogEntry {
  return {
    id: `x${seq++}`,
    planId: "p",
    losId,
    packageId: null,
    date: daysAgo(1),
    confidence: 3,
    questionsAnswered: 0,
    questionsCorrect: 0,
    note: null,
    ...p,
  };
}

test("topic area is midpoint weight; outcomes split it equally", () => {
  const [t] = syllabusTree(oneTopicTwoReadings, []);
  expect(t.value).toBe(12.5);
  expect(t.children![0].value).toBeCloseTo((12.5 * 3) / 4);
  expect(t.children![1].children![0].value).toBeCloseTo(12.5 / 4);
});

test("every node knows its topic's outcome count, so tooltips can name the share", () => {
  const [t] = syllabusTree(oneTopicTwoReadings, []);
  expect(t.metadata!.topicTotal).toBe(4);
  expect(t.children![0].metadata!.topicTotal).toBe(4);
  expect(t.children![1].children![0].metadata!.topicTotal).toBe(4);
});

test("untouched outcomes have null confidence", () => {
  const [t] = syllabusTree(oneTopicTwoReadings, []);
  expect(t.children![0].children![0].metadata!.confidence).toBeNull();
  expect(confidenceFill(null)).toBe("untouched");
});

test("labels hide in small cells and truncate long text", () => {
  expect(cellLabel("Equity valuation", 40)).toBeNull();
  const long = "x".repeat(300);
  expect(cellLabel(long, 140)!.length).toBeLessThanOrEqual(20);
  expect(cellLabel(long, 140)!.endsWith("…")).toBe(true);
  expect(cellLabel("Short", 140)).toBe("Short");
});

test("confidence fill maps the 1 to 5 scale onto the four step ramp", () => {
  expect(confidenceFill(1)).toBe("var(--conf-1)");
  expect(confidenceFill(2)).toBe("var(--conf-1)");
  expect(confidenceFill(3)).toBe("var(--conf-2)");
  expect(confidenceFill(4.4)).toBe("var(--conf-3)");
  expect(confidenceFill(5)).toBe("var(--conf-4)");
});

test("an outcome's confidence is its latest rating; parents average the touched ones", () => {
  const logs = [
    log("l1", { confidence: 2, date: daysAgo(5) }),
    log("l1", { confidence: 4, date: daysAgo(1) }),
    log("l2", { confidence: 2, questionsAnswered: 10, questionsCorrect: 7 }),
  ];
  const [t] = syllabusTree(oneTopicTwoReadings, logs);
  const r1 = t.children![0];
  expect(r1.children![0].metadata!.confidence).toBe(4);
  expect(r1.metadata!.confidence).toBe(3);
  expect(r1.metadata!.covered).toBe(2);
  expect(r1.metadata!.total).toBe(3);
  expect(r1.metadata!.accuracy).toBeCloseTo(70);
  expect(t.metadata!.kind).toBe("topic");
  expect(r1.metadata!.kind).toBe("reading");
  expect(r1.children![0].metadata!.kind).toBe("los");
  expect(t.children![1].metadata!.confidence).toBeNull();
  expect(t.children![1].metadata!.accuracy).toBeNull();
});

test("outcome status: untouched, flagged by rating, accuracy or age, then confident or logged", () => {
  expect(outcomeStatus([], NOW)).toBe("untouched");
  expect(outcomeStatus([log("a", { confidence: 2 })], NOW)).toBe("flagged");
  expect(outcomeStatus([log("a", { confidence: 4, questionsAnswered: 5, questionsCorrect: 2 })], NOW)).toBe("flagged");
  expect(outcomeStatus([log("a", { confidence: 4, date: daysAgo(31) })], NOW)).toBe("flagged");
  expect(outcomeStatus([log("a", { confidence: 4 })], NOW)).toBe("confident");
  expect(outcomeStatus([log("a", { confidence: 3 })], NOW)).toBe("logged");
});

test("flag reasons name each condition", () => {
  const mine = [log("a", { confidence: 1, date: daysAgo(40), questionsAnswered: 10, questionsCorrect: 4 })];
  expect(flagReasons(mine, NOW)).toEqual([
    "you rated it 1",
    "your accuracy is 40%",
    "it was last studied 40 days ago",
  ]);
  expect(flagReasons([log("a", { confidence: 4 })], NOW)).toEqual([]);
  expect(flagReasons([], NOW)).toEqual([]);
});

test("question sources and the monoculture nudge", () => {
  const names = new Map([["k", "Kaplan"]]);
  const mine = [
    log("a", { packageId: "k", questionsAnswered: 15, confidence: 3 }),
    log("a", { packageId: "k", questionsAnswered: 10, confidence: 3, date: daysAgo(0) }),
  ];
  const sources = questionSources(mine, names);
  expect(sources).toEqual([{ id: "k", name: "Kaplan", count: 25 }]);
  expect(isMonoculture(sources, 3)).toBe(true);
  expect(isMonoculture(sources, 4)).toBe(false);
  expect(isMonoculture([{ id: "k", name: "K", count: 19 }], 3)).toBe(false);
});

test("topic rows and totals: weighted coverage, accuracy, weakest reading", () => {
  const logs = [log("l4", { confidence: 1, questionsAnswered: 4, questionsCorrect: 1 }), log("l1", { confidence: 5 })];
  const [row] = topicRows(oneTopicTwoReadings, logs);
  expect(row.covered).toBe(2);
  expect(row.total).toBe(4);
  expect(row.accuracy).toBeCloseTo(25);
  expect(row.weakestReading?.id).toBe("r2");
  const totals = syllabusTotals(oneTopicTwoReadings, logs);
  expect(totals.coverage).toBeCloseTo(50);
  expect(totals.accuracy).toBeCloseTo(25);
  expect(totals.answered).toBe(4);
});

test("the weight line never prints the topic's range as a part's own weight", () => {
  const [t] = syllabusTree(oneTopicTwoReadings, []);
  expect(weightLine(t.metadata as never)).toBe("10 to 15% of the exam");
  expect(weightLine(t.children![0].metadata as never)).toBe(
    "3 of the topic's 4 outcomes. The topic is 10 to 15% of the exam, split equally.",
  );
  expect(weightLine(t.children![1].metadata as never)).toBe(
    "1 of the topic's 4 outcomes. The topic is 10 to 15% of the exam, split equally.",
  );
  expect(weightLine(t.children![1].children![0].metadata as never)).toBe(
    "One of 4 outcomes sharing the topic's 10 to 15% of the exam.",
  );
  const only = { ...(t.metadata as object), kind: "los", total: 1, topicTotal: 1 };
  expect(weightLine(only as never)).toBe("The topic's only outcome, so all of its 10 to 15% of the exam.");
});
