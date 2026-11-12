// Pure mastery engine. No DB, no HTTP, no framework.
// Turns logged work into one number per learning outcome, so "learned" stops
// being a tick against a reading and becomes a quantity that can be compared,
// ranked and decayed.

import type { Tuning } from "./tuning";

export type MasteryObservation = {
  losId: string;
  answered: number; // questions attempted against this outcome
  correct: number; // of those, how many were right
  available: number; // question stock that exists for this outcome
  confidence: number | null; // the candidate's own 1 to 5 rating, if given
  lastTouch: Date | null; // when this outcome was last worked
  questionMinutes: number; // how much practice this outcome is worth, for weighting
};

/**
 * Mastery of one learning outcome, in [0, 1].
 *
 * M = r * (wa * a + wc * c + ws * s) where
 *   a = (correct + 1) / (answered + 2)      Laplace-smoothed accuracy
 *   c = min(1, answered / available)        coverage of the question stock
 *   s = (confidence - 1) / 4                the 1 to 5 rating on 0 to 1
 *   r = min(1, exp(-ln2 * days / halfLife)) freshness, a true half-life
 *
 * Two things the arithmetic alone would get wrong:
 *
 * Laplace smoothing is what stops two correct answers out of two reading as
 * perfect mastery, but it also hands an outcome with NO evidence an accuracy
 * of 1/2, which would make never-touched material look fresher than material
 * practised badly. So an outcome with nothing logged is exactly zero, decided
 * before any arithmetic runs.
 *
 * Freshness is clamped at 1 because a log dated in the future (clock skew, or
 * a candidate back-dating an entry) gives negative elapsed days, and
 * exp(-ln2 * negative / h) exceeds 1, which would let M exceed its own
 * weighted sum.
 */
export function mastery(obs: MasteryObservation, asOf: Date, t: Tuning): number {
  const weightSum =
    t.masteryWeightAccuracy + t.masteryWeightCoverage + t.masteryWeightConfidence;
  if (weightSum <= 0) {
    throw new Error(
      "mastery: every weight is zero, so there is no number to compute. parseTuning normalises these; a hand-built Tuning must not zero all three.",
    );
  }

  if (obs.answered <= 0 && obs.lastTouch === null) return 0;

  const a = (obs.correct + 1) / (obs.answered + 2);
  const c = obs.available > 0 ? Math.min(1, obs.answered / obs.available) : 0;
  const s = obs.confidence === null ? 0 : (obs.confidence - 1) / 4;

  const days = obs.lastTouch === null
    ? 0
    : (asOf.getTime() - obs.lastTouch.getTime()) / 86_400_000;
  const r = Math.min(1, Math.exp((-Math.LN2 * days) / t.masteryHalfLifeDays));

  const raw =
    t.masteryWeightAccuracy * a +
    t.masteryWeightCoverage * c +
    t.masteryWeightConfidence * s;

  return r * (raw / weightSum);
}

/**
 * Mastery of a unit: the question-minute-weighted mean of its outcomes, so a
 * long outcome counts for more than a short one.
 *
 * Outcomes that all carry zero question minutes fall back to a plain mean.
 * The alternative, returning zero, would report a unit with no recorded
 * question stock as unlearned however well the candidate had done on it.
 */
export function masteryOfUnit(
  obs: MasteryObservation[],
  asOf: Date,
  t: Tuning,
): number {
  if (obs.length === 0) return 0;

  const totalMinutes = obs.reduce((sum, o) => sum + Math.max(0, o.questionMinutes), 0);
  if (totalMinutes <= 0) {
    return obs.reduce((sum, o) => sum + mastery(o, asOf, t), 0) / obs.length;
  }

  const weighted = obs.reduce(
    (sum, o) => sum + mastery(o, asOf, t) * Math.max(0, o.questionMinutes),
    0,
  );
  return weighted / totalMinutes;
}

/** Mastery per topic area, using the same question-minute weighting. */
export function masteryByTopic(
  byTopic: Map<string, MasteryObservation[]>,
  asOf: Date,
  t: Tuning,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [key, obs] of byTopic) {
    result.set(key, masteryOfUnit(obs, asOf, t));
  }
  return result;
}

/**
 * Plan readiness: topic mastery weighted by exam weight. The one place exam
 * weight still steers anything, and it steers reporting, not ordering.
 */
export function planReadiness(
  topicMastery: Map<string, number>,
  topicWeights: Map<string, number>,
): number {
  let weighted = 0;
  let total = 0;
  for (const [key, weight] of topicWeights) {
    const w = Math.max(0, weight);
    total += w;
    weighted += (topicMastery.get(key) ?? 0) * w;
  }
  return total > 0 ? weighted / total : 0;
}

export function isLearned(m: number, t: Tuning): boolean {
  return m >= t.masteryBar;
}

/**
 * Whether a unit has earned the right to depart from curriculum order in the
 * review queue. Any one of the spec's three triggers is enough.
 *
 * An untouched unit is never eligible, whatever its mastery: zero mastery on
 * no evidence means unread, and unread material belongs to the first pass.
 * Without this guard every unit in the plan would qualify on day one and the
 * curriculum order the candidate asked for would never be followed at all.
 */
export function isEligibleToJump(
  obs: MasteryObservation[],
  asOf: Date,
  t: Tuning,
): boolean {
  const touched = obs.some((o) => o.answered > 0 || o.lastTouch !== null);
  if (!touched) return false;

  const lowConfidence = obs.some(
    (o) => o.confidence !== null && o.confidence <= t.confidenceTriggerValue,
  );
  if (lowConfidence) return true;

  const answered = obs.reduce((sum, o) => sum + o.answered, 0);
  const correct = obs.reduce((sum, o) => sum + o.correct, 0);
  if (answered >= t.accuracyMinSample) {
    const a = (correct + 1) / (answered + 2);
    if (a < t.accuracyFloor) return true;
  }

  // The third trigger is DECAY, not weakness: a unit that would clear the bar
  // if it were fresh, and no longer does. A unit that never cleared the bar at
  // all has not decayed, it is merely thinly practised, and the two deserve
  // different treatment. Thinly practised material is already next in
  // curriculum order, so letting it jump the queue would buy nothing and would
  // let a handful of wrong answers on 4% coverage outrank the candidate's
  // stated ordering. Such a unit still gets reviewed; it just waits its turn.
  const fresh = masteryOfUnit(obs, asOf, { ...t, masteryHalfLifeDays: Infinity });
  if (fresh < t.masteryBar) return false;

  return masteryOfUnit(obs, asOf, t) < t.masteryBar;
}
