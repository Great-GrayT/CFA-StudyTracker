import { adequateMinutes, step1Minutes } from "./catalog";
import { DEFAULT_RULES, EPS, MIN_PER_QUESTION, topUpParts } from "./rules";
import type { ModuleState } from "./state";
import type { ModuleCatalog, SourceOption } from "./types";

/** Work added because of under-performance or skipped answer review. Normal supply, such as the next package's bank, is not an extra. */
export type ExtraReason = "top-up-80" | "top-up-adequacy" | "exemption-review" | "mock-retest" | "answer-review-owed";
export const EXTRA_REASONS: ReadonlySet<string> = new Set<ExtraReason>([
  "top-up-80", "top-up-adequacy", "exemption-review", "mock-retest", "answer-review-owed",
]);

export type WorkItem = {
  id: string; readingId: string; step: 1 | 2 | 3 | 4 | 5; round: number;
  kind: "read" | "questions" | "answer-review" | "review" | "mock" | "mock-review";
  minutes: number; questions?: number; packageId: string; resourceIds: string[]; label: string;
  extraReason: ExtraReason | null;
  after: string[]; // ids of items that must finish first
  mockRef?: string | null; // step 5 only; null = generic placeholder
};

type QState = ModuleState["s2"];

const rate = (o: SourceOption) => (o.minutesPerQuestion ?? MIN_PER_QUESTION) + (o.answerReviewPerQuestion ?? 1);
const bankLeft = (o: SourceOption, used: Record<string, number>) =>
  o.questions == null ? Infinity : Math.max(0, o.questions - (used[o.packageSlug] ?? 0));

type Alloc = { o: SourceOption; idx: number; n: number };

/**
 * Spreads a question demand over the packages in priority order. The adequacy part is sized in
 * minutes at each package's own rate, so a cheaper package later in the list asks for more
 * questions rather than leaving a gap the next rebuild would chase one question at a time.
 * `n80` is the accuracy part, in questions. `roomMin` caps the total so the round stops at the
 * exemption point, never below one question.
 */
export function allocateQuestions(
  opts: SourceOption[], used: Record<string, number>, n80: number, shortMin: number, roomMin = Infinity,
): Alloc[] {
  const alloc: Alloc[] = [];
  let short = shortMin, n80Left = n80, room = roomMin;
  const done = () => short <= EPS && n80Left <= 0;
  opts.forEach((o, idx) => {
    if (done()) return;
    const r = rate(o);
    const cap = r > 0 ? Math.floor(room / r + EPS) : Infinity;
    const n = Math.min(bankLeft(o, used), cap, Math.max(r > 0 ? Math.ceil(short / r - EPS) : 0, n80Left));
    if (n <= 0) return;
    alloc.push({ o, idx, n });
    short -= n * r; n80Left -= n; room -= n * r;
  });
  // Every bank is spent (or the room is gone) and no unlimited source is on the plan: keep it
  // plannable on the last package rather than leaving an unplannable deficit.
  if (!done() && opts.length && (alloc.length === 0 || room > EPS)) {
    const idx = opts.length - 1;
    const r = rate(opts[idx]!);
    let n = Math.max(r > 0 ? Math.ceil(short / r - EPS) : 0, n80Left);
    if (alloc.length === 0) n = Math.max(1, Math.min(n, Math.max(1, Math.floor(room / r + EPS))));
    else n = Math.min(n, Math.max(0, Math.floor(room / r + EPS)));
    if (n > 0) {
      const hit = alloc.find((a) => a.idx === idx);
      if (hit) hit.n += n; else alloc.push({ o: opts[idx]!, idx, n });
    }
  }
  return alloc;
}

type StepState = ModuleState["s2"];
const stepUsed = (st: ModuleState) => {
  const used = { ...st.s2.usedByPackage };
  for (const [k, v] of Object.entries(st.s4.usedByPackage)) used[k] = (used[k] ?? 0) + v;
  return used;
};

/** Questions the current round still needs for adequacy alone (accuracy ignored), per-package sized. */
export function adequacyNeeded(m: ModuleCatalog, step: 2 | 4, st: ModuleState): number {
  const r: StepState = step === 2 ? st.s2 : st.s4;
  const adequate = adequateMinutes(m, step);
  if (!m.options[step].length || adequate <= 0 || r.passed) return 0;
  const short = Math.max(0, adequate - (r.minutes + r.pendingAnswerReview));
  return allocateQuestions(m.options[step], stepUsed(st), 0, short).reduce((a, x) => a + x.n, 0);
}

/**
 * The question count that makes this round adequate: answered plus what adequacy still needs, or
 * once passed, the base count (never more than was answered). A fresh round gives the planned count.
 */
export function adequateQuestionCount(m: ModuleCatalog, step: 2 | 4, st: ModuleState): number {
  const r: StepState = step === 2 ? st.s2 : st.s4;
  const o = m.options[step][0];
  const adequate = adequateMinutes(m, step);
  if (!o || adequate <= 0) return 0;
  if (r.passed) return Math.min(r.answered, Math.ceil(adequate / rate(o) - EPS));
  return r.answered + adequacyNeeded(m, step, st);
}

// Question demand for one round, sized in minutes per allocated package (see allocateQuestions).
function questionItems(m: ModuleCatalog, step: 2 | 4, r: QState, retest: string | null,
  used: Record<string, number>, prev: string[]): WorkItem[] {
  const opts = m.options[step];
  const adequate = adequateMinutes(m, step);
  const rl = m.rules ?? DEFAULT_RULES;
  if (!opts.length || adequate <= 0) return [];
  const credited = r.minutes + r.pendingAnswerReview; // owed review gets planned separately
  let alloc: Alloc[];
  let reason: ExtraReason | null = null;
  if (r.answered <= 0) {
    alloc = allocateQuestions(opts, used, 0, Math.max(0, adequate - credited));
    if (step === 4 && retest) reason = "mock-retest";
  } else {
    const perT = rate(opts[0]!);
    const { n80, nAdq } = topUpParts({ answered: r.answered, correct: r.correct, minutes: credited, adequate, perQ: perT }, rl.accuracyTarget / 100);
    // Past the exemption multiple of adequate minutes the exemption applies, so plan only up to that point.
    alloc = allocateQuestions(opts, used, n80, Math.max(0, adequate - credited), Math.max(0, rl.exemptionMultiplier * adequate - credited));
    reason = n80 >= nAdq ? "top-up-80" : "top-up-adequacy";
  }
  if (alloc.length === 0) return [];

  for (const a of alloc) used[a.o.packageSlug] = (used[a.o.packageSlug] ?? 0) + a.n;

  const out: WorkItem[] = [];
  alloc.forEach(({ o, idx, n }, i) => {
    const id = `${m.readingId}:s${step}:r${r.round}:q${i}`;
    const why = reason;
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
    const baseRem = o3 ? Math.max(0, o3.minutes - st.s3.doneMin) : 0;
    // An undone base review is itself the owed one; only the rest are extra items.
    const baseOwed = baseRem > EPS && st.s3.owed > 0;
    const owedBlock = () => {
      if (!o3) return;
      const res: WorkItem[] = [];
      if (baseOwed) res.push(reviewItem("base", baseRem, owedReason));
      for (let i = 0; i < st.s3.owed - (baseOwed ? 1 : 0); i++) res.push(reviewItem(`owed${i}`, o3.minutes, owedReason));
      for (const it of res) { mine.push(it); it.after = ids().filter((x) => x !== it.id); }
    };

    // An exemption from step 2 sends the learner through review before the fresh round.
    const reviewFirst = !st.s2.passed && !!o3 && st.s3.owed > 0;
    if (reviewFirst) owedBlock();

    const used = { ...st.s2.usedByPackage };
    for (const [k, v] of Object.entries(st.s4.usedByPackage)) used[k] = (used[k] ?? 0) + v;

    mine.push(...pendingReview(m, 2, st.s2));
    if (!st.s2.passed) {
      const prev = ids().filter((x) => !x.endsWith(":ar-owed"));
      mine.push(...questionItems(m, 2, st.s2, null, used, prev));
    }

    if (o3 && !reviewFirst) {
      if (baseRem > EPS && !baseOwed) mine.push(reviewItem("base", baseRem, null));
      owedBlock();
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
