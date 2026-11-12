// Pure tuning parser. No DB, no HTTP, no framework.
// Every constant the planner reads is the candidate's to set, so every
// constant arrives here as untrusted JSON and leaves as a complete Tuning.
//
// parseTuning never throws. A planner that refuses to generate because one
// field in a settings form was out of range is worse than a planner that
// generates with the default and says which field it ignored, so a bad field
// costs the candidate that field and nothing else.

export type PlanMode = "effort-return" | "curriculum-strict" | "curriculum-topic";

export type ReviewPolicy =
  | "decay-triggered"
  | "after-coverage"
  | "weekly-interleave"
  | "fixed-date";

export const PLAN_MODES: readonly PlanMode[] = [
  "effort-return",
  "curriculum-strict",
  "curriculum-topic",
];

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

  // First pass
  firstPassQuestionMultiple: number;
  questionMultipleFloor: number;
  minNewUnitReadMinutes: number;

  // Review phase
  reviewQuestionMultiple: number;
  coverageDeadlineWeeks: number;
  weeklyInterleaveShare: number;
  reviewInjectionCapShare: number;

  // Mastery
  masteryWeightAccuracy: number;
  masteryWeightCoverage: number;
  masteryWeightConfidence: number;
  masteryHalfLifeDays: number;
  masteryBar: number;
  readingWriteOffBar: number;

  // Evidence triggers
  confidenceTriggerValue: number;
  accuracyFloor: number;
  accuracyMinSample: number;
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

  firstPassQuestionMultiple: 2.0,
  questionMultipleFloor: 0.5,
  minNewUnitReadMinutes: 15,

  reviewQuestionMultiple: 4.0,
  coverageDeadlineWeeks: 6,
  weeklyInterleaveShare: 0.2,
  reviewInjectionCapShare: 0.35,

  masteryWeightAccuracy: 0.6,
  masteryWeightCoverage: 0.25,
  masteryWeightConfidence: 0.15,
  masteryHalfLifeDays: 45,
  masteryBar: 0.75,
  readingWriteOffBar: 0.85,

  confidenceTriggerValue: 1,
  accuracyFloor: 0.5,
  accuracyMinSample: 12,
};

export const TUNING_RANGES: Record<string, { min: number; max: number }> = {
  firstPassQuestionMultiple: { min: 0.5, max: 6.0 },
  questionMultipleFloor: { min: 0.2, max: 2.0 },
  minNewUnitReadMinutes: { min: 5, max: 60 },

  reviewQuestionMultiple: { min: 1.0, max: 10.0 },
  coverageDeadlineWeeks: { min: 1, max: 20 },
  weeklyInterleaveShare: { min: 0.05, max: 0.5 },
  reviewInjectionCapShare: { min: 0.1, max: 0.8 },

  masteryWeightAccuracy: { min: 0, max: 1 },
  masteryWeightCoverage: { min: 0, max: 1 },
  masteryWeightConfidence: { min: 0, max: 1 },
  masteryHalfLifeDays: { min: 7, max: 365 },
  masteryBar: { min: 0.3, max: 0.95 },
  readingWriteOffBar: { min: 0.5, max: 0.98 },

  confidenceTriggerValue: { min: 1, max: 3 },
  accuracyFloor: { min: 0.2, max: 0.8 },
  accuracyMinSample: { min: 5, max: 100 },
};

const WEIGHT_FIELDS = [
  "masteryWeightAccuracy",
  "masteryWeightCoverage",
  "masteryWeightConfidence",
] as const;

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
    if (typeof given === "string" && (PLAN_MODES as readonly string[]).includes(given)) {
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

  // Normalise last, after clamping, so the candidate may express the weights
  // in whatever units they find natural (6, 2.5, 1.5 reads as 0.60, 0.25,
  // 0.15) and the formula still receives a convex combination.
  const weightSum = WEIGHT_FIELDS.reduce((sum, f) => sum + tuning[f], 0);
  if (weightSum <= 0) {
    rejected.push({
      field: "masteryWeights",
      given: WEIGHT_FIELDS.map((f) => tuning[f]),
      usedInstead: null,
      reason: "all three mastery weights were zero, so there was nothing to normalise",
    });
    for (const f of WEIGHT_FIELDS) tuning[f] = DEFAULT_TUNING[f];
  } else {
    for (const f of WEIGHT_FIELDS) tuning[f] = tuning[f] / weightSum;
  }

  return { tuning, rejected };
}
