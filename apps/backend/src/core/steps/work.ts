import { adequateMinutes, step1Minutes } from "./catalog";
import { EPS, MIN_PER_QUESTION, topUpParts } from "./rules";
import type { ModuleState } from "./state";
import type { ModuleCatalog, SourceOption } from "./types";

export type WorkItem = {
  id: string; readingId: string; step: 1 | 2 | 3 | 4 | 5; round: number;
  kind: "read" | "questions" | "answer-review" | "review" | "mock" | "mock-review";
  minutes: number; questions?: number; packageId: string; resourceIds: string[]; label: string;
  extraReason: null | "top-up-80" | "top-up-adequacy" | "package-switch" | "exemption-review"
    | "mock-retest" | "answer-review-owed";
  after: string[]; // ids of items that must finish first
  mockRef?: string | null; // step 5 only; null = generic placeholder
};

type QState = ModuleState["s2"];

// Question demand for one round. Counts are sized with the first option's
// per-question minutes (simplest choice); a later package with other rates can
// leave a small adequacy gap, which the next rebuild tops up.
function questionItems(m: ModuleCatalog, step: 2 | 4, r: QState, retest: string | null,
  usedAll: Record<string, number>, prev: string[]): WorkItem[] {
  const opts = m.options[step];
  const adequate = adequateMinutes(m, step);
  if (!opts.length || adequate <= 0) return [];
  const rate = (o: SourceOption) => (o.minutesPerQuestion ?? MIN_PER_QUESTION) + (o.answerReviewPerQuestion ?? 1);
  const perT = rate(opts[0]);
  const credited = r.minutes + r.pendingAnswerReview; // owed review gets planned separately
  let need: number;
  let reason: WorkItem["extraReason"] = null;
  if (r.answered <= 0) {
    need = Math.ceil(Math.max(0, adequate - credited) / perT - EPS);
    if (step === 4 && retest) reason = "mock-retest";
  } else {
    const { n80, nAdq } = topUpParts({ answered: r.answered, correct: r.correct, minutes: credited, adequate, perQ: perT });
    need = Math.max(n80, nAdq);
    reason = n80 >= nAdq ? "top-up-80" : "top-up-adequacy";
  }
  if (need <= 0) return [];

  const alloc: Array<{ o: SourceOption; idx: number; n: number }> = [];
  let left = need;
  opts.forEach((o, idx) => {
    if (left <= 0) return;
    const avail = o.questions == null ? Infinity : Math.max(0, o.questions - (usedAll[o.packageSlug] ?? 0));
    const n = Math.min(left, avail);
    if (n > 0) { alloc.push({ o, idx, n }); left -= n; }
  });
  // Every bank is spent and no unlimited source is on the plan: keep it plannable
  // on the last package rather than leaving an unplannable deficit.
  if (left > 0) {
    const idx = opts.length - 1;
    const hit = alloc.find((a) => a.idx === idx);
    if (hit) hit.n += left; else alloc.push({ o: opts[idx], idx, n: left });
  }

  const out: WorkItem[] = [];
  alloc.forEach(({ o, idx, n }, i) => {
    const id = `${m.readingId}:s${step}:r${r.round}:q${i}`;
    const why = idx > 0 ? "package-switch" : reason;
    out.push({
      id, readingId: m.readingId, step, round: r.round, kind: "questions",
      minutes: n * (o.minutesPerQuestion ?? MIN_PER_QUESTION), questions: n, packageId: o.packageId,
      resourceIds: o.resourceIds, label: o.label, extraReason: why, after: [...prev],
    });
    out.push({
      id: `${id}:ar`, readingId: m.readingId, step, round: r.round, kind: "answer-review",
      minutes: n * (o.answerReviewPerQuestion ?? 1), questions: n, packageId: o.packageId,
      resourceIds: o.resourceIds, label: `${o.label} answer review`, extraReason: why, after: [id],
    });
  });
  return out;
}

function pendingReview(m: ModuleCatalog, step: 2 | 4, r: QState): WorkItem[] {
  if (r.pendingAnswerReview <= EPS) return [];
  const o = m.options[step][0];
  return [{
    id: `${m.readingId}:s${step}:r${r.round}:ar-owed`, readingId: m.readingId, step, round: r.round,
    kind: "answer-review", minutes: r.pendingAnswerReview, packageId: o?.packageId ?? "",
    resourceIds: o?.resourceIds ?? [], label: `${o?.label ?? "questions"} answer review owed`,
    extraReason: "answer-review-owed", after: [],
  }];
}

export function remainingWork(cat: ModuleCatalog[], state: Map<string, ModuleState>): WorkItem[] {
  const out: WorkItem[] = [];
  for (const m of cat) {
    const st = state.get(m.readingId);
    if (!st) continue;
    const mine: WorkItem[] = [];
    const ids = () => mine.map((i) => i.id);

    // Step 1, or its half-time replacement after a low-confidence self-state.
    const s1 = step1Minutes(m);
    if (!st.s1.done && s1 > 0) {
      const src = st.s1.lowConfidence ? (m.options[3][0] ?? m.options[1][0]) : m.options[1][0];
      const target = (st.s1.lowConfidence ? 0.5 : 1) * s1;
      mine.push({
        id: `${m.readingId}:s1:read`, readingId: m.readingId, step: 1, round: 1, kind: "read",
        minutes: Math.max(0, target - st.s1.doneMin), packageId: src.packageId,
        resourceIds: src.resourceIds, label: src.label, extraReason: null, after: [],
      });
    }

    const o3 = m.options[3][0];
    const reviewItem = (suffix: string, minutes: number, reason: WorkItem["extraReason"]): WorkItem => ({
      id: `${m.readingId}:s3:${suffix}`, readingId: m.readingId, step: 3, round: 1, kind: "review",
      minutes, packageId: o3.packageId, resourceIds: o3.resourceIds, label: o3.label,
      extraReason: reason, after: ids(),
    });
    const owedReason = st.mockRetestFrom ? "mock-retest" : "exemption-review";
    const owedItems = (from: number) => {
      const res: WorkItem[] = [];
      if (!o3) return res;
      for (let i = 0; i < st.s3.owed; i++) res.push(reviewItem(`owed${from + i}`, o3.minutes, owedReason));
      return res;
    };

    // An exemption from step 2 sends the learner through review before the fresh round.
    if (!st.s2.passed && o3) for (const it of owedItems(0)) { mine.push(it); it.after = ids().filter((x) => x !== it.id); }

    const used = { ...st.s2.usedByPackage };
    for (const [k, v] of Object.entries(st.s4.usedByPackage)) used[k] = (used[k] ?? 0) + v;

    mine.push(...pendingReview(m, 2, st.s2));
    if (!st.s2.passed) {
      const prev = ids().filter((x) => !x.endsWith(":ar-owed"));
      mine.push(...questionItems(m, 2, st.s2, null, used, prev));
    }

    if (o3) {
      const baseRem = Math.max(0, o3.minutes - st.s3.doneMin);
      if (baseRem > EPS) mine.push(reviewItem("base", baseRem, null));
      if (st.s2.passed) for (const it of owedItems(0)) { mine.push(it); it.after = ids().filter((x) => x !== it.id); }
    }

    mine.push(...pendingReview(m, 4, st.s4));
    if (!st.s4.passed) {
      const prev = ids().filter((x) => !x.endsWith(":ar-owed"));
      mine.push(...questionItems(m, 4, st.s4, st.mockRetestFrom, used, prev));
    }
    out.push(...mine);
  }
  return out;
}
