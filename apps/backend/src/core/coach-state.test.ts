import { test, expect } from "vitest";
import type {
  CoachState,
  CoachInput,
  StreakBand,
  DayShape,
  LoggingState,
} from "./coach-state";
import { classify } from "./coach-state";

// Helper to create test inputs with sensible defaults for a normal day
function input(overrides: Partial<CoachInput>): CoachInput {
  return {
    streakDays: 0,
    taskMinutes: 90,
    availableMinutes: 120,
    isHoliday: false,
    hasRequeued: false,
    hasMock: false,
    taskCount: 5,
    tasksDone: 3,
    extraLogged: 0,
    onPlanLogged: 0,
    offPlanLogged: 0,
    daysToExam: 120,
    planTotalDays: 200,
    planElapsedDays: 80,
    holidayStartsTomorrow: false,
    holidayYesterday: false,
    holidayTomorrow: false,
    ...overrides,
  };
}

// STREAK BAND TESTS
// Test the mapping from consecutive missed days to streak band

test.each([
  [0, "on-track"],
  [1, "slip"],
  [2, "drifting"],
  [3, "drifting"],
  [4, "serious"],
  [6, "serious"],
  [7, "crisis"],
  [30, "crisis"],
])("streak of %i days is %s", (days, band) => {
  expect(classify(input({ streakDays: days })).streak).toBe(band);
});

// Boundary tests for streak
test("streak boundary: 1 day is slip not drifting", () => {
  expect(classify(input({ streakDays: 1 })).streak).toBe("slip");
});

test("streak boundary: 2 days is drifting not slip", () => {
  expect(classify(input({ streakDays: 2 })).streak).toBe("drifting");
});

test("streak boundary: 4 days is serious not drifting", () => {
  expect(classify(input({ streakDays: 4 })).streak).toBe("serious");
});

test("streak boundary: 7 days is crisis not serious", () => {
  expect(classify(input({ streakDays: 7 })).streak).toBe("crisis");
});

// SHAPE TESTS
// Order of evaluation matters: rest, catch-up, heavy, light, normal

test("a holiday with no availability is rest", () => {
  expect(classify(input({ isHoliday: true, availableMinutes: 0 })).shape).toBe("rest");
});

test("a holiday is rest even with scheduled tasks", () => {
  expect(classify(input({ isHoliday: true, taskMinutes: 90 })).shape).toBe("rest");
});

test("no availability makes it rest regardless of scheduled minutes", () => {
  expect(classify(input({ availableMinutes: 0, taskMinutes: 50 })).shape).toBe("rest");
});

test("catch-up: requeued work takes precedence over light/normal categorization", () => {
  expect(classify(input({ hasRequeued: true, taskMinutes: 200 })).shape).toBe("catch-up");
});

test("catch-up: a day with light scheduled minutes but requeued work is catch-up", () => {
  expect(classify(input({ hasRequeued: true, taskMinutes: 30 })).shape).toBe("catch-up");
});

test("heavy: over 150 scheduled minutes makes it heavy", () => {
  expect(classify(input({ taskMinutes: 151 })).shape).toBe("heavy");
});

test("heavy: exactly 151 scheduled minutes is heavy", () => {
  expect(classify(input({ taskMinutes: 151 })).shape).toBe("heavy");
});

test("heavy: a day with a mock is heavy even with light scheduled minutes", () => {
  expect(classify(input({ hasMock: true, taskMinutes: 60 })).shape).toBe("heavy");
});

test("light: under 45 scheduled minutes is light", () => {
  expect(classify(input({ taskMinutes: 44 })).shape).toBe("light");
});

test("light: exactly 44 minutes is light", () => {
  expect(classify(input({ taskMinutes: 44 })).shape).toBe("light");
});

test("normal: 45 scheduled minutes is normal, not light", () => {
  expect(classify(input({ taskMinutes: 45 })).shape).toBe("normal");
});

test("normal: 149 scheduled minutes is normal, not heavy", () => {
  expect(classify(input({ taskMinutes: 149 })).shape).toBe("normal");
});

test("normal: default task minutes produces normal", () => {
  const state = classify(input({}));
  expect(state.shape).toBe("normal");
});

// Test the critical precedence: holiday takes precedence over requeued
test("rest takes precedence: holiday with requeued work is still rest", () => {
  expect(
    classify(input({ isHoliday: true, hasRequeued: true, taskMinutes: 200 }))
      .shape
  ).toBe("rest");
});

// LOGGING STATE TESTS
// Logging tracks whether all planned tasks were completed and if extra items were logged

test.each([
  [0, 3, "nothing"],
  [1, 3, "partial"],
  [2, 3, "partial"],
  [3, 3, "complete"],
])("%i of %i tasks done is %s", (done, total, state) => {
  expect(classify(input({ tasksDone: done, taskCount: total })).logging).toBe(state);
});

test("no tasks done is nothing", () => {
  expect(classify(input({ tasksDone: 0, taskCount: 5 })).logging).toBe("nothing");
});

test("all tasks done with no extra is complete", () => {
  expect(classify(input({ tasksDone: 5, taskCount: 5, extraLogged: 0 })).logging).toBe("complete");
});

test("all tasks done with extra logged is over, not complete", () => {
  expect(
    classify(input({ tasksDone: 3, taskCount: 3, extraLogged: 1 }))
      .logging
  ).toBe("over");
});

test("extra items beyond the plan: any extra with all tasks done is over", () => {
  expect(
    classify(input({ tasksDone: 5, taskCount: 5, extraLogged: 3 }))
      .logging
  ).toBe("over");
});

test("extraLogged does not make partial into over", () => {
  expect(
    classify(input({ tasksDone: 2, taskCount: 5, extraLogged: 1 }))
      .logging
  ).toBe("partial");
});

// STREAK DAYS PASSTHROUGH
// The output carries the raw streak days count

test("streakDays is passed through in the output", () => {
  expect(classify(input({ streakDays: 5 })).streakDays).toBe(5);
});

test("streakDays is 0 in normal case", () => {
  expect(classify(input({})).streakDays).toBe(0);
});

// INTEGRATION: Multiple fields working together

test("complete state: on-track, normal day, partial logging", () => {
  const state = classify(
    input({
      streakDays: 0,
      taskMinutes: 90,
      availableMinutes: 120,
      isHoliday: false,
      hasRequeued: false,
      hasMock: false,
      taskCount: 5,
      tasksDone: 2,
      extraLogged: 0,
    })
  );
  expect(state.streak).toBe("on-track");
  expect(state.shape).toBe("normal");
  expect(state.logging).toBe("partial");
  expect(state.streakDays).toBe(0);
});

test("crisis day: crisis, catch-up, over logging", () => {
  const state = classify(
    input({
      streakDays: 10,
      hasRequeued: true,
      tasksDone: 3,
      taskCount: 3,
      extraLogged: 2,
    })
  );
  expect(state.streak).toBe("crisis");
  expect(state.shape).toBe("catch-up");
  expect(state.logging).toBe("over");
  expect(state.streakDays).toBe(10);
});

// OFF-PLAN WORK
//
// The worst bug the coach has had: the day's verdict was read off tasks TICKED,
// so a candidate who studied two hours of the wrong topic and a candidate who
// studied nothing produced the identical "nothing". The first was then shamed
// for idleness and sent an evening nudge insisting nothing was logged while
// they were mid-session. These tests exist to keep that from coming back.

test("studying the wrong topic is off-plan, never nothing", () => {
  const state = classify(input({ tasksDone: 0, taskCount: 4, offPlanLogged: 2 }));
  expect(state.logging).toBe("off-plan");
});

test("studying a prescribed reading without ticking the box still counts as progress", () => {
  // The tick is a UI detail and the log entry is the evidence. A candidate who
  // did exactly what was asked must not be told they did nothing because they
  // skipped a checkbox.
  const state = classify(input({ tasksDone: 0, taskCount: 4, onPlanLogged: 2 }));
  expect(state.logging).toBe("partial");
});

test("on-plan work outranks off-plan work when both happened", () => {
  // A day with some prescribed work done and some wandering is a partial day,
  // not an off-plan one: the coach should acknowledge the real progress rather
  // than lead with the correction.
  const state = classify(
    input({ tasksDone: 0, taskCount: 4, onPlanLogged: 1, offPlanLogged: 3 }),
  );
  expect(state.logging).toBe("partial");
});

test("a genuinely empty day is still nothing", () => {
  // The distinction has to hold in both directions. If an empty log came out as
  // off-plan the coach would credit work that never happened.
  const state = classify(
    input({ tasksDone: 0, taskCount: 4, onPlanLogged: 0, offPlanLogged: 0 }),
  );
  expect(state.logging).toBe("nothing");
});

test("ticked tasks still decide the verdict when there are any", () => {
  // Off-plan only takes over when nothing on the list was done. A candidate who
  // ticked two of four and also wandered is partial, as before.
  const state = classify(
    input({ tasksDone: 2, taskCount: 4, offPlanLogged: 5 }),
  );
  expect(state.logging).toBe("partial");
});

test("a complete day is unaffected by off-plan entries", () => {
  const state = classify(
    input({ tasksDone: 4, taskCount: 4, extraLogged: 0, offPlanLogged: 0 }),
  );
  expect(state.logging).toBe("complete");
});

test("off-plan work does not make the day a rest day or change the streak band", () => {
  // Guards against the new branch leaking into the other two dimensions.
  const state = classify(input({ tasksDone: 0, offPlanLogged: 3, streakDays: 2 }));
  expect(state.logging).toBe("off-plan");
  expect(state.shape).not.toBe("rest");
  expect(state.streak).toBe("drifting");
});
