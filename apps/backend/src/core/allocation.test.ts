import { test, expect } from "vitest";
import type { TopicEstimate, AllocationResult, TrimRecord } from "./allocation";
import { weightImpliedMinutes, allocate } from "./allocation";

// Helper to create a topic fixture.
function topic(
  key: string,
  opts: {
    weightMid: number;
    estimateMinutes: number;
    notes?: number;
    review?: number;
    questions?: number;
    other?: number;
    moduleCount?: number;
  }
): TopicEstimate {
  const notes = opts.notes ?? 0;
  const review = opts.review ?? 0;
  const questions = opts.questions ?? 0;
  const other = opts.other ?? 0;
  const specified = notes + review + questions + other;
  const remaining = Math.max(0, opts.estimateMinutes - specified);

  return {
    key,
    weightMid: opts.weightMid,
    estimateMinutes: opts.estimateMinutes,
    noteMinutes: notes,
    reviewMinutes: review,
    questionMinutes: questions,
    otherMinutes: other + remaining,
    moduleCount: opts.moduleCount ?? 1,
  };
}

test("weightImpliedMinutes: weightMid 10 in a 1000 minute plan gives 100 minutes", () => {
  const cap = weightImpliedMinutes(10, 1000);
  expect(cap).toBe(100);
});

test("a topic at its weight share is untouched", () => {
  const r = allocate([topic("qm", { weightMid: 10, estimateMinutes: 100 })], 1000);
  expect(r.trimmed).toEqual([]);
  expect(r.byTopic.get("qm")!.minutes).toBe(100);
});

test("an over-served topic is trimmed to its share and the surplus is reported", () => {
  const r = allocate(
    [
      topic("eq", {
        weightMid: 10,
        estimateMinutes: 137,
        notes: 20,
        review: 10,
        questions: 60,
      }),
    ],
    1000
  );
  expect(r.byTopic.get("eq")!.minutes).toBe(100);
  expect(r.surplusMinutes).toBe(37);
});

test("trimming takes notes first, then review video, then questions", () => {
  const r = allocate(
    [
      topic("eq", {
        weightMid: 10,
        estimateMinutes: 137,
        notes: 20,
        review: 10,
        questions: 60,
      }),
    ],
    1000
  );
  expect(r.trimmed.map((t) => t.layer)).toEqual(["notes", "review", "questions"]);
  expect(r.trimmed.find((t) => t.layer === "notes")!.minutes).toBe(20);
});

test("a topic never loses all of its practice, however over-served", () => {
  // cap = 1, estimate = 1000, floor = 36 * 10 = 360.
  // Trim order: notes (50) then review (50) then questions (540).
  // Result: noteMinutes=0, reviewMinutes=0, questionMinutes=360.
  const r = allocate(
    [
      topic("eq", {
        weightMid: 1,
        estimateMinutes: 1000,
        notes: 50,
        review: 50,
        questions: 900,
        moduleCount: 10,
      }),
    ],
    100
  );
  const eq = r.byTopic.get("eq")!;
  expect(eq.noteMinutes).toBe(0);
  expect(eq.reviewMinutes).toBe(0);
  expect(eq.questionMinutes).toBe(360);
  expect(eq.minutes).toBe(360);
  expect(r.trimmed.some((t) => t.layer === "questions")).toBe(true);
  // Floor overflow must be recorded so the plan can explain why it kept material.
  const floorRecord = r.trimmed.find((t) => t.topic === "eq" && t.layer === "questions");
  expect(floorRecord).toBeDefined();
  expect(floorRecord!.reason).toMatch(/floor/i);
});

test("other-layer minutes are trimmed too: a topic cannot exceed its cap even when other alone exceeds it", () => {
  // notes/review/questions are all 0 here; only trimming "other" itself
  // can bring the topic back under cap. Without that fourth trim layer
  // this topic's total would land at 500, well above its 100-minute cap.
  const r = allocate(
    [topic("eq", { weightMid: 10, estimateMinutes: 500, other: 500 })],
    1000
  );
  const eq = r.byTopic.get("eq")!;
  expect(eq.minutes).toBeLessThanOrEqual(100);
  expect(eq.otherMinutes).toBe(100);
  expect(r.trimmed.some((t) => t.layer === "other")).toBe(true);
});

test("an under-served topic is not padded", () => {
  const r = allocate(
    [topic("eth", { weightMid: 10, estimateMinutes: 60 })],
    1000
  );
  expect(r.byTopic.get("eth")!.minutes).toBe(60);
});

test("real exam misallocations are corrected: Equities 1.37x, Ethics 0.72x", () => {
  // Exam weights sum to 100. Equities gets 20%, Ethics gets 10%, others split remainder.
  // But material availability is skewed: Equities ships 1.37x its share, Ethics only 0.72x.
  // Total plan minutes are 10,000.
  const eq_weight = 20; // exam weight
  const eth_weight = 10;
  const eq_estimate = Math.round(eq_weight * 1000 * 1.37); // 2740
  const eth_estimate = Math.round(eth_weight * 1000 * 0.72); // 720
  const quant_weight = 20;
  const quant_estimate = Math.round(quant_weight * 1000 * 1.25); // 2500
  const econ_weight = 50;
  const econ_estimate = Math.round(econ_weight * 1000 * 0.75); // 3750

  const topics = [
    topic("eq", {
      weightMid: eq_weight,
      estimateMinutes: eq_estimate,
      questions: eq_estimate,
      moduleCount: 5,
    }),
    topic("eth", {
      weightMid: eth_weight,
      estimateMinutes: eth_estimate,
      questions: eth_estimate,
      moduleCount: 2,
    }),
    topic("quant", {
      weightMid: quant_weight,
      estimateMinutes: quant_estimate,
      questions: quant_estimate,
      moduleCount: 5,
    }),
    topic("econ", {
      weightMid: econ_weight,
      estimateMinutes: econ_estimate,
      questions: econ_estimate,
      moduleCount: 10,
    }),
    // Alt: all of its material sits in "other" (e.g. seminars), and that
    // alone ships 10x its weight share. Every other topic above routes
    // its surplus through notes/review/questions, so without this fixture
    // the loop below would never exercise the other-layer trim at all.
    topic("alt", {
      weightMid: 5,
      estimateMinutes: 5000,
      other: 5000,
      moduleCount: 1,
    }),
  ];

  const totalMinutes = 10000;
  const r = allocate(topics, totalMinutes);

  // After allocation, no topic should exceed its weight share.
  for (const topic_input of topics) {
    const allocated = r.byTopic.get(topic_input.key)!;
    const cap = weightImpliedMinutes(topic_input.weightMid, totalMinutes);
    expect(allocated.minutes).toBeLessThanOrEqual(cap + 0.1); // Allow tiny floating point slack.
  }

  // Surplus should exist because Equities is over and will be trimmed.
  expect(r.surplusMinutes).toBeGreaterThan(0);
});
