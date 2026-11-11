import { test, expect } from "vitest";
import { splitLoggedWork } from "./logged-work";

test("work on a planned reading counts as on-plan", () => {
  expect(splitLoggedWork(["fi-2"], ["fi-2", "eq-1"])).toEqual({ onPlan: 1, offPlan: 0 });
});

test("work on an unplanned reading counts as off-plan", () => {
  // The case the whole module exists for: real study, wrong direction. It must
  // never come out as zero work.
  expect(splitLoggedWork(["deriv-3"], ["fi-2", "eq-1"])).toEqual({ onPlan: 0, offPlan: 1 });
});

test("a mixed day is reported as both, not as one or the other", () => {
  const split = splitLoggedWork(["fi-2", "deriv-3", "deriv-4", "eq-1"], ["fi-2", "eq-1"]);
  expect(split).toEqual({ onPlan: 2, offPlan: 2 });
});

test("repeated entries against one planned reading all count", () => {
  // Three sessions on the same reading is three pieces of logged work. Counting
  // distinct readings instead would under-credit a candidate who ground through
  // one hard topic all day, which is the opposite of what should happen.
  expect(splitLoggedWork(["fi-2", "fi-2", "fi-2"], ["fi-2"])).toEqual({
    onPlan: 3,
    offPlan: 0,
  });
});

test("repeated entries against one unplanned reading all count", () => {
  expect(splitLoggedWork(["deriv-3", "deriv-3"], ["fi-2"])).toEqual({ onPlan: 0, offPlan: 2 });
});

test("a day with nothing logged is zero of both, not off-plan", () => {
  // Distinguishing "studied nothing" from "studied the wrong thing" is the
  // entire point. If an empty log came out as off-plan the coach would credit
  // work that never happened.
  expect(splitLoggedWork([], ["fi-2", "eq-1"])).toEqual({ onPlan: 0, offPlan: 0 });
});

test("work logged on a day with no planned tasks is all off-plan", () => {
  // A rest day the candidate decided to study through. Every entry is off-plan
  // by definition, and the debrief treats that as a bonus rather than a fault.
  expect(splitLoggedWork(["fi-2", "eq-1"], [])).toEqual({ onPlan: 0, offPlan: 2 });
});

test("planned readings the candidate never touched do not appear anywhere", () => {
  // The split describes what was STUDIED, not what was missed. A planned
  // reading with no log entry must not inflate either count, or a candidate
  // would be credited for tasks they did not start.
  const split = splitLoggedWork(["fi-2"], ["fi-2", "eq-1", "deriv-3", "alt-1"]);
  expect(split.onPlan).toBe(1);
  expect(split.offPlan).toBe(0);
});

test("the counts always sum to the number of entries studied", () => {
  // Nothing may be silently dropped: an entry that matched neither branch would
  // be work the candidate did that the coach never saw.
  const studied = ["a", "b", "c", "d", "e", "a", "c"];
  const split = splitLoggedWork(studied, ["a", "c"]);
  expect(split.onPlan + split.offPlan).toBe(studied.length);
});

test("matching is exact, not by prefix", () => {
  // "fi-2" and "fi-20" are different readings. A prefix or substring match
  // would quietly credit the wrong one.
  expect(splitLoggedWork(["fi-20"], ["fi-2"])).toEqual({ onPlan: 0, offPlan: 1 });
  expect(splitLoggedWork(["fi-2"], ["fi-20"])).toEqual({ onPlan: 0, offPlan: 1 });
});

test("the planned list is not mutated", () => {
  // It is the caller's array, built from today's tasks and reused afterwards.
  const planned = ["fi-2", "eq-1"];
  splitLoggedWork(["deriv-3"], planned);
  expect(planned).toEqual(["fi-2", "eq-1"]);
});
