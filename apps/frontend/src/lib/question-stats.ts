import type { ModuleTotals, Projection, StepPerformance } from "./types";

// Pure half of the question stats on Today rows. Rules mirror the engine:
// 80% accuracy, and adequacy measured in minutes (see the step engine design).

export const RATE_TARGET = 80;
const EPS = 1e-6;

/** Whole-number percent, or null with nothing answered. */
export function ratePercent(correct: number, answered: number): number | null {
  return answered > 0 ? Math.round((correct / answered) * 100) : null;
}

/** Integer compare, so 4 of 5 is met exactly and never lost to float rounding. */
export function rateMet(correct: number, answered: number): boolean | null {
  return answered > 0 ? correct * 100 >= RATE_TARGET * answered : null;
}

export type Stat = {
  text: string;
  /** null when there is nothing to judge yet. */
  met: boolean | null;
  /** Full sentence for screen readers and the tooltip. */
  hint: string;
};

export type QuestionStats = {
  progress: Stat;
  total: Stat | null;
  overall: Stat | null;
  round: Stat | null;
};

const q = (n: number) => `${n} question${n === 1 ? "" : "s"}`;

export function findModule(projection: Projection | undefined, readingId: string | undefined) {
  if (!projection || !readingId) return undefined;
  for (const s of projection.sections) {
    const m = s.modules.find((x) => x.readingId === readingId);
    if (m) return m;
  }
  return undefined;
}

function rateStat(label: string, correct: number, answered: number, scope: string): Stat | null {
  const p = ratePercent(correct, answered);
  if (p === null) return null;
  const met = rateMet(correct, answered) as boolean;
  return {
    text: `${label} ${p}%`,
    met,
    hint: `${scope}: ${correct} of ${answered} correct, ${p}%. ${met ? "Meets" : "Below"} the ${RATE_TARGET}% target.`,
  };
}

/**
 * The four numbers on a step 2 or 4 question row, or null when the module has
 * no performance for that step (older server, or no round yet).
 *
 * `taskExtraQ` is this task's own question count when it is an extra, else
 * null; an extra row then shows its own count rather than the round's pool.
 */
export function questionStats(
  step: 2 | 4,
  perf: StepPerformance | null | undefined,
  totals: ModuleTotals | undefined,
  s2: StepPerformance | null | undefined,
  s4: StepPerformance | null | undefined,
  taskExtraQ: number | null,
): QuestionStats | null {
  if (!perf || perf.adequateQ === undefined) return null;
  const m = perf.adequateQ;
  const extra = taskExtraQ ?? perf.extraPendingQ ?? 0;
  const met = perf.minutes >= perf.adequateMin - EPS;
  const progress: Stat = {
    text: `${perf.answered} / ${m}${extra > 0 ? ` + ${extra}` : ""}`,
    met,
    hint:
      `${q(perf.answered)} answered this round of ${m} needed` +
      (extra > 0 ? `, plus ${extra} extra to firm up the round` : "") +
      `. ${met ? "Enough time spent" : "Not yet enough time spent"}: adequate means ${perf.adequateMin} minutes of questions and answer review.`,
  };

  let total: Stat | null = null;
  let overall: Stat | null = null;
  if (totals) {
    const answered = totals.answered + totals.mockAnswered;
    const correct = totals.correct + totals.mockCorrect;
    const need = (s2?.adequateQ ?? 0) + (s2?.passed ? (s4?.adequateQ ?? 0) : 0);
    const mockNote = totals.mockAnswered > 0 ? ` includes ${q(totals.mockAnswered)} from topic mocks` : "";
    total = {
      text: `${answered} total`,
      met: need > 0 ? answered >= need : null,
      hint:
        `${q(answered)} answered across initial and review questions${mockNote ? `, and${mockNote}` : ""}. ` +
        (need > 0 ? `${need} are needed so far.` : ""),
    };
    overall = rateStat("overall", correct, answered, `Overall${mockNote ? " (incl. topic mocks)" : ""}`);
  }
  const round = rateStat("this round", perf.correct, perf.answered, `Round ${perf.round}`);
  return { progress, total, overall, round };
}
