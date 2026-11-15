import { test, expect } from "vitest";
import { resolvePreset } from "./record";

const topics = [
  { id: "t1", readings: [{ id: "r1", los: [{ id: "l1" }] }, { id: "r2", los: [{ id: "l2" }] }] },
  { id: "t2", readings: [{ id: "r3", los: [{ id: "l3" }] }] },
];
const day = { date: "2026-11-15", tasks: [{ id: "task1", kind: "eocq", readingIds: ["r3"] }] };
const today = "2026-11-15";

test("a plain open changes nothing", () => {
  expect(resolvePreset({}, topics, day, today)).toEqual({});
});

test("an outcome preset picks its section and module, once the syllabus has loaded", () => {
  expect(resolvePreset({ losId: "l2" }, [], undefined, today)).toBeUndefined();
  expect(resolvePreset({ losId: "l2" }, topics, undefined, today)).toEqual({ topicId: "t1", readingId: "r2" });
});

test("a cell preset fills section, module and kind, and waits for the day's tasks", () => {
  expect(resolvePreset({ taskId: "task1" }, topics, undefined, today)).toBeUndefined();
  expect(resolvePreset({ taskId: "task1" }, topics, day, today)).toEqual({
    topicId: "t2",
    readingId: "r3",
    kind: "eocq",
  });
  // A cell that is not on the day falls back to the outcome, or to nothing.
  expect(resolvePreset({ taskId: "gone", losId: "l1" }, topics, day, today)).toEqual({ topicId: "t1", readingId: "r1" });
  expect(resolvePreset({ taskId: "gone" }, topics, day, today)).toEqual({});
});

test("a cell on another day waits for that day, never settles on the day still loaded", () => {
  const preset = { taskId: "task9", date: "2026-11-12" };
  // The sheet still holds today's cells on the first render after opening.
  expect(resolvePreset(preset, topics, day, today)).toBeUndefined();
  const thatDay = { date: "2026-11-12", tasks: [{ id: "task9", kind: "review", readingIds: ["r1"] }] };
  expect(resolvePreset(preset, topics, thatDay, today)).toEqual({ topicId: "t1", readingId: "r1", kind: "review" });
});
