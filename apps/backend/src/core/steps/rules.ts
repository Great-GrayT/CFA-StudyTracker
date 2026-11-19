import type { RoundState } from "./types";

export const MIN_PER_QUESTION = 3;
export const ANSWER_WPM = 200;
export const NOTES_MIN_PER_PAGE = 2.5;
export const EPS = 1e-9;

export type StepRules = {
  step2Multiplier: number; // step 2 adequate minutes = k2 x step 1 minutes
  step4Multiplier: number; // step 4 adequate minutes = k4 x step 2 adequate
  accuracyTarget: number; // percent, steps 2 and 4
  mockPassTarget: number; // percent per topic in a mock
  exemptionMultiplier: number; // exemption after this many x adequate minutes below target
};

export const DEFAULT_RULES: StepRules = {
  step2Multiplier: 2, step4Multiplier: 2, accuracyTarget: 80, mockPassTarget: 75, exemptionMultiplier: 2,
};

const DEFAULT_TARGET = DEFAULT_RULES.accuracyTarget / 100;

// Default 0.8 stays cross-multiplied so 24/30 style ratios are exact.
export function accuracyMet(answered: number, correct: number, target = DEFAULT_TARGET): boolean {
  if (answered <= 0) return false;
  if (target === DEFAULT_TARGET) return correct * 5 >= answered * 4 - EPS;
  return correct >= target * answered - EPS;
}

type TopUpIn = { answered: number; correct: number; minutes: number; adequate: number; perQ: number };

export function topUpParts(r: TopUpIn, target = DEFAULT_TARGET): { n80: number; nAdq: number } {
  // Assumes every new question is correct: (C+n) >= t (A+n). At t = 1 a wrong answer is
  // unrecoverable, so plan none and let the exemption close the round.
  let n80 = 0;
  if (target < 1) {
    const need = target === DEFAULT_TARGET ? 0.8 * r.answered - r.correct : target * r.answered - r.correct;
    n80 = Math.max(0, Math.ceil(need / (1 - target) - EPS));
  }
  const short = Math.max(0, r.adequate - r.minutes);
  const nAdq = r.perQ > 0 ? Math.ceil(short / r.perQ - EPS) : 0;
  return { n80, nAdq };
}

export function topUpQuestions(r: TopUpIn, target = DEFAULT_TARGET): number {
  const { n80, nAdq } = topUpParts(r, target);
  return Math.max(0, n80, nAdq);
}

export function roundOutcome(
  r: RoundState, adequate: number, target = DEFAULT_TARGET, exemptionMultiplier = DEFAULT_RULES.exemptionMultiplier,
): "pass" | "top-up" | "exemption" {
  const acc = accuracyMet(r.answered, r.correct, target);
  if (acc && r.minutes >= adequate - EPS) return "pass";
  if (!acc && r.answered > 0 && r.minutes >= exemptionMultiplier * adequate - EPS) return "exemption";
  return "top-up";
}
