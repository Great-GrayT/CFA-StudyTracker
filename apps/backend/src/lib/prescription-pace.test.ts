import { expect, test } from "vitest";
import { paceOf } from "./FUNC-prescription";

test("pace is full-pace over planned minutes, only for planned work that is sped up", () => {
  expect(paceOf({ workMinutes: 90, estimatedMinutes: 60 }, false)).toBe(1.5);
  expect(paceOf({ workMinutes: 62, estimatedMinutes: 60 }, false)).toBeNull();
  expect(paceOf({ workMinutes: 90, estimatedMinutes: 60 }, true)).toBeNull();
  expect(paceOf({ workMinutes: null, estimatedMinutes: 60 }, false)).toBeNull();
});
