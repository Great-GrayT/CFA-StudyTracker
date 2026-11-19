import { test, expect } from "vitest";
import { effectiveAnswered, questionNumbersPayload, resolvePreset } from "./record";

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

import {
  declarationError,
  declarationItem,
  questionsError,
  stepForTask,
  taskQuestionCount,
} from "./record";

const mat = (action: string, questionCount: number | null) => ({ action, questionCount });

test("question count comes from the task, else from its practice materials, never from answer review", () => {
  expect(taskQuestionCount({ questionCount: 25, materials: [] })).toBe(25);
  expect(taskQuestionCount({ questionCount: null, materials: [mat("Questions", 12), mat("Questions", 8)] })).toBe(20);
  expect(taskQuestionCount({ questionCount: null, materials: [mat("Review answers", 12)] })).toBeNull();
  expect(taskQuestionCount({ questionCount: 0, materials: [] })).toBeNull();
  expect(taskQuestionCount({ questionCount: null, materials: [mat("Read", null)] })).toBeNull();
});

test("questions are validated as whole numbers with correct no higher than answered", () => {
  expect(questionsError("30", "24")).toBeNull();
  expect(questionsError("30", "30")).toBeNull();
  expect(questionsError("30", "31")).toBe("Correct answers cannot exceed questions answered.");
  expect(questionsError("", "")).toBe("Enter how many questions you answered.");
  expect(questionsError("0", "0")).toBe("Enter how many questions you answered.");
  expect(questionsError("30", "")).toBe("Enter how many you got correct.");
  expect(questionsError("3.5", "2")).toBe("Use whole numbers for questions.");
  expect(questionsError("30", "-1")).toBe("Use whole numbers for questions.");
});

test("a task maps to the engine's step, null for mocks and pre-engine tasks", () => {
  expect(stepForTask({ step: 1 })).toBe(1);
  expect(stepForTask({ step: 4 })).toBe(4);
  expect(stepForTask({ step: null })).toBeNull();
  expect(stepForTask({ step: 9 })).toBeNull();
});

test("step 3 needs step 1 and step 4 needs step 2, unless stated together", () => {
  const none = new Set<string>();
  const first = { readingId: "r1", step: 1 as const };
  expect(declarationError([{ readingId: "r1", step: 3 }], none)).toBe("Review needs the first read first");
  expect(declarationError([{ readingId: "r1", step: 4 }], none)).toBe(
    "Review questions need the initial questions first",
  );
  expect(declarationError([first, { readingId: "r1", step: 3 }], none)).toBeNull();
  expect(declarationError([{ readingId: "r1", step: 3 }], new Set(["r1|1"]))).toBeNull();
  // Another module's step 1 does not count.
  expect(declarationError([{ readingId: "r2", step: 3 }, first], none)).toBe("Review needs the first read first");
});

test("a declaration item carries confidence for reads and counts for questions", () => {
  expect(declarationItem("r1", 1, { confidence: 4, answered: "", correct: "" })).toEqual({
    readingId: "r1", step: 1, confidence: 4,
  });
  expect(declarationItem("r1", 2, { confidence: 0, answered: "30", correct: "27" })).toEqual({
    readingId: "r1", step: 2, answered: 30, correct: 27,
  });
  expect(declarationItem("r1", 2, { confidence: 0, answered: "", correct: "" })).toEqual({ readingId: "r1", step: 2 });
});

test("answered falls back to the listed question count only when empty", () => {
  expect(effectiveAnswered("", 7)).toBe("7");
  expect(effectiveAnswered(" ", 7)).toBe("7");
  expect(effectiveAnswered("10", 7)).toBe("10");
  expect(effectiveAnswered("", 0)).toBe("");
});

test("question numbers are sent only when given", () => {
  expect(questionNumbersPayload([])).toEqual({});
  expect(questionNumbersPayload([1, 2])).toEqual({ questionNumbers: [1, 2] });
});
