import { expect, test } from "vitest";
import { DEFAULT_TUNING, parseTuning } from "./tuning";
import type { MasteryObservation } from "./mastery";
import {
  isEligibleToJump,
  isLearned,
  mastery,
  masteryByTopic,
  masteryOfUnit,
  planReadiness,
} from "./mastery";

const T = DEFAULT_TUNING;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-12T00:00:00Z");

function obs(p: Partial<MasteryObservation> = {}): MasteryObservation {
  return {
    losId: "l1",
    answered: 0,
    correct: 0,
    available: 100,
    confidence: null,
    lastTouch: null,
    questionMinutes: 60,
    ...p,
  };
}

test("no logged work is mastery zero, not a smoothed floor", () => {
  expect(mastery(obs(), NOW, T)).toBe(0);
});

test("accuracy is Laplace-smoothed, so two of two reads as 0.75", () => {
  // answered 2, correct 2, available 2 so coverage is 1, confidence absent so s is 0.
  // M = 1 * (0.60 * 0.75 + 0.25 * 1 + 0.15 * 0) = 0.70
  const m = mastery(
    obs({ answered: 2, correct: 2, available: 2, lastTouch: NOW }),
    NOW,
    T,
  );
  expect(m).toBeCloseTo(0.7, 10);
});

test("coverage caps at one when more questions were answered than the stock holds", () => {
  const m = mastery(
    obs({ answered: 300, correct: 300, available: 100, lastTouch: NOW }),
    NOW,
    T,
  );
  const a = 301 / 302;
  expect(m).toBeCloseTo(0.6 * a + 0.25 * 1, 10);
});

test("confidence maps 1 to 5 onto 0 to 1", () => {
  const low = mastery(
    obs({ answered: 10, correct: 5, available: 10, confidence: 1, lastTouch: NOW }),
    NOW,
    T,
  );
  const high = mastery(
    obs({ answered: 10, correct: 5, available: 10, confidence: 5, lastTouch: NOW }),
    NOW,
    T,
  );
  expect(high - low).toBeCloseTo(0.15, 10);
});

test("freshness halves M over exactly one half-life", () => {
  const fresh = mastery(
    obs({ answered: 20, correct: 15, available: 20, lastTouch: NOW }),
    NOW,
    T,
  );
  const stale = mastery(
    obs({
      answered: 20,
      correct: 15,
      available: 20,
      lastTouch: new Date(NOW.getTime() - 45 * DAY),
    }),
    NOW,
    T,
  );
  expect(stale).toBeCloseTo(fresh / 2, 10);
});

test("a future-dated log cannot push freshness above one", () => {
  const future = mastery(
    obs({
      answered: 20,
      correct: 15,
      available: 20,
      lastTouch: new Date(NOW.getTime() + 30 * DAY),
    }),
    NOW,
    T,
  );
  const today = mastery(
    obs({ answered: 20, correct: 15, available: 20, lastTouch: NOW }),
    NOW,
    T,
  );
  expect(future).toBeCloseTo(today, 10);
  expect(future).toBeLessThanOrEqual(1);
});

test("zeroing the confidence weight removes confidence from the number entirely", () => {
  const { tuning } = parseTuning({
    masteryWeightAccuracy: 0.7,
    masteryWeightCoverage: 0.3,
    masteryWeightConfidence: 0,
  });
  const low = mastery(
    obs({ answered: 10, correct: 5, available: 10, confidence: 1, lastTouch: NOW }),
    NOW,
    tuning,
  );
  const high = mastery(
    obs({ answered: 10, correct: 5, available: 10, confidence: 5, lastTouch: NOW }),
    NOW,
    tuning,
  );
  expect(high).toBeCloseTo(low, 10);
});

test("a unit's mastery is the question-minute-weighted mean of its outcomes", () => {
  const long = obs({
    losId: "a",
    answered: 100,
    correct: 100,
    available: 100,
    lastTouch: NOW,
    questionMinutes: 300,
  });
  const short = obs({
    losId: "b",
    answered: 0,
    correct: 0,
    available: 100,
    lastTouch: null,
    questionMinutes: 10,
  });
  const m = masteryOfUnit([long, short], NOW, T);
  const expected = (mastery(long, NOW, T) * 300 + 0 * 10) / 310;
  expect(m).toBeCloseTo(expected, 10);
});

test("a unit with no outcomes at all is mastery zero, not a division by zero", () => {
  expect(masteryOfUnit([], NOW, T)).toBe(0);
});

test("a unit whose outcomes all carry zero question minutes falls back to a plain mean", () => {
  const a = obs({ losId: "a", answered: 10, correct: 10, available: 10, lastTouch: NOW, questionMinutes: 0 });
  const b = obs({ losId: "b", answered: 0, correct: 0, questionMinutes: 0 });
  const m = masteryOfUnit([a, b], NOW, T);
  expect(m).toBeCloseTo(mastery(a, NOW, T) / 2, 10);
});

test("topic mastery is computed per key", () => {
  const byTopic = new Map<string, MasteryObservation[]>([
    ["fsa", [obs({ answered: 100, correct: 100, available: 100, confidence: 5, lastTouch: NOW })]],
    ["alt", [obs()]],
  ]);
  const result = masteryByTopic(byTopic, NOW, T);
  expect(result.get("alt")).toBe(0);
  expect(result.get("fsa")!).toBeGreaterThan(0.9);
});

test("plan readiness weights topic mastery by exam weight", () => {
  const r = planReadiness(
    new Map([
      ["fsa", 1],
      ["alt", 0],
    ]),
    new Map([
      ["fsa", 15],
      ["alt", 5],
    ]),
  );
  expect(r).toBeCloseTo(0.75, 10);
});

test("plan readiness with no weights at all is zero rather than NaN", () => {
  expect(planReadiness(new Map([["fsa", 1]]), new Map())).toBe(0);
});

test("isLearned reads the bar from tuning", () => {
  expect(isLearned(0.75, T)).toBe(true);
  expect(isLearned(0.7499, T)).toBe(false);
});

test("confidence at the trigger value makes a unit eligible to jump", () => {
  expect(
    isEligibleToJump(
      [obs({ answered: 40, correct: 38, available: 40, confidence: 1, lastTouch: NOW })],
      NOW,
      T,
    ),
  ).toBe(true);
});

test("low accuracy under the sample floor does not make a unit eligible", () => {
  expect(
    isEligibleToJump(
      [obs({ answered: 4, correct: 0, available: 50, confidence: 4, lastTouch: NOW })],
      NOW,
      T,
    ),
  ).toBe(false);
});

test("low accuracy at or above the sample floor makes a unit eligible", () => {
  expect(
    isEligibleToJump(
      [obs({ answered: 12, correct: 3, available: 50, confidence: 4, lastTouch: NOW })],
      NOW,
      T,
    ),
  ).toBe(true);
});

test("decay below the bar makes a unit eligible even when it was once mastered", () => {
  const old = obs({
    answered: 100,
    correct: 95,
    available: 100,
    confidence: 5,
    lastTouch: new Date(NOW.getTime() - 200 * DAY),
  });
  expect(isEligibleToJump([old], NOW, T)).toBe(true);
});

test("a strong, fresh unit is not eligible to jump", () => {
  const strong = obs({
    answered: 100,
    correct: 95,
    available: 100,
    confidence: 5,
    lastTouch: NOW,
  });
  expect(isEligibleToJump([strong], NOW, T)).toBe(false);
});

test("a unit never touched is not eligible to jump, because it was never read", () => {
  // Mastery is zero, which is below the bar, but an unread unit belongs to the
  // first pass. Only covered units reach the review queue at all.
  expect(isEligibleToJump([obs()], NOW, T)).toBe(false);
});

test("throws only when every mastery weight is zero", () => {
  const broken = {
    ...T,
    masteryWeightAccuracy: 0,
    masteryWeightCoverage: 0,
    masteryWeightConfidence: 0,
  };
  expect(() => mastery(obs({ answered: 1, correct: 1, lastTouch: NOW }), NOW, broken)).toThrow();
});
