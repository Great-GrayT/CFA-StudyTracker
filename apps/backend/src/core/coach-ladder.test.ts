import { describe, test, expect } from "vitest";
import { coachStage, messagesFor, daySlots } from "./coach-ladder";
import { SLOT_LOCAL_TIMES } from "./slots";

const mod = (s1: boolean, s2: boolean, s3: boolean, s4: boolean) => ({ s1, s2, s3, s4 });
const base = { stage: "steps-1-2", daysBehind: 0, belowPass: false, restDay: false, pastExam: false } as const;
const mins = (s: { hour: number; minute: number }) => s.hour * 60 + s.minute;
const ANCHORS = ["prescription", "nudge", "debrief"];

describe("coachStage", () => {
  test("earliest step below 90% of modules decides", () => {
    expect(coachStage([mod(true, false, false, false), mod(false, false, false, false)], 100)).toBe("steps-1-2");
    const s1done = Array.from({ length: 10 }, () => mod(true, false, false, false));
    expect(coachStage(s1done, 100)).toBe("steps-1-2");
    const s12done = Array.from({ length: 10 }, () => mod(true, true, false, false));
    expect(coachStage(s12done, 100)).toBe("steps-3-4");
  });
  test("90% threshold is inclusive", () => {
    const nine = [...Array.from({ length: 9 }, () => mod(true, true, false, false)), mod(true, false, false, false)];
    expect(coachStage(nine, 100)).toBe("steps-3-4");
    const eight = [
      ...Array.from({ length: 8 }, () => mod(true, true, false, false)),
      mod(true, false, false, false),
      mod(true, false, false, false),
    ];
    expect(coachStage(eight, 100)).toBe("steps-1-2");
  });
  test("all steps passed stays in steps 3-4; no modules is steps 1-2", () => {
    expect(coachStage([mod(true, true, true, true)], 100)).toBe("steps-3-4");
    expect(coachStage([], 100)).toBe("steps-1-2");
  });
  test("30 days or fewer is the mock window whatever the steps", () => {
    expect(coachStage([mod(false, false, false, false)], 30)).toBe("mock-window");
    expect(coachStage([mod(false, false, false, false)], 31)).toBe("steps-1-2");
  });
});

describe("messagesFor", () => {
  test("ladder rows", () => {
    expect(messagesFor(base)).toBe(3);
    expect(messagesFor({ ...base, stage: "steps-3-4" })).toBe(3);
    expect(messagesFor({ ...base, stage: "mock-window" })).toBe(4);
    expect(messagesFor({ ...base, daysBehind: 5 })).toBe(8);
    expect(messagesFor({ ...base, belowPass: true })).toBe(12);
  });
  test("behind never drops below the mock window count and caps at 12", () => {
    expect(messagesFor({ ...base, stage: "mock-window", daysBehind: 0 })).toBe(4);
    expect(messagesFor({ ...base, stage: "mock-window", daysBehind: 1 })).toBe(4);
    expect(messagesFor({ ...base, daysBehind: 40 })).toBe(12);
  });
  test("rest day is anchors only, past exam is nothing", () => {
    expect(messagesFor({ ...base, daysBehind: 5, belowPass: true, restDay: true })).toBe(3);
    expect(messagesFor({ ...base, belowPass: true, pastExam: true })).toBe(0);
  });
});

describe("daySlots", () => {
  const input = { planId: "p1", localDate: "2027-01-04", schedule: SLOT_LOCAL_TIMES };

  test("3 is the anchors", () => {
    expect(daySlots({ ...input, count: 3 })).toEqual([
      { slot: "prescription", hour: 6, minute: 30 },
      { slot: "nudge", hour: 20, minute: 0 },
      { slot: "debrief", hour: 22, minute: 30 },
    ]);
  });
  test("0 is nothing", () => {
    expect(daySlots({ ...input, count: 0 })).toEqual([]);
  });
  test("4 adds midday at the midpoint of morning and evening", () => {
    const s = daySlots({ ...input, count: 4 });
    expect(s.map((x) => x.slot)).toEqual(["prescription", "midday", "nudge", "debrief"]);
    expect(mins(s[1]!)).toBe((6 * 60 + 30 + 20 * 60) / 2);
  });
  test("extras are random, deterministic, spaced 45 minutes and inside the window", () => {
    const a = daySlots({ ...input, count: 8 });
    expect(a).toHaveLength(8);
    expect(daySlots({ ...input, count: 8 })).toEqual(a);
    expect(daySlots({ ...input, planId: "p2", count: 8 })).not.toEqual(a);
    const times = a.map(mins);
    expect([...times]).toEqual([...times].sort((x, y) => x - y));
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(45);
    const extras = a.filter((x) => x.slot.startsWith("extra-"));
    expect(extras).toHaveLength(5);
    for (const e of extras) {
      expect(mins(e)).toBeGreaterThan(6 * 60 + 30);
      expect(mins(e)).toBeLessThan(22 * 60 + 30);
    }
    expect(new Set(a.map((x) => x.slot)).size).toBe(8);
  });
  test("raising the count keeps earlier extras where they were", () => {
    const small = daySlots({ ...input, count: 6, midday: false }).filter((x) => x.slot.startsWith("extra-"));
    const big = daySlots({ ...input, count: 9, midday: false });
    for (const e of small) expect(big).toContainEqual(e);
  });
  test("12 in a short window drops the overflow, never two inside 45 minutes", () => {
    const schedule = {
      prescription: { hour: 9, minute: 0 },
      nudge: { hour: 12, minute: 0 },
      debrief: { hour: 15, minute: 0 },
    };
    const s = daySlots({ ...input, schedule, count: 12 });
    expect(s.length).toBeLessThan(12);
    const t = s.map(mins);
    for (let i = 1; i < t.length; i++) expect(t[i]! - t[i - 1]!).toBeGreaterThanOrEqual(45);
    expect(s.filter((x) => ANCHORS.includes(x.slot))).toHaveLength(3);
  });
  test("12 in a roomy window fills with extra-1..extra-9", () => {
    const schedule = {
      prescription: { hour: 6, minute: 0 },
      nudge: { hour: 20, minute: 0 },
      debrief: { hour: 23, minute: 0 },
    };
    const s = daySlots({ ...input, schedule, count: 12, midday: false });
    expect(s).toHaveLength(12);
    const names = s.filter((x) => x.slot.startsWith("extra-")).map((x) => x.slot).sort();
    expect(names).toEqual(Array.from({ length: 9 }, (_, i) => "extra-" + (i + 1)).sort());
  });
  test("count above 12 is capped", () => {
    expect(daySlots({ ...input, count: 30 }).length).toBeLessThanOrEqual(12);
  });
  test("midday false makes a 4th message an extra", () => {
    const s = daySlots({ ...input, count: 4, midday: false });
    expect(s.map((x) => x.slot)).not.toContain("midday");
    expect(s.map((x) => x.slot)).toContain("extra-1");
  });
});
