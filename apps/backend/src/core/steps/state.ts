import { adequateMinutes, step1Minutes } from "./catalog";
import { DEFAULT_RULES, EPS, MIN_PER_QUESTION, roundOutcome } from "./rules";
import type { ModuleCatalog, RoundState, StepNo } from "./types";

export type { RoundState } from "./types";

export type HistoryTask = {
  id: string; date: string; kind: string; step: number | null; round: number | null;
  readingIds: string[]; status: "done" | "partial" | "pending"; minutes: number;
  // Planned minutes; a partial task is credited min(minutes, estimateMinutes).
  estimateMinutes?: number;
  answered: number; correct: number; answerReviewDone: boolean; packageSlug: string | null;
};
export type Declaration = {
  readingId: string; step: StepNo; confidence: number | null; answered: number | null; correct: number | null;
  /** YYYY-MM-DD the stated work was done; it enters the history on that day. */
  date: string;
};
export type MockResult = { date: string; topicScores: Array<{ topicId: string; answered: number; correct: number }> };

export type ModuleState = {
  readingId: string;
  s1: { doneMin: number; done: boolean; lowConfidence: boolean };
  s2: RoundState & { passed: boolean; pendingAnswerReview: number };
  s3: { doneMin: number; done: boolean; owed: number };
  s4: RoundState & { passed: boolean; pendingAnswerReview: number };
  mockRetestFrom: string | null;
};

type Round = RoundState & { passed: boolean; pendingAnswerReview: number };
type Work = {
  m: ModuleCatalog;
  s1Min: number; lowConf: boolean;
  s3Min: number; s3Req: number; s3Target: number; s3Trig: boolean;
  s2: Round; s4: Round; lastQStep: 2 | 4; retest: string | null;
};

// Question usage is cumulative across rounds: a fresh set is brand new questions.
const freshRound = (round: number, pending = 0, used: Record<string, number> = {}): Round =>
  ({ round, answered: 0, correct: 0, minutes: 0, usedByPackage: { ...used }, passed: false, pendingAnswerReview: pending });

// Old-kind rows (step null) predate the engine; see spec Builder answer 1.
const OLD_STEP1 = new Set(["content-notes", "content-video", "seminar", "eocq"]);

function s3Done(w: Work) { return w.s3Target <= 0 || w.s3Min >= w.s3Req - EPS; }

// Each trigger demands one more full review on top of whatever is already done.
// While the base review is still undone it is that review, so none is added.
function owe(w: Work) {
  if (w.s3Min < w.s3Target - EPS) { w.s3Trig = true; return; }
  w.s3Req = Math.max(w.s3Req, w.s3Min) + w.s3Target;
}

function reviewPerQ(m: ModuleCatalog, step: 2 | 4, slug: string | null): number {
  const opts = m.options[step];
  const o = opts.find((x) => x.packageSlug === slug) ?? opts[0];
  return o?.answerReviewPerQuestion ?? MIN_PER_QUESTION / 3;
}

// Exemption starts a fresh round (and owes a review); pass is sticky.
function evaluate(w: Work, step: 2 | 4) {
  const r = step === 2 ? w.s2 : w.s4;
  if (r.passed) return;
  const adequate = adequateMinutes(w.m, step);
  const rl = w.m.rules ?? DEFAULT_RULES;
  const out = roundOutcome(r, adequate, rl.accuracyTarget / 100, rl.exemptionMultiplier);
  if (out === "pass") {
    r.passed = true;
    if (step === 4) w.retest = null;
  } else if (out === "exemption") {
    owe(w);
    const fresh = freshRound(r.round + 1, r.pendingAnswerReview, r.usedByPackage);
    if (step === 2) w.s2 = fresh; else w.s4 = fresh;
  }
}

function addQuestions(w: Work, step: 2 | 4, answered: number, correct: number, answerMin: number,
  reviewMin: number, reviewDone: boolean, slug: string | null) {
  const r = step === 2 ? w.s2 : w.s4;
  r.answered += answered;
  r.correct += correct;
  r.minutes += answerMin;
  const key = slug ?? "unknown";
  r.usedByPackage[key] = (r.usedByPackage[key] ?? 0) + answered;
  if (reviewDone) r.minutes += reviewMin; else r.pendingAnswerReview += reviewMin;
  w.lastQStep = step;
  evaluate(w, step);
}

export function deriveState(
  cat: ModuleCatalog[], tasks: HistoryTask[], decls: Declaration[], mocks: MockResult[],
): Map<string, ModuleState> {
  const works = new Map<string, Work>();
  for (const m of cat) {
    const o3 = m.options[3][0]?.minutes ?? 0;
    works.set(m.readingId, {
      m, s1Min: 0, lowConf: false, s3Min: 0, s3Req: o3, s3Target: o3, s3Trig: false,
      s2: freshRound(1), s4: freshRound(1), lastQStep: 2, retest: null,
    });
  }
  const s1Need = (w: Work) => (w.lowConf ? 0.5 : 1) * step1Minutes(w.m);
  const s1Done = (w: Work) => step1Minutes(w.m) <= 0 || w.s1Min >= s1Need(w) - EPS;

  // Declared declaration counts become round attempts at the first option's rates.
  const applyDecl = (d: Declaration) => {
    const w = works.get(d.readingId);
    if (!w) return;
    if (d.step === 1) {
      if (d.confidence !== null && d.confidence <= 2) w.lowConf = true;
      else w.s1Min = Math.max(w.s1Min, step1Minutes(w.m));
    } else if (d.step === 3) {
      if (!s1Done(w)) return; // cannot be stated before step 1
      w.s3Min = Math.max(w.s3Min, w.s3Target);
    } else {
      const step = d.step as 2 | 4;
      if (step === 4 && !w.s2.passed) return;
      const r = step === 2 ? w.s2 : w.s4;
      if (r.passed) return;
      if (d.answered === null) { r.passed = true; return; }
      const o = w.m.options[step][0];
      const perQ = (o?.minutesPerQuestion ?? MIN_PER_QUESTION) + (o?.answerReviewPerQuestion ?? MIN_PER_QUESTION / 3);
      // Declared work includes its answer review, so none is owed.
      addQuestions(w, step, d.answered, d.correct ?? 0, d.answered * perQ, 0, true, o?.packageSlug ?? null);
    }
  };

  // One chronological stream. On a shared day a stated step comes before recorded work, which comes
  // before mocks, and stated steps run in step order so a later step finds its predecessor done.
  type Ev = { date: string; kind: "decl" | "task" | "mock"; decl?: Declaration; task?: HistoryTask; mock?: MockResult };
  const rank = { decl: 0, task: 1, mock: 2 } as const;
  const events: Ev[] = ([
    ...decls.map((d) => ({ date: d.date, kind: "decl" as const, decl: d })),
    ...tasks.filter((t) => t.status !== "pending").map((t) => ({ date: t.date, kind: "task" as const, task: t })),
    ...mocks.map((mk) => ({ date: mk.date, kind: "mock" as const, mock: mk })),
  ] as Ev[]).sort((a, b) => a.date.localeCompare(b.date) || rank[a.kind] - rank[b.kind]
    || (a.decl && b.decl ? a.decl.step - b.decl.step || a.decl.readingId.localeCompare(b.decl.readingId) : 0)
    || (a.task && b.task ? a.task.id.localeCompare(b.task.id) : 0));

  // Rules are per plan, so any module carries them.
  const mockTarget = (cat[0]?.rules ?? DEFAULT_RULES).mockPassTarget / 100;
  for (const ev of events) {
    if (ev.kind === "decl") {
      applyDecl(ev.decl!);
      continue;
    }
    if (ev.kind === "mock") {
      for (const sc of ev.mock!.topicScores) {
        if (sc.answered <= 0 || sc.correct / sc.answered >= mockTarget - EPS) continue;
        for (const w of works.values()) {
          if (w.m.topicId !== sc.topicId) continue;
          owe(w);
          // An untouched open round simply continues as the retest.
          if (w.s4.passed || w.s4.answered > 0) {
            w.s4 = freshRound(w.s4.round + 1, w.s4.pendingAnswerReview, w.s4.usedByPackage);
          }
          w.retest = ev.date;
        }
      }
      continue;
    }
    const t = ev.task!;
    const n = t.readingIds.length;
    if (!n) continue;
    const credit = t.status === "partial" ? Math.min(t.minutes, t.estimateMinutes ?? t.minutes) : t.minutes;
    for (const id of t.readingIds) {
      const w = works.get(id);
      if (!w) continue;
      const min = credit / n, ans = t.answered / n, cor = t.correct / n;
      const isQ = t.kind === "questions";
      const isAR = t.kind === "answer-review";
      let step: number | null = t.step;
      if (step === null) {
        if (OLD_STEP1.has(t.kind) || t.kind === "read") step = 1;
        else if (t.kind === "review") step = 3;
        else if (isQ) step = w.s2.passed && s3Done(w) ? 4 : 2;
        else if (isAR) step = w.lastQStep;
      }
      if (step === 1 && !isQ && !isAR) w.s1Min += min;
      else if (step === 3) w.s3Min += min;
      else if ((step === 2 || step === 4) && isQ) {
        const q = step as 2 | 4;
        const rev = ans > 0 ? ans * reviewPerQ(w.m, q, t.packageSlug) : min / 3;
        addQuestions(w, q, ans, cor, min, rev, t.answerReviewDone, t.packageSlug);
      } else if ((step === 2 || step === 4) && isAR) {
        const r = step === 2 ? w.s2 : w.s4;
        r.minutes += min;
        r.pendingAnswerReview = Math.max(0, r.pendingAnswerReview - min);
        w.lastQStep = step;
        evaluate(w, step);
      }
    }
  }

  const out = new Map<string, ModuleState>();
  for (const w of works.values()) {
    const target = w.s3Target;
    // owed counts extra reviews: outstanding whole reviews minus the base one if undone.
    const outstanding = Math.max(0, w.s3Req - w.s3Min);
    // Reviews beyond the base one, plus the base itself when a trigger made it the owed review.
    const baseUndone = w.s3Min < target - EPS;
    const owed = target > 0
      ? Math.max(0, Math.ceil(outstanding / target - EPS) - (baseUndone ? 1 : 0)) + (baseUndone && w.s3Trig ? 1 : 0)
      : 0;
    out.set(w.m.readingId, {
      readingId: w.m.readingId,
      s1: { doneMin: w.s1Min, done: s1Done(w), lowConfidence: w.lowConf },
      s2: { ...w.s2 },
      s3: { doneMin: w.s3Min, done: s3Done(w), owed },
      s4: { ...w.s4 },
      mockRetestFrom: w.retest,
    });
  }
  return out;
}
