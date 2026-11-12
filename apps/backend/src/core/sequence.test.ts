import { expect, test } from "vitest";
import { orderModules } from "./ordering";
import type { SequencableGroup } from "./sequence";
import { sequenceUnits } from "./sequence";

function g(
  ref: string,
  topicOrder: number,
  moduleOrder: number,
  p: Partial<SequencableGroup> = {},
): SequencableGroup {
  return {
    ref,
    readingRefs: [ref],
    prereqRefs: [],
    phaseBand: 1,
    moduleOrder,
    priorityRank: 0,
    weight: 10,
    estimatedMinutes: 100,
    weightImpliedMinutes: 100,
    topicOrder,
    ...p,
  };
}

// Ethics sits at curriculum position 9, Quant at 1. The input array is
// deliberately interleaved and out of order: a correct implementation must
// not be able to pass by preserving input order.
function fixtureEthicsAndQm(): SequencableGroup[] {
  return [
    g("ethics/lm2", 9, 2),
    g("qm/lm1", 1, 1),
    g("ethics/lm1", 9, 1),
    g("qm/lm3", 1, 3),
    g("qm/lm2", 1, 2),
  ];
}

function fixtureMixedTopics(): SequencableGroup[] {
  return [
    g("fsa/lm1", 3, 1, { phaseBand: 2, weight: 15, priorityRank: 4 }),
    g("qm/lm1", 1, 1, { phaseBand: 1, weight: 8, priorityRank: 2 }),
    g("eco/lm1", 2, 1, { phaseBand: 1, weight: 7, priorityRank: 1 }),
    g("fsa/lm2", 3, 2, { phaseBand: 2, weight: 15, priorityRank: 3 }),
  ];
}

// equity/lm1 sits at curriculum position 4 but is a prerequisite of qm/lm3,
// which sits at position 1.
function fixturePrereqAcrossAreas(): SequencableGroup[] {
  return [
    g("qm/lm1", 1, 1),
    g("qm/lm2", 1, 2),
    g("qm/lm3", 1, 3, { prereqRefs: ["equity/lm1"] }),
    g("equity/lm1", 4, 1),
  ];
}

function fixtureCycle(): SequencableGroup[] {
  return [
    g("a/lm1", 1, 1, { prereqRefs: ["b/lm1"] }),
    g("b/lm1", 2, 1, { prereqRefs: ["a/lm1"] }),
  ];
}

test("effort-return delegates to today's engine unchanged", () => {
  const groups = fixtureMixedTopics();
  expect(sequenceUnits(groups, "effort-return").map((x) => x.ref)).toEqual(
    orderModules(groups, "curriculum").map((x) => x.ref),
  );
});

test("curriculum-strict runs whole topic areas in curriculum order", () => {
  const refs = sequenceUnits(fixtureEthicsAndQm(), "curriculum-strict").map((x) => x.ref);
  expect(refs).toEqual(["qm/lm1", "qm/lm2", "qm/lm3", "ethics/lm1", "ethics/lm2"]);
});

test("curriculum-topic produces the identical first-pass sequence to curriculum-strict", () => {
  const groups = fixtureEthicsAndQm();
  expect(sequenceUnits(groups, "curriculum-topic").map((x) => x.ref)).toEqual(
    sequenceUnits(groups, "curriculum-strict").map((x) => x.ref),
  );
});

test("a prerequisite outranks the stated curriculum order", () => {
  const refs = sequenceUnits(fixturePrereqAcrossAreas(), "curriculum-strict").map(
    (x) => x.ref,
  );
  expect(refs.indexOf("equity/lm1")).toBeLessThan(refs.indexOf("qm/lm3"));
});

test("exam weight never reorders anything in either curriculum mode", () => {
  const light = fixtureEthicsAndQm();
  const heavy = light.map((x) =>
    x.ref.startsWith("ethics") ? { ...x, weight: 40 } : x,
  );
  expect(sequenceUnits(heavy, "curriculum-topic").map((x) => x.ref)).toEqual(
    sequenceUnits(light, "curriculum-topic").map((x) => x.ref),
  );
});

test("phase band never reorders anything in either curriculum mode", () => {
  const flat = fixtureEthicsAndQm();
  const banded = flat.map((x) =>
    x.ref.startsWith("qm") ? { ...x, phaseBand: 7 } : x,
  );
  expect(sequenceUnits(banded, "curriculum-strict").map((x) => x.ref)).toEqual(
    sequenceUnits(flat, "curriculum-strict").map((x) => x.ref),
  );
});

test("a topic area is never left and returned to", () => {
  const refs = sequenceUnits(fixtureEthicsAndQm(), "curriculum-topic").map((x) =>
    x.ref.split("/")[0],
  );
  const firstIndex = new Map<string, number>();
  const lastIndex = new Map<string, number>();
  refs.forEach((area, i) => {
    if (!firstIndex.has(area)) firstIndex.set(area, i);
    lastIndex.set(area, i);
  });
  for (const [area, first] of firstIndex) {
    const last = lastIndex.get(area)!;
    const span = refs.slice(first, last + 1);
    expect(span.every((a) => a === area)).toBe(true);
  }
});

test("every input unit appears exactly once in the output", () => {
  const groups = fixtureEthicsAndQm();
  const refs = sequenceUnits(groups, "curriculum-topic").map((x) => x.ref);
  expect(refs.slice().sort()).toEqual(groups.map((x) => x.ref).sort());
});

test("an empty input yields an empty sequence", () => {
  expect(sequenceUnits([], "curriculum-topic")).toEqual([]);
});

test("a prerequisite cycle still throws", () => {
  expect(() => sequenceUnits(fixtureCycle(), "curriculum-strict")).toThrow(/cycle/i);
});
