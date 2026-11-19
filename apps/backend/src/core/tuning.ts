// Pure tuning parser. No DB, no HTTP, no framework.
// Every constant the planner reads is the candidate's to set, so every
// constant arrives here as untrusted JSON and leaves as a complete Tuning.
// The step engine fixes its own rates; only the order, the review policy and
// the answer-review reading speed remain tunable.
//
// parseTuning never throws. A planner that refuses to generate because one
// field in a settings form was out of range is worse than a planner that
// generates with the default and says which field it ignored, so a bad field
// costs the candidate that field and nothing else.

import { DEFAULT_RULES, type StepRules } from "./steps/rules";

export type PlanMode = "curriculum-strict" | "curriculum-topic";

export type ReviewPolicy =
  | "decay-triggered"
  | "after-coverage"
  | "weekly-interleave"
  | "fixed-date";

export const PLAN_MODES: readonly PlanMode[] = ["curriculum-strict", "curriculum-topic"];

// The old engine's mode. Clients may still send it; it means curriculum-topic now.
const LEGACY_MODE = "effort-return";

export const REVIEW_POLICIES: readonly ReviewPolicy[] = [
  "decay-triggered",
  "after-coverage",
  "weekly-interleave",
  "fixed-date",
];

export type Tuning = {
  planMode: PlanMode;
  reviewPolicy: ReviewPolicy;
  reviewStartDate: string | null;
  /** Words a minute when reading worked solutions; sizes answer review. */
  answerReviewWordsPerMinute: number;
  /** Step rules, see core/steps/rules.ts StepRules. */
  step2Multiplier: number;
  step4Multiplier: number;
  accuracyTarget: number;
  mockPassTarget: number;
  exemptionMultiplier: number;
};

export type RejectedField = {
  field: string;
  given: unknown;
  usedInstead: number | string | null;
  reason: string;
};

export const DEFAULT_TUNING: Tuning = {
  planMode: "curriculum-topic",
  reviewPolicy: "decay-triggered",
  reviewStartDate: null,
  answerReviewWordsPerMinute: 200,
  step2Multiplier: DEFAULT_RULES.step2Multiplier,
  step4Multiplier: DEFAULT_RULES.step4Multiplier,
  accuracyTarget: DEFAULT_RULES.accuracyTarget,
  mockPassTarget: DEFAULT_RULES.mockPassTarget,
  exemptionMultiplier: DEFAULT_RULES.exemptionMultiplier,
};

export const TUNING_RANGES: Record<string, { min: number; max: number }> = {
  answerReviewWordsPerMinute: { min: 100, max: 400 },
  step2Multiplier: { min: 0.5, max: 6 },
  step4Multiplier: { min: 0.5, max: 6 },
  accuracyTarget: { min: 50, max: 100 },
  mockPassTarget: { min: 50, max: 100 },
  exemptionMultiplier: { min: 1.25, max: 5 },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/**
 * Parse a stored tuning column into a complete Tuning plus the list of
 * fields that were supplied but not usable.
 *
 * An unknown key is not a rejected field: the candidate never typed it, it is
 * a leftover from an older shape of this object, and reporting it would put
 * noise on the settings screen that no action can clear.
 */
export function parseTuning(raw: unknown): {
  tuning: Tuning;
  rejected: RejectedField[];
} {
  const tuning: Tuning = { ...DEFAULT_TUNING };
  const rejected: RejectedField[] = [];

  if (!isRecord(raw)) {
    return { tuning, rejected };
  }

  for (const [field, range] of Object.entries(TUNING_RANGES)) {
    if (!(field in raw)) continue;
    const given = raw[field];
    const fallback = DEFAULT_TUNING[field as keyof Tuning] as number;

    if (typeof given !== "number" || !Number.isFinite(given)) {
      rejected.push({
        field,
        given,
        usedInstead: fallback,
        reason: "not a finite number",
      });
      continue;
    }

    if (given < range.min || given > range.max) {
      rejected.push({
        field,
        given,
        usedInstead: fallback,
        reason: `outside ${range.min} to ${range.max}`,
      });
      continue;
    }

    (tuning as unknown as Record<string, number>)[field] = given;
  }

  if ("planMode" in raw) {
    const given = raw.planMode;
    if (given === LEGACY_MODE) {
      tuning.planMode = DEFAULT_TUNING.planMode;
    } else if (typeof given === "string" && (PLAN_MODES as readonly string[]).includes(given)) {
      tuning.planMode = given as PlanMode;
    } else {
      rejected.push({
        field: "planMode",
        given,
        usedInstead: DEFAULT_TUNING.planMode,
        reason: `not one of ${PLAN_MODES.join(", ")}`,
      });
    }
  }

  if ("reviewStartDate" in raw) {
    const given = raw.reviewStartDate;
    if (given === null) {
      tuning.reviewStartDate = null;
    } else if (typeof given === "string" && ISO_DATE.test(given)) {
      tuning.reviewStartDate = given;
    } else {
      rejected.push({
        field: "reviewStartDate",
        given,
        usedInstead: null,
        reason: "not an ISO date of the form YYYY-MM-DD",
      });
    }
  }

  if ("reviewPolicy" in raw) {
    const given = raw.reviewPolicy;
    if (
      typeof given === "string" &&
      (REVIEW_POLICIES as readonly string[]).includes(given)
    ) {
      tuning.reviewPolicy = given as ReviewPolicy;
    } else {
      rejected.push({
        field: "reviewPolicy",
        given,
        usedInstead: DEFAULT_TUNING.reviewPolicy,
        reason: `not one of ${REVIEW_POLICIES.join(", ")}`,
      });
    }
  }

  // fixed-date without a date is not a policy, it is a half-filled form. The
  // date is reported rather than the policy, because the date is the field the
  // candidate still has to fill in.
  if (tuning.reviewPolicy === "fixed-date" && tuning.reviewStartDate === null) {
    rejected.push({
      field: "reviewStartDate",
      given: null,
      usedInstead: null,
      reason: "the fixed-date policy needs a date, so the policy fell back",
    });
    tuning.reviewPolicy = DEFAULT_TUNING.reviewPolicy;
  }

  return { tuning, rejected };
}

export function rulesOf(t: Tuning): StepRules {
  return {
    step2Multiplier: t.step2Multiplier, step4Multiplier: t.step4Multiplier,
    accuracyTarget: t.accuracyTarget, mockPassTarget: t.mockPassTarget,
    exemptionMultiplier: t.exemptionMultiplier,
  };
}
