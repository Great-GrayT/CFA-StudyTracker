import { test, expect } from "vitest";
import type { SchedulableGroup, Strategy } from "./ordering";
import { orderModules } from "./ordering";

// Helper to find index of a group by ref, returning -1 if not found.
function indexOf(groups: SchedulableGroup[], ref: string): number {
  return groups.findIndex((g) => g.ref === ref);
}

// Helper to create a group fixture.
function group(opts: {
  ref: string;
  readingRefs?: string[];
  prereqRefs?: string[];
  phaseBand?: number;
  moduleOrder?: number;
  priorityRank?: number;
  weight?: number;
  estimatedMinutes?: number;
  weightImpliedMinutes?: number;
  confidence?: number;
}): SchedulableGroup {
  return {
    ref: opts.ref,
    readingRefs: opts.readingRefs ?? [opts.ref],
    prereqRefs: opts.prereqRefs ?? [],
    phaseBand: opts.phaseBand ?? 1,
    moduleOrder: opts.moduleOrder ?? 0,
    priorityRank: opts.priorityRank ?? 0,
    weight: opts.weight ?? 5,
    estimatedMinutes: opts.estimatedMinutes ?? 120,
    weightImpliedMinutes: opts.weightImpliedMinutes ?? 120,
    confidence: opts.confidence ?? 3,
  };
}

// Real prerequisite: regression before time series.
const GROUPS_WITH_PREREQS: SchedulableGroup[] = [
  group({
    ref: "qm/lm1",
    readingRefs: ["qm/lm1"],
    phaseBand: 1,
    moduleOrder: 1,
    priorityRank: 50,
    weight: 10,
    estimatedMinutes: 240,
    weightImpliedMinutes: 240,
  }),
  group({
    ref: "qm/lm5",
    readingRefs: ["qm/lm5"],
    prereqRefs: ["qm/lm1"],
    phaseBand: 1,
    moduleOrder: 5,
    priorityRank: 40,
    weight: 8,
    estimatedMinutes: 200,
    weightImpliedMinutes: 200,
  }),
];

// Basic groups with no prerequisites, different phase bands and weights.
const GROUPS: SchedulableGroup[] = [
  group({
    ref: "fsa/lm1",
    readingRefs: ["fsa/lm1"],
    phaseBand: 1,
    moduleOrder: 1,
    priorityRank: 30,
    weight: 12,
    estimatedMinutes: 180,
    weightImpliedMinutes: 180,
    confidence: 3,
  }),
  group({
    ref: "fsa/lm2",
    readingRefs: ["fsa/lm2"],
    phaseBand: 2,
    moduleOrder: 2,
    priorityRank: 20,
    weight: 10,
    estimatedMinutes: 150,
    weightImpliedMinutes: 150,
    confidence: 3,
  }),
  group({
    ref: "qm/lm1",
    readingRefs: ["qm/lm1"],
    phaseBand: 1,
    moduleOrder: 1,
    priorityRank: 40,
    weight: 8,
    estimatedMinutes: 200,
    weightImpliedMinutes: 200,
    confidence: 3,
  }),
];

// Ethics case: one group covering seven modules.
const GROUPS_WITH_ETHICS_FANOUT: SchedulableGroup[] = [
  group({
    ref: "et/lm2",
    readingRefs: [
      "et/lm2/guidance1",
      "et/lm2/guidance2",
      "et/lm2/guidance3",
      "et/lm2/guidance4",
      "et/lm2/guidance5",
      "et/lm2/guidance6",
      "et/lm2/guidance7",
    ],
    phaseBand: 1,
    moduleOrder: 2,
    priorityRank: 25,
    weight: 5,
    estimatedMinutes: 120,
    weightImpliedMinutes: 120,
  }),
  group({
    ref: "et/lm1",
    readingRefs: ["et/lm1"],
    phaseBand: 1,
    moduleOrder: 1,
    priorityRank: 30,
    weight: 7,
    estimatedMinutes: 150,
    weightImpliedMinutes: 150,
  }),
];

// Two groups with same weight, one uncovered (no material).
const CHEAP_UNCOVERED = group({
  ref: "fsa/lm6",
  readingRefs: ["fsa/lm6"],
  phaseBand: 2,
  moduleOrder: 6,
  priorityRank: 15,
  weight: 6,
  estimatedMinutes: 30, // Tiny because no question bank
  weightImpliedMinutes: 120, // But weight says it's worth 120 min
  confidence: 3,
});

const NORMAL_GROUP = group({
  ref: "fsa/lm1",
  readingRefs: ["fsa/lm1"],
  phaseBand: 2,
  moduleOrder: 1,
  priorityRank: 20,
  weight: 6,
  estimatedMinutes: 120,
  weightImpliedMinutes: 120,
  confidence: 3,
});

// Cycle: A -> B -> A.
const GROUPS_WITH_CYCLE: SchedulableGroup[] = [
  group({
    ref: "cycled/a",
    readingRefs: ["cycled/a"],
    prereqRefs: ["cycled/b"],
  }),
  group({
    ref: "cycled/b",
    readingRefs: ["cycled/b"],
    prereqRefs: ["cycled/a"],
  }),
];

test("a prerequisite always precedes its dependant", () => {
  const out = orderModules(GROUPS_WITH_PREREQS, "curriculum");
  expect(indexOf(out, "qm/lm1")).toBeLessThan(indexOf(out, "qm/lm5"));
});

test("the same input always gives the same order", () => {
  expect(orderModules(GROUPS, "curriculum")).toEqual(
    orderModules(GROUPS, "curriculum")
  );
});

test("strategy changes which term leads, not the prerequisite graph", () => {
  const byCurriculum = orderModules(GROUPS, "curriculum");
  const byWeight = orderModules(GROUPS, "weight");
  expect(byCurriculum).not.toEqual(byWeight);
  // Both still respect prerequisites.
  for (const out of [byCurriculum, byWeight]) {
    // No prerequisites in GROUPS, so just verify both returned all groups
    expect(out).toHaveLength(GROUPS.length);
  }
});

test("a fanned-out group is scheduled once, carrying every module it covers", () => {
  const out = orderModules(GROUPS_WITH_ETHICS_FANOUT, "curriculum");
  const guidance = out.filter((g) => g.ref === "et/lm2");
  expect(guidance).toHaveLength(1);
  expect(guidance[0].readingRefs).toHaveLength(7);
});

test("a module cannot rank high merely because it has no material", () => {
  const out = orderModules([CHEAP_UNCOVERED, NORMAL_GROUP], "weight");
  expect(indexOf(out, "fsa/lm6")).toBeGreaterThan(indexOf(out, "fsa/lm1"));
});

test("a prerequisite cycle is reported, not hung or silently dropped", () => {
  expect(() => orderModules(GROUPS_WITH_CYCLE, "curriculum")).toThrow(/cycle/i);
});
