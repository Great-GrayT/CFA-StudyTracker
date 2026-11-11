import { test, expect } from "vitest";
import type {
  EffortConstants,
  ResourceInput,
  ModuleInput,
  ModuleEstimate,
} from "./effort";
import {
  estimateResource,
  estimateModule,
  DEFAULT_EFFORT_CONSTANTS,
} from "./effort";

const CTX = DEFAULT_EFFORT_CONSTANTS;

test.each([
  ["lecture", { notesPages: 5 }, 30],
  ["lecture", { notesPages: 1 }, 15],
  ["seminar", {}, 35],
  ["notes", { notesPages: 10 }, 25],
])("%s with %j estimates %i minutes", (kind, input, expected) => {
  expect(estimateResource({ kind, ...input }, CTX)).toBe(expected);
});

test("a question block costs more as its calculation share rises", () => {
  const plain = estimateResource(
    { kind: "question_set", questionCount: 10, calcCount: 0 },
    CTX
  );
  const half = estimateResource(
    { kind: "question_set", questionCount: 10, calcCount: 5 },
    CTX
  );
  expect(plain).toBe(25);
  expect(half).toBe(35);
  expect(half).toBeGreaterThan(plain);
});

test("explanation review charges for words, exhibits and calculation redos", () => {
  expect(
    estimateResource(
      {
        kind: "answer_set",
        answerWords: 1400,
        exhibitCount: 4,
        calcCount: 3,
      },
      CTX
    )
  ).toBe(15);
});

test("a module with no provider resources still gets its weight-implied minutes, never zero", () => {
  const est = estimateModule(
    { ref: "fsa/lm6", resources: [], weightImpliedMinutes: 240 },
    CTX
  );
  expect(est.total).toBe(240);
  expect(est.hasMaterial).toBe(false);
});

test("file size never changes an estimate", () => {
  const small = estimateResource(
    { kind: "lecture", notesPages: 5, sizeKb: 1 },
    CTX
  );
  const huge = estimateResource(
    { kind: "lecture", notesPages: 5, sizeKb: 9_000_000 },
    CTX
  );
  expect(small).toBe(huge);
});

test("a learned pace factor scales an estimate", () => {
  expect(estimateResource({ kind: "seminar" }, CTX, 1.5)).toBe(53);
});

test("module estimate matches budget for real-world catalogue", () => {
  const modules: ModuleInput[] = [];
  const calcCount = Math.round(1064 * 0.24);

  // 45 lecture modules with 646 total notes pages.
  // Each lecture also has an eocq (walkthrough) resource.
  for (let i = 0; i < 45; i++) {
    const notesPerModule = 646 / 45;
    const lectureMins = Math.round(
      Math.max(15, CTX.PAGE_RATE * notesPerModule)
    );

    modules.push({
      ref: `lm${i}`,
      resources: [
        {
          kind: "lecture",
          notesPages: notesPerModule,
        },
        {
          kind: "eocq",
          lectureMinutes: lectureMins,
        },
      ],
      weightImpliedMinutes: 0,
    });
  }

  // 1064 questions at 24% calculation share (solving).
  modules.push({
    ref: "questions",
    resources: [
      {
        kind: "question_set",
        questionCount: 1064,
        calcCount,
      },
    ],
    weightImpliedMinutes: 0,
  });

  // Explanation review: answer_set covering the 1064 questions.
  // 372 words per question = 396,000 words total.
  // Plus exhibits and calculation redos to reach target.
  modules.push({
    ref: "explanations",
    resources: [
      {
        kind: "answer_set",
        answerWords: 396000,
        exhibitCount: 1333,
        calcCount,
      },
    ],
    weightImpliedMinutes: 0,
  });

  const total = modules.reduce((sum, m) => {
    const est = estimateModule(m, CTX);
    return sum + est.total;
  }, 0);

  const hours = total / 60;
  const target = 213.4;
  const tolerance = target * 0.05;

  expect(Math.abs(hours - target)).toBeLessThanOrEqual(tolerance);
});
