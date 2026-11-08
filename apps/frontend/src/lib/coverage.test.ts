import { describe, it, expect } from "vitest";
import {
  uncoveredWeightPoints,
  sortByStake,
  weightedCoveragePercent,
  type TopicCoverage,
} from "./coverage";

const topic = (p: Partial<TopicCoverage>): TopicCoverage => ({
  topicId: "t",
  name: "Topic",
  weightMin: 10,
  weightMax: 12,
  covered: 0,
  total: 10,
  ...p,
});

describe("uncoveredWeightPoints", () => {
  it("is the full weight midpoint when nothing is covered", () => {
    expect(uncoveredWeightPoints(topic({ weightMin: 10, weightMax: 12, covered: 0 }))).toBe(11);
  });

  it("is zero when everything is covered", () => {
    expect(uncoveredWeightPoints(topic({ covered: 10, total: 10 }))).toBe(0);
  });

  it("scales with the uncovered fraction", () => {
    expect(
      uncoveredWeightPoints(topic({ weightMin: 10, weightMax: 10, covered: 7, total: 10 })),
    ).toBeCloseTo(3);
  });

  it("treats a topic with no outcomes as fully uncovered rather than dividing by zero", () => {
    expect(uncoveredWeightPoints(topic({ total: 0, covered: 0 }))).toBe(11);
  });
});

describe("sortByStake", () => {
  it("puts a heavily weighted untouched topic above a lighter one", () => {
    const heavy = topic({ topicId: "fra", weightMin: 13, weightMax: 17, covered: 0, total: 80 });
    const light = topic({ topicId: "alt", weightMin: 5, weightMax: 8, covered: 0, total: 20 });
    expect(sortByStake([light, heavy]).map((t) => t.topicId)).toEqual(["fra", "alt"]);
  });

  it("ranks a nearly finished heavy topic below an untouched light one", () => {
    // Ethics at 15-20% but 95% done has 0.875 points left; Alternatives at
    // 5-8% untouched has 6.5. The nearly finished topic is not what is at stake.
    const ethics = topic({ topicId: "eth", weightMin: 15, weightMax: 20, covered: 95, total: 100 });
    const alt = topic({ topicId: "alt", weightMin: 5, weightMax: 8, covered: 0, total: 20 });
    expect(sortByStake([ethics, alt]).map((t) => t.topicId)).toEqual(["alt", "eth"]);
  });

  it("does not mutate its input", () => {
    const input = [
      topic({ topicId: "a", weightMin: 1, weightMax: 1 }),
      topic({ topicId: "b", weightMin: 20, weightMax: 20 }),
    ];
    sortByStake(input);
    expect(input.map((t) => t.topicId)).toEqual(["a", "b"]);
  });
});

describe("weightedCoveragePercent", () => {
  it("refuses to read as mostly done when only light topics are finished", () => {
    // The exact failure the product spec calls out: every outcome in a 5%
    // topic done, a 20% topic untouched. A flat outcome count would say 80%.
    const light = topic({ topicId: "l", weightMin: 5, weightMax: 5, covered: 40, total: 40 });
    const heavy = topic({ topicId: "h", weightMin: 20, weightMax: 20, covered: 0, total: 10 });
    expect(weightedCoveragePercent([light, heavy])).toBeCloseTo(20);
  });

  it("is 0 with nothing covered and 100 with everything covered", () => {
    const none = [topic({ covered: 0, total: 10 })];
    const all = [topic({ covered: 10, total: 10 })];
    expect(weightedCoveragePercent(none)).toBe(0);
    expect(weightedCoveragePercent(all)).toBeCloseTo(100);
  });

  it("returns 0 rather than NaN for an empty level", () => {
    expect(weightedCoveragePercent([])).toBe(0);
  });
});
