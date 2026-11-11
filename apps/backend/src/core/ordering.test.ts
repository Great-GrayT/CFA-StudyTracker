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
// Sort keys deliberately inverted: lm5 would sort first (lower moduleOrder),
// but prerequisite requires lm1 first. Tests that prerequisite check is enforced.
const GROUPS_WITH_PREREQS: SchedulableGroup[] = [
  group({
    ref: "qm/lm1",
    readingRefs: ["qm/lm1"],
    phaseBand: 1,
    moduleOrder: 2,
    priorityRank: 30,
    weight: 10,
    estimatedMinutes: 240,
    weightImpliedMinutes: 240,
  }),
  group({
    ref: "qm/lm5",
    readingRefs: ["qm/lm5"],
    prereqRefs: ["qm/lm1"],
    phaseBand: 1,
    moduleOrder: 1,
    priorityRank: 50,
    weight: 8,
    estimatedMinutes: 200,
    weightImpliedMinutes: 200,
  }),
];

// Groups with prerequisite that must be respected by both strategies.
// Curriculum and weight strategies should differ in ordering because:
// - fsa/lm1 (band 1, weight 8) vs fsa/lm2 (band 2, weight 15): different band and weight
// Under curriculum: band 1 comes before band 2, so fsa/lm1 before fsa/lm2
// Under weight: higher weight comes first, so fsa/lm2 before fsa/lm1
// But both must respect: qm/lm1 (regression) -> qm/lm5 (time series)
const GROUPS: SchedulableGroup[] = [
  group({
    ref: "fsa/lm1",
    readingRefs: ["fsa/lm1"],
    phaseBand: 1,
    moduleOrder: 1,
    priorityRank: 30,
    weight: 8,
    estimatedMinutes: 180,
    weightImpliedMinutes: 180,
    confidence: 3,
  }),
  group({
    ref: "fsa/lm2",
    readingRefs: ["fsa/lm2"],
    phaseBand: 2,
    moduleOrder: 1,
    priorityRank: 20,
    weight: 15,
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
    weight: 10,
    estimatedMinutes: 200,
    weightImpliedMinutes: 200,
    confidence: 3,
  }),
  group({
    ref: "qm/lm5",
    readingRefs: ["qm/lm5"],
    prereqRefs: ["qm/lm1"],
    phaseBand: 1,
    moduleOrder: 5,
    priorityRank: 35,
    weight: 8,
    estimatedMinutes: 180,
    weightImpliedMinutes: 180,
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
  // Create a minimal fixture where band and weight rankings conflict.
  // fsa/lm1: band 1 (lower), weight 8 (lower)
  // fsa/lm2: band 2 (higher), weight 15 (higher)
  // Under curriculum, band leads: fsa/lm1 should come first (band 1 < band 2).
  // Under weight, weight leads: fsa/lm2 should come first (weight 15 > weight 8).
  const strategyConflict: SchedulableGroup[] = [
    group({
      ref: "fsa/lm1",
      phaseBand: 1,
      moduleOrder: 1,
      priorityRank: 20,
      weight: 8,
    }),
    group({
      ref: "fsa/lm2",
      phaseBand: 2,
      moduleOrder: 2,
      priorityRank: 20,
      weight: 15,
    }),
    group({
      ref: "qm/lm1",
      phaseBand: 1,
      moduleOrder: 2,
      priorityRank: 10,
      weight: 5,
    }),
    group({
      ref: "qm/lm5",
      prereqRefs: ["qm/lm1"],
      phaseBand: 1,
      moduleOrder: 1,
      priorityRank: 20,
      weight: 5,
    }),
  ];

  const byCurriculum = orderModules(strategyConflict, "curriculum");
  const byWeight = orderModules(strategyConflict, "weight");
  const curriculumRefs = byCurriculum.map((g) => g.ref);
  const weightRefs = byWeight.map((g) => g.ref);
  expect(curriculumRefs).not.toEqual(weightRefs);

  // Both still respect the qm/lm1 -> qm/lm5 prerequisite.
  expect(indexOf(byCurriculum, "qm/lm1")).toBeLessThan(indexOf(byCurriculum, "qm/lm5"));
  expect(indexOf(byWeight, "qm/lm1")).toBeLessThan(indexOf(byWeight, "qm/lm5"));
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

test("fan-out: one prerequisite precedes multiple dependants", () => {
  // Regression (qm/lm1) must come before both time series (qm/lm2) and machine learning (qm/lm3).
  // Sort keys deliberately inverted: lm2 and lm3 would sort before lm1 (lower moduleOrder),
  // but prerequisite requires lm1 first. Tests that prerequisite check is enforced.
  const fanOut: SchedulableGroup[] = [
    group({
      ref: "qm/lm1",
      readingRefs: ["qm/lm1"],
      phaseBand: 1,
      moduleOrder: 3,
      priorityRank: 30,
    }),
    group({
      ref: "qm/lm2",
      readingRefs: ["qm/lm2"],
      prereqRefs: ["qm/lm1"],
      phaseBand: 1,
      moduleOrder: 1,
      priorityRank: 50,
    }),
    group({
      ref: "qm/lm3",
      readingRefs: ["qm/lm3"],
      prereqRefs: ["qm/lm1"],
      phaseBand: 1,
      moduleOrder: 2,
      priorityRank: 40,
    }),
  ];
  const out = orderModules(fanOut, "curriculum");
  expect(indexOf(out, "qm/lm1")).toBeLessThan(indexOf(out, "qm/lm2"));
  expect(indexOf(out, "qm/lm1")).toBeLessThan(indexOf(out, "qm/lm3"));
});

test("chain: three-deep prerequisite sequence is preserved", () => {
  // Term structure (fp/lm1) -> arbitrage-free valuation (fp/lm2) -> bonds with embedded options (fp/lm3).
  // Sort keys deliberately inverted: lm3 would sort first (moduleOrder 1), then lm2 (moduleOrder 2),
  // then lm1 (moduleOrder 3), the exact reverse of the required prerequisite order.
  // Tests that prerequisites are actually enforced, not just working by coincidence.
  const chain: SchedulableGroup[] = [
    group({
      ref: "fp/lm1",
      readingRefs: ["fp/lm1"],
      phaseBand: 2,
      moduleOrder: 3,
      priorityRank: 30,
    }),
    group({
      ref: "fp/lm2",
      readingRefs: ["fp/lm2"],
      prereqRefs: ["fp/lm1"],
      phaseBand: 2,
      moduleOrder: 2,
      priorityRank: 40,
    }),
    group({
      ref: "fp/lm3",
      readingRefs: ["fp/lm3"],
      prereqRefs: ["fp/lm2"],
      phaseBand: 2,
      moduleOrder: 1,
      priorityRank: 50,
    }),
  ];
  const out = orderModules(chain, "curriculum");
  expect(indexOf(out, "fp/lm1")).toBeLessThan(indexOf(out, "fp/lm2"));
  expect(indexOf(out, "fp/lm2")).toBeLessThan(indexOf(out, "fp/lm3"));
});

test("many-to-one: five prerequisites precede one dependant", () => {
  // Five FSA modules (fsa/lm1-5) must all come before FSA Integration (fsa/integration).
  // Sort keys deliberately inverted: integration has moduleOrder 0 (lowest, would sort first)
  // and highest priorityRank, but prerequisites require all five modules first.
  // Tests that prerequisites block scheduling of high-ranked dependant.
  const manyToOne: SchedulableGroup[] = [
    group({
      ref: "fsa/lm1",
      readingRefs: ["fsa/lm1"],
      phaseBand: 1,
      moduleOrder: 5,
      priorityRank: 20,
    }),
    group({
      ref: "fsa/lm2",
      readingRefs: ["fsa/lm2"],
      phaseBand: 1,
      moduleOrder: 4,
      priorityRank: 20,
    }),
    group({
      ref: "fsa/lm3",
      readingRefs: ["fsa/lm3"],
      phaseBand: 1,
      moduleOrder: 3,
      priorityRank: 20,
    }),
    group({
      ref: "fsa/lm4",
      readingRefs: ["fsa/lm4"],
      phaseBand: 1,
      moduleOrder: 2,
      priorityRank: 20,
    }),
    group({
      ref: "fsa/lm5",
      readingRefs: ["fsa/lm5"],
      phaseBand: 1,
      moduleOrder: 1,
      priorityRank: 20,
    }),
    group({
      ref: "fsa/integration",
      readingRefs: ["fsa/integration"],
      prereqRefs: ["fsa/lm1", "fsa/lm2", "fsa/lm3", "fsa/lm4", "fsa/lm5"],
      phaseBand: 1,
      moduleOrder: 0,
      priorityRank: 50,
    }),
  ];
  const out = orderModules(manyToOne, "curriculum");
  expect(indexOf(out, "fsa/lm1")).toBeLessThan(indexOf(out, "fsa/integration"));
  expect(indexOf(out, "fsa/lm2")).toBeLessThan(indexOf(out, "fsa/integration"));
  expect(indexOf(out, "fsa/lm3")).toBeLessThan(indexOf(out, "fsa/integration"));
  expect(indexOf(out, "fsa/lm4")).toBeLessThan(indexOf(out, "fsa/integration"));
  expect(indexOf(out, "fsa/lm5")).toBeLessThan(indexOf(out, "fsa/integration"));
});

test("prerequisite blocks high-ranked dependant until satisfied", () => {
  // A prerequisite is necessary to prevent the dependant from being scheduled first.
  // dependant would win on weight (20 > 5) if not for the prerequisite.
  const forced: SchedulableGroup[] = [
    group({
      ref: "qm/prereq",
      readingRefs: ["qm/prereq"],
      phaseBand: 2,
      moduleOrder: 0,
      priorityRank: 10,
      weight: 5,
    }),
    group({
      ref: "qm/dependent",
      readingRefs: ["qm/dependent"],
      prereqRefs: ["qm/prereq"],
      phaseBand: 1,
      moduleOrder: 0,
      priorityRank: 50,
      weight: 20, // High weight would rank it first under weight strategy
    }),
  ];
  const out = orderModules(forced, "weight");
  // Even under weight strategy, prerequisite must come first.
  expect(indexOf(out, "qm/prereq")).toBeLessThan(indexOf(out, "qm/dependent"));
});

test("a prerequisite cycle is reported, not hung or silently dropped", () => {
  expect(() => orderModules(GROUPS_WITH_CYCLE, "curriculum")).toThrow(/cycle/i);
});
