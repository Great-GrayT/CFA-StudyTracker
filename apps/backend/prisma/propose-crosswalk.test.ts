import { describe, it, expect } from "vitest";
import { proposeCrosswalk, checkCrosswalk } from "./propose-crosswalk.ts";
import type { LevelFile } from "./propose-crosswalk.ts";
import type { CrosswalkFile } from "./lib/catalogue-types.ts";
import type { PackageFile } from "./lib/catalogue-types.ts";

// Invented structure only: no real CFA reading or outcome wording. Mirrors
// the shape of the real curriculum (a fan-out topic, a near-miss title) so
// the tests exercise the same scenarios without the real text.
const LEVEL: LevelFile = {
  id: "T2",
  version: "test-1",
  topics: [
    {
      name: "Topic Alpha",
      order: 3,
      examWeightMin: 10,
      examWeightMax: 15,
      readings: [
        {
          name: "Alpha Reading One",
          order: 1,
          los: [
            { text: "combine the sample input with the reference total to produce the adjusted result", order: 1 },
            { text: "explain the role of an alternative input in the same example model", order: 2 },
          ],
        },
        { name: "Alpha Reading Two", order: 2, los: [] },
        { name: "Alpha Reading Three", order: 3, los: [] },
        { name: "Alpha Reading Four", order: 4, los: [] },
        { name: "Evaluating Example Quality Metrics", order: 5, los: [] },
        { name: "Alpha Reading Six", order: 6, los: [] },
      ],
    },
    {
      name: "Topic Beta",
      order: 10,
      examWeightMin: 10,
      examWeightMax: 15,
      readings: [
        { name: "Beta Reading One", order: 1, los: [] },
        { name: "Beta Reading Two", order: 2, los: [] },
        { name: "Beta Reading Three", order: 3, los: [] },
        { name: "Beta Reading Four", order: 4, los: [] },
        { name: "Beta Reading Five", order: 5, los: [] },
        { name: "Beta Reading Six", order: 6, los: [] },
        { name: "Beta Reading Seven", order: 7, los: [] },
        { name: "Beta Reading Eight", order: 8, los: [] },
        { name: "Beta Reading Nine", order: 9, los: [] },
      ],
    },
  ],
};

const GOOD: CrosswalkFile = {
  levelId: "T2",
  version: "test-1",
  packageSlug: "example-pkg",
  map: [
    { unitRef: "fsa/lm1", readings: [{ topicOrder: 3, readingOrder: 1, readingName: "Alpha Reading One" }] },
    { unitRef: "fsa/lm2", readings: [{ topicOrder: 3, readingOrder: 2, readingName: "Alpha Reading Two" }] },
    { unitRef: "fsa/lm3", readings: [{ topicOrder: 3, readingOrder: 3, readingName: "Alpha Reading Three" }] },
    { unitRef: "fsa/lm4", readings: [{ topicOrder: 3, readingOrder: 4, readingName: "Alpha Reading Four" }] },
    {
      unitRef: "fsa/lm5",
      readings: [{ topicOrder: 3, readingOrder: 5, readingName: "Evaluating Example Quality Metrics" }],
    },
    { unitRef: "fsa/lm6", readings: [{ topicOrder: 3, readingOrder: 6, readingName: "Alpha Reading Six" }] },
    { unitRef: "et/lm1", readings: [{ topicOrder: 10, readingOrder: 1, readingName: "Beta Reading One" }] },
    {
      unitRef: "et/lm2",
      readings: [
        { topicOrder: 10, readingOrder: 2, readingName: "Beta Reading Two" },
        { topicOrder: 10, readingOrder: 3, readingName: "Beta Reading Three" },
        { topicOrder: 10, readingOrder: 4, readingName: "Beta Reading Four" },
        { topicOrder: 10, readingOrder: 5, readingName: "Beta Reading Five" },
        { topicOrder: 10, readingOrder: 6, readingName: "Beta Reading Six" },
        { topicOrder: 10, readingOrder: 7, readingName: "Beta Reading Seven" },
        { topicOrder: 10, readingOrder: 8, readingName: "Beta Reading Eight" },
      ],
    },
    { unitRef: "et/lm3", readings: [{ topicOrder: 10, readingOrder: 9, readingName: "Beta Reading Nine" }] },
  ],
  uncovered: [],
};

const PKG_WITH_DRIFTED_TITLE: PackageFile = {
  package: { slug: "example-pkg", name: "Example Provider" },
  edition: { levelId: "T2", year: "2026" },
  units: [{ ref: "fsa/lm5", title: "Evaluation Example Quality Metrics", resources: [] }],
  editionResources: [],
};

describe("checkCrosswalk", () => {
  it("map and uncovered together account for every reading exactly once", () => {
    expect(checkCrosswalk(GOOD, LEVEL)).toEqual([]);

    const missingOneReading = structuredClone(GOOD);
    missingOneReading.map = missingOneReading.map.filter((m) => m.unitRef !== "et/lm3");
    expect(checkCrosswalk(missingOneReading, LEVEL).join(" ")).toMatch(/51|accounted/i);

    const readingClaimedTwice = structuredClone(GOOD);
    readingClaimedTwice.map.push({
      unitRef: "duplicate/unit",
      readings: [{ topicOrder: 3, readingOrder: 1, readingName: "Alpha Reading One" }],
    });
    expect(checkCrosswalk(readingClaimedTwice, LEVEL).join(" ")).toMatch(/twice|duplicate/i);
  });

  it("one unit may cover many readings", () => {
    const guidance = GOOD.map.find((m) => m.unitRef === "et/lm2")!;
    expect(guidance.readings).toHaveLength(7);
    expect(checkCrosswalk(GOOD, LEVEL)).toEqual([]);
  });

  // Review Focus 4
  it("a stored name that no longer matches the curriculum is rejected", () => {
    const renumbered = structuredClone(GOOD);
    renumbered.map[0].readings[0].readingName = "Some Other Reading";
    expect(checkCrosswalk(renumbered, LEVEL).join(" ")).toMatch(/name/i);
  });

  it("a losMap entry that is neither bound nor marked retired is rejected", () => {
    const withBadLos = structuredClone(GOOD);
    withBadLos.losMap = [{ unitRef: "fsa/lm1", sourceLabel: "an unreviewed outcome label" } as any];
    expect(checkCrosswalk(withBadLos, LEVEL).join(" ")).toMatch(/retired|bound/i);
  });

  it("a reviewed losMap with mixed bound and retired entries passes", () => {
    const withLos = structuredClone(GOOD);
    withLos.losMap = [
      {
        unitRef: "fsa/lm1",
        sourceLabel: "combine a sample input with the reference total to produce the adjusted results",
        topicOrder: 3,
        readingOrder: 1,
        losOrder: 1,
        losText: "combine the sample input with the reference total to produce the adjusted result",
      },
      {
        unitRef: "fsa/lm1",
        sourceLabel: "an outcome the current curriculum no longer tests",
        retired: true,
      },
    ];
    expect(checkCrosswalk(withLos, LEVEL)).toEqual([]);
  });

  it("a losMap entry whose stored outcome text no longer matches the level is rejected", () => {
    const drifted = structuredClone(GOOD);
    drifted.losMap = [
      {
        unitRef: "fsa/lm1",
        sourceLabel: "combine a sample input with the reference total to produce the adjusted results",
        topicOrder: 3,
        readingOrder: 1,
        losOrder: 1,
        losText: "a completely different outcome text",
      },
    ];
    expect(checkCrosswalk(drifted, LEVEL).join(" ")).toMatch(/text/i);
  });
});

describe("proposeCrosswalk", () => {
  it("the proposer reports a drifted title rather than guessing", () => {
    const { unmatched } = proposeCrosswalk(PKG_WITH_DRIFTED_TITLE, LEVEL);
    expect(unmatched).toContain("fsa/lm5");
  });

  it("fuzzy-matches a trivially drifted outcome label and binds it to the level's own text", () => {
    const pkg: PackageFile = {
      package: { slug: "example-pkg", name: "Example Provider" },
      edition: { levelId: "T2", year: "2026" },
      units: [
        {
          ref: "fsa/lm1",
          title: "Alpha Reading One",
          resources: [],
          losRefinements: [
            {
              sourceLabel: "combine a sample input with the reference total to produce the adjusted results",
              questionCount: 4,
            },
          ],
        },
      ],
      editionResources: [],
    };

    const { file, unmatched } = proposeCrosswalk(pkg, LEVEL);
    expect(unmatched).toEqual([]);
    const bound = file.losMap!.find((e) => e.unitRef === "fsa/lm1")! as any;
    expect(bound.topicOrder).toBe(3);
    expect(bound.readingOrder).toBe(1);
    expect(bound.losOrder).toBe(1);
    expect(bound.losText).toBe("combine the sample input with the reference total to produce the adjusted result");
  });

  it("marks a retired refinement as retired without attempting to match it", () => {
    const pkg: PackageFile = {
      package: { slug: "example-pkg", name: "Example Provider" },
      edition: { levelId: "T2", year: "2026" },
      units: [
        {
          ref: "fsa/lm1",
          title: "Alpha Reading One",
          resources: [],
          losRefinements: [
            { sourceLabel: "an outcome the current curriculum no longer tests", questionCount: 2, retired: true },
          ],
        },
      ],
      editionResources: [],
    };

    const { file } = proposeCrosswalk(pkg, LEVEL);
    const retired = file.losMap!.find((e) => e.unitRef === "fsa/lm1")! as any;
    expect(retired.retired).toBe(true);
    expect(retired.sourceLabel).toBe("an outcome the current curriculum no longer tests");
  });

  it("an outcome label with no confident match is reported, not guessed", () => {
    const pkg: PackageFile = {
      package: { slug: "example-pkg", name: "Example Provider" },
      edition: { levelId: "T2", year: "2026" },
      units: [
        {
          ref: "fsa/lm1",
          title: "Alpha Reading One",
          resources: [],
          losRefinements: [
            { sourceLabel: "this outcome label matches nothing in the fixture reading", questionCount: 1 },
          ],
        },
      ],
      editionResources: [],
    };

    const { file, unmatched } = proposeCrosswalk(pkg, LEVEL);
    expect(file.losMap ?? []).toEqual([]);
    expect(unmatched.some((u) => u.includes("fsa/lm1") && u.includes("los"))).toBe(true);
  });

  it("two outcomes in the same reading that normalise identically are refused, not guessed", () => {
    // Differ only by "the" vs "a", which the fuzzy normaliser strips from
    // both: a matcher that did not check for ambiguity would have to pick
    // one of these two genuinely different outcomes and would be wrong half
    // the time. Order is otherwise identical, so this does not depend on
    // the no-sort fix in isolation: it is the actual safety property.
    const levelWithAmbiguousLos: LevelFile = structuredClone(LEVEL);
    const readingOne = levelWithAmbiguousLos.topics[0].readings[0];
    readingOne.los = [
      { text: "describe the primary indicator for stage one", order: 1 },
      { text: "describe a primary indicator for stage one", order: 2 },
    ];

    const pkg: PackageFile = {
      package: { slug: "example-pkg", name: "Example Provider" },
      edition: { levelId: "T2", year: "2026" },
      units: [
        {
          ref: "fsa/lm1",
          title: "Alpha Reading One",
          resources: [],
          losRefinements: [{ sourceLabel: "Describe a primary indicator for stage one", questionCount: 3 }],
        },
      ],
      editionResources: [],
    };

    const { file, unmatched } = proposeCrosswalk(pkg, levelWithAmbiguousLos);
    expect(file.losMap ?? []).toEqual([]);
    expect(unmatched.some((u) => u.includes("fsa/lm1") && u.includes("los"))).toBe(true);
  });

  it("two readings whose titles normalise identically are refused, not guessed", () => {
    // Same title text under two different readings: a matcher that picked
    // the first hit would silently bind to the wrong one half the time.
    const levelWithAmbiguousTitles: LevelFile = structuredClone(LEVEL);
    levelWithAmbiguousTitles.topics[0].readings.push({
      name: "Alpha Reading One",
      order: 7,
      los: [],
    });

    const pkg: PackageFile = {
      package: { slug: "example-pkg", name: "Example Provider" },
      edition: { levelId: "T2", year: "2026" },
      units: [{ ref: "fsa/lm1", title: "Alpha Reading One", resources: [] }],
      editionResources: [],
    };

    const { unmatched } = proposeCrosswalk(pkg, levelWithAmbiguousTitles);
    expect(unmatched).toContain("fsa/lm1");
  });
});

describe("checkCrosswalk level guard", () => {
  it("refuses a crosswalk written for a different level", () => {
    const file = { ...GOOD, levelId: "III" };
    const errors = checkCrosswalk(file as typeof GOOD, LEVEL);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("level III");
    expect(errors[0]).toContain("curriculum given is level T2");
  });
});
