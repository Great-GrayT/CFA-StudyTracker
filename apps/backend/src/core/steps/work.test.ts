import { describe, it, expect } from "vitest";
import { remainingWork } from "./work";
import { deriveState, type HistoryTask } from "./state";
import type { ModuleCatalog, SourceOption } from "./types";

const bank = (slug: string, questions: number | null): SourceOption => ({
  packageSlug: slug, packageId: `p-${slug}`, resourceIds: [`res-${slug}`], kind: "questions",
  minutes: 0, questions, minutesPerQuestion: 3, answerReviewPerQuestion: 1, label: slug,
});
const read = (slug: string, minutes: number): SourceOption => ({
  packageSlug: slug, packageId: `p-${slug}`, resourceIds: [], kind: "read", minutes, label: slug,
});
// s1 = 60, s3 = 20; adequate2 = 120 min (30 q at 4 min), adequate4 = 240 (60 q).
const mod = (banks: SourceOption[]): ModuleCatalog => ({
  readingId: "r1", topicId: "t1", topicOrder: 1, readingOrder: 1, examWeight: 0.1,
  options: { 1: [read("mm", 60)], 2: banks, 3: [read("mm", 20)], 4: banks },
});
let n = 0;
const task = (o: Partial<HistoryTask>): HistoryTask => ({
  id: `t${++n}`, date: "2026-01-01", kind: "read", step: null, round: null, readingIds: ["r1"],
  status: "done", minutes: 0, answered: 0, correct: 0, answerReviewDone: true, packageSlug: "uw", ...o,
});
const work = (cat: ModuleCatalog[], tasks: HistoryTask[] = []) =>
  remainingWork(cat, deriveState(cat, tasks, [], []));
const sig = (w: ReturnType<typeof work>) => w.map((i) => `${i.step}:${i.kind}:${i.minutes}`);

describe("remainingWork", () => {
  it("fresh module: read, questions, answer review, review, questions, answer review", () => {
    const w = work([mod([bank("uw", 200)])]);
    expect(sig(w)).toEqual(["1:read:60", "2:questions:90", "2:answer-review:30", "3:review:20",
      "4:questions:180", "4:answer-review:60"]);
    expect(w.every((i) => i.extraReason === null)).toBe(true);
    // dependency order
    expect(w[1].after).toContain(w[0].id);
    expect(w[2].after).toEqual([w[1].id]);
    expect(w[3].after).toEqual(expect.arrayContaining([w[1].id, w[2].id]));
    expect(w[4].after).toContain(w[3].id);
  });

  it("a bank that runs out continues on the next package as package-switch", () => {
    const w = work([mod([bank("uw", 20), bank("kaplan", 100)])]);
    const q = w.filter((i) => i.step === 2 && i.kind === "questions");
    expect(q.map((i) => [i.packageId, i.questions, i.extraReason])).toEqual([
      ["p-uw", 20, null], ["p-kaplan", 10, "package-switch"],
    ]);
  });

  it("a short bank with no unlimited source stays plannable on the last package", () => {
    const w = work([mod([bank("uw", 10)])]);
    const total = w.filter((i) => i.step === 2 && i.kind === "questions").reduce((a, i) => a + i.questions!, 0);
    expect(total).toBe(30);
  });

  it("top-up after 24/40 asks 20 questions (capped) tagged top-up-80", () => {
    const cat = [mod([bank("uw", 200)])];
    const w = work(cat, [
      task({ kind: "read", step: 1, minutes: 60 }),
      task({ kind: "questions", step: 2, minutes: 120, answered: 40, correct: 24, packageSlug: "uw" }),
    ]);
    const q = w.filter((i) => i.step === 2 && i.kind === "questions");
    expect(q).toHaveLength(1);
    expect(q[0].questions).toBe(20);
    expect(q[0].extraReason).toBe("top-up-80");
    expect(w.some((i) => i.step === 1)).toBe(false);
  });

  it("adequacy shortfall is tagged top-up-adequacy", () => {
    const w = work([mod([bank("uw", 200)])], [
      task({ kind: "questions", step: 2, minutes: 36, answered: 12, correct: 12, packageSlug: "uw" }),
    ]);
    const q = w.find((i) => i.step === 2 && i.kind === "questions")!;
    expect(q.extraReason).toBe("top-up-adequacy");
    expect(q.questions).toBe(18); // 120 - 48 = 72 min short at 4 min
  });

  it("used questions are not drawn again", () => {
    const w = work([mod([bank("uw", 40), bank("kaplan", 100)])], [
      task({ kind: "questions", step: 2, minutes: 120, answered: 30, correct: 20, packageSlug: "uw" }),
    ]);
    const q = w.filter((i) => i.step === 2 && i.kind === "questions");
    expect(q[0].packageId).toBe("p-uw");
    expect(q[0].questions).toBe(10);
    expect(q[1].extraReason).toBe("package-switch");
  });

  it("owed answer review becomes its own item", () => {
    const w = work([mod([bank("uw", 200)])], [
      task({ kind: "questions", step: 2, minutes: 90, answered: 30, correct: 27, answerReviewDone: false }),
    ]);
    const ar = w.find((i) => i.extraReason === "answer-review-owed")!;
    expect(ar.kind).toBe("answer-review");
    expect(ar.minutes).toBe(30);
    expect(w.some((i) => i.step === 2 && i.kind === "questions")).toBe(false);
  });

  it("an exemption puts a review before the fresh round", () => {
    const w = work([mod([bank("uw", 500)])], [
      task({ kind: "questions", step: 2, minutes: 180, answered: 60, correct: 40, packageSlug: "uw" }),
    ]);
    const rev = w.find((i) => i.extraReason === "exemption-review")!;
    const q = w.find((i) => i.step === 2 && i.kind === "questions")!;
    expect(q.round).toBe(2);
    expect(q.after).toContain(rev.id);
    expect(q.questions).toBe(30);
    expect(w.filter((i) => i.step === 3)).toHaveLength(1);
  });

  it("question banks are shared by step 2 and step 4 within one plan", () => {
    const w = work([mod([bank("uw", 40), bank("kaplan", 100)])]);
    const q = (s: number) => w.filter((i) => i.step === s && i.kind === "questions")
      .map((i) => [i.packageId, i.questions, i.extraReason]);
    expect(q(2)).toEqual([["p-uw", 30, null]]);
    expect(q(4)).toEqual([["p-uw", 10, null], ["p-kaplan", 50, "package-switch"]]);
  });

  it("a fresh round after an exemption never reuses questions from earlier rounds", () => {
    const w = work([mod([bank("uw", 70), bank("kaplan", 100)])], [
      task({ kind: "questions", step: 2, minutes: 180, answered: 60, correct: 40, packageSlug: "uw" }),
    ]);
    const q = w.filter((i) => i.step === 2 && i.kind === "questions");
    expect(q.map((i) => [i.packageId, i.questions])).toEqual([["p-uw", 10], ["p-kaplan", 20]]);
  });

  it("top-up is capped so the round reaches 2x adequate and trips the exemption", () => {
    const w = work([mod([bank("uw", 500)])], [
      task({ kind: "questions", step: 2, minutes: 120, answered: 40, correct: 24, packageSlug: "uw" }),
    ]);
    const q = w.find((i) => i.step === 2 && i.kind === "questions")!;
    // credited 160 min, cap 240: 20 questions at 4 min
    expect(q.questions).toBe(20);
  });

  it("a fully passed module has no work", () => {
    const w = work([mod([bank("uw", 500)])], [
      task({ kind: "read", step: 1, minutes: 60, date: "2026-01-01" }),
      task({ kind: "questions", step: 2, minutes: 90, answered: 30, correct: 27, date: "2026-01-02" }),
      task({ kind: "review", step: 3, minutes: 20, date: "2026-01-03" }),
      task({ kind: "questions", step: 4, minutes: 180, answered: 60, correct: 54, date: "2026-01-04" }),
    ]);
    expect(w).toEqual([]);
  });

  it("low-confidence step 1 is replaced by half-time review work", () => {
    const cat = [mod([bank("uw", 200)])];
    const w = remainingWork(cat, deriveState(cat, [], [{ readingId: "r1", step: 1, confidence: 2, answered: null, correct: null }], []));
    expect(w[0].kind).toBe("read");
    expect(w[0].minutes).toBe(30);
  });
});
