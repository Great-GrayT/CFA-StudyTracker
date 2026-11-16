import type { RoundState } from "./types";

export const MIN_PER_QUESTION = 3;
export const ANSWER_WPM = 200;
export const NOTES_MIN_PER_PAGE = 2.5;
export const EPS = 1e-9;

// Cross-multiplied so 24/30 style ratios are exact.
export function accuracyMet(answered: number, correct: number): boolean {
  return answered > 0 && correct * 5 >= answered * 4 - EPS;
}

type TopUpIn = { answered: number; correct: number; minutes: number; adequate: number; perQ: number };

export function topUpParts(r: TopUpIn): { n80: number; nAdq: number } {
  // Assumes every new question is correct: (C+n) >= 0.8 (A+n).
  const n80 = Math.max(0, Math.ceil((0.8 * r.answered - r.correct) / 0.2 - EPS));
  const short = Math.max(0, r.adequate - r.minutes);
  const nAdq = r.perQ > 0 ? Math.ceil(short / r.perQ - EPS) : 0;
  return { n80, nAdq };
}

export function topUpQuestions(r: TopUpIn): number {
  const { n80, nAdq } = topUpParts(r);
  return Math.max(0, n80, nAdq);
}

export function roundOutcome(r: RoundState, adequate: number): "pass" | "top-up" | "exemption" {
  const acc = accuracyMet(r.answered, r.correct);
  if (acc && r.minutes >= adequate - EPS) return "pass";
  if (!acc && r.answered > 0 && r.minutes >= 2 * adequate - EPS) return "exemption";
  return "top-up";
}
