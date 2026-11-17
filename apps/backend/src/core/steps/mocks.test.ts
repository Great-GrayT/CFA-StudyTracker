import { describe, it, expect } from "vitest";
import { eligibleFrom, mockNeeds, mockDemandMinutes, trimmableMocks, type MockSession } from "./mocks";

const s = (ref: string, topicOrders: number[], o: Partial<MockSession> = {}): MockSession => ({
  ref, packageId: "p", resourceId: ref, title: ref, questionCount: 90, topicOrders, done: false, ...o,
});

describe("mockNeeds", () => {
  it("weekly minimums 1/2/3/4 mocks as sessions", () => {
    const n = mockNeeds("2026-01-01", "2026-03-01", []);
    expect(n.map((w) => [w.before, w.need])).toEqual([[4, 2], [3, 4], [2, 6], [1, 8]]);
    expect(n[3].end).toBe("2026-02-28");
    expect(n[3].start).toBe("2026-02-22");
  });
  it("drops weeks wholly in the past and credits done sessions", () => {
    const n = mockNeeds("2026-02-10", "2026-03-01", [s("a", [], { done: true, doneOn: "2026-02-12" })]);
    expect(n.map((w) => w.before)).toEqual([3, 2, 1]);
    expect(n[0].need).toBe(3);
  });
  it("trim removes whole mocks, earliest week first", () => {
    const n = mockNeeds("2026-01-01", "2026-03-01", [], 2);
    expect(n.map((w) => w.need)).toEqual([0, 2, 6, 8]);
    expect(mockDemandMinutes("2026-01-01", "2026-03-01", [], 0)).toBe(20 * 198);
    expect(trimmableMocks("2026-01-01", "2026-03-01", [])).toBe(10);
  });
});

describe("eligibleFrom", () => {
  const mods = [
    { readingId: "a", topicOrder: 1 }, { readingId: "b", topicOrder: 1 }, { readingId: "c", topicOrder: 2 },
  ];
  it("is the day after the last step 1-3 finish of every covered topic", () => {
    const e = eligibleFrom([s("x", [1]), s("y", [1, 2]), s("z", [2])], mods,
      new Map<string, string | null>([["a", "2026-02-01"], ["b", "2026-02-05"], ["c", "2026-02-10"]]));
    expect(e.get("x")).toBe("2026-02-06");
    expect(e.get("y")).toBe("2026-02-11");
  });
  it("modules with nothing left are always ready; unplaced means never", () => {
    const e = eligibleFrom([s("x", [1]), s("y", [2])], mods, new Map<string, string | null>([["c", null]]));
    expect(e.get("x")).toBe("");
    expect(e.get("y")).toBeNull();
  });
});
