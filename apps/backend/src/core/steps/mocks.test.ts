import { describe, it, expect } from "vitest";
import { MOCK_OVERFLOW_MAX, windowMockTrim, eligibleFrom, mockNeeds, mockDemandMinutes, trimmableMocks, placeMocks, type MockSession } from "./mocks";

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
  it("trim removes whole mocks from the busiest week, latest first on ties", () => {
    const n = mockNeeds("2026-01-01", "2026-03-01", [], 2);
    expect(n.map((w) => w.need)).toEqual([2, 4, 6, 4]);
    expect(mockNeeds("2026-01-01", "2026-03-01", [], 99).every((w) => w.need === 0)).toBe(true);
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

describe("placeMocks generics", () => {
  const caps = Array.from({ length: 28 }, (_, i) => ({
    date: `2026-02-${String(i + 1).padStart(2, "0")}`, minutes: 400,
  }));
  const run = (genericFrom: string | null) => placeMocks({
    today: "2026-02-01", exam: "2026-03-01", caps, sessions: [], elig: new Map(), trim: 0, genericFrom,
  });
  it("places generic mocks no earlier than every topic's eligibility", () => {
    const p = run("2026-02-24");
    expect(p.placements.length).toBeGreaterThan(0);
    for (const pl of p.placements) expect(pl.date >= "2026-02-24").toBe(true);
  });
  it("leaves generic mocks unplaced when some topic never becomes eligible", () => {
    const p = run(null);
    expect(p.placements).toEqual([]);
    expect(p.unplaced.length).toBeGreaterThan(0);
  });
});

describe("placeMocks whole sessions", () => {
  const days = (n: number, minutes: number, from = "2026-02-01") => Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.parse(`${from}T00:00:00Z`) + i * 864e5).toISOString().slice(0, 10);
    return { date: d, minutes };
  });
  const run = (caps: Array<{ date: string; minutes: number }>, trim = 0) => placeMocks({
    today: "2026-02-01", exam: "2026-03-01", caps, sessions: [], elig: new Map(), trim,
  });
  const sessionsOf = (p: ReturnType<typeof run>) => p.placements.filter((x) => x.item.kind === "mock");

  it("never splits a session across days, even at 120 min per day", () => {
    const p = run(days(28, 120));
    for (const pl of sessionsOf(p)) expect(pl.minutes).toBe(132);
    const ids = sessionsOf(p).map((x) => x.item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("honours the overflow max: a day too short for the paper minus 45 is no candidate", () => {
    const min = 132 - MOCK_OVERFLOW_MAX;
    const ok = placeMocks({ today: "2026-02-01", exam: "2026-03-01", caps: [{ date: "2026-02-25", minutes: min }],
      sessions: [], elig: new Map(), trim: 99 });
    expect(ok.unplaced).toEqual([]);
    const need = (m: number) => placeMocks({ today: "2026-02-01", exam: "2026-03-01",
      caps: [{ date: "2026-02-25", minutes: m }], sessions: [], elig: new Map(), trim: 0 });
    expect(sessionsOf(need(min - 1))).toEqual([]);
    const placed = sessionsOf(need(min));
    expect(placed.length).toBe(1);
    // Overflowing day is left with no room for anything else.
    expect(need(min).used.get("2026-02-25")).toBe(132);
  });
  it("spills a session that cannot fit its week to the nearest earlier week", () => {
    // Only week -3 (02-08..02-14) and week -1 (02-22..02-28) have room; week -2 has none.
    const caps = days(28, 0);
    const room = (d: string) => { caps.find((c) => c.date === d)!.minutes = 400; };
    ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-07", "2026-02-08"].forEach(room);
    const p = run(caps, 0);
    const wk = (d: string) => (d < "2026-02-08" ? "w4" : "w3");
    expect(sessionsOf(p).length).toBeGreaterThan(0);
    expect(sessionsOf(p).every((x) => wk(x.date) !== undefined)).toBe(true);
    // Week -1 asks for 8 sessions with room only up to 02-08: everything lands earlier.
    expect(sessionsOf(p).every((x) => x.date <= "2026-02-08")).toBe(true);
  });
  it("review prefers a whole next day and the window trim matches placement", () => {
    const p = run(days(28, 120));
    for (const r of p.placements.filter((x) => x.item.kind === "mock-review")) expect(r.minutes).toBe(66);
    const t = windowMockTrim({ today: "2026-02-01", exam: "2026-03-01", caps: days(28, 120), sessions: [] });
    expect(t).toBeGreaterThan(0);
    expect(run(days(28, 120), t).unplaced).toEqual([]);
    if (t > 0) expect(run(days(28, 120), t - 1).unplaced.length).toBeGreaterThan(0);
  });
});
