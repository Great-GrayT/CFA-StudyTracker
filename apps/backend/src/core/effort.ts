// Pure effort estimation engine. No DB, no HTTP, no framework.
// Turns provider catalogue resources into study minutes.

export type EffortConstants = {
  PAGE_RATE: number;
  EOCQ_MULT: number;
  REVIEW_MULT: number;
  SEMINAR_MIN: number;
  NOTES_RATE: number;
  Q_BASE: number;
  Q_CALC: number;
  WPM: number;
  IMG_MIN: number;
  CALC_REDO: number;
  ET_LM3_MIN: number;
};

export const DEFAULT_EFFORT_CONSTANTS: EffortConstants = {
  PAGE_RATE: 6.0,
  EOCQ_MULT: 0.55,
  REVIEW_MULT: 0.25,
  SEMINAR_MIN: 35,
  NOTES_RATE: 2.5,
  Q_BASE: 2.5,
  Q_CALC: 4.5,
  WPM: 140,
  IMG_MIN: 0.5,
  CALC_REDO: 1.0,
  ET_LM3_MIN: 180,
};

export type ResourceInput = {
  kind: string;
  notesPages?: number;
  questionCount?: number;
  calcCount?: number;
  answerWords?: number;
  exhibitCount?: number;
  lectureMinutes?: number;
  // sizeKb exists only so tests can prove size never changes an estimate.
  // No estimator may read it.
  sizeKb?: number;
};

export type ModuleInput = {
  ref: string;
  resources: ResourceInput[];
  weightImpliedMinutes: number;
};

export type ModuleEstimate = {
  ref: string;
  total: number;
  byKind: Record<string, number>;
  hasMaterial: boolean;
};

/**
 * Estimate minutes for a single resource. k is an optional pace multiplier
 * (default 1), applied last before rounding. Round at the return boundary only,
 * not inside intermediate math.
 */
export function estimateResource(
  r: ResourceInput,
  c: EffortConstants,
  k: number = 1
): number {
  let minutes = 0;

  switch (r.kind) {
    case "lecture":
      if (r.notesPages === undefined) return 0;
      minutes = Math.max(15, c.PAGE_RATE * r.notesPages);
      break;

    case "eocq":
      if (r.lectureMinutes === undefined) return 0;
      minutes = Math.max(10, c.EOCQ_MULT * r.lectureMinutes);
      break;

    case "review":
      if (r.lectureMinutes === undefined) return 0;
      minutes = Math.max(8, c.REVIEW_MULT * r.lectureMinutes);
      break;

    case "seminar":
      minutes = c.SEMINAR_MIN;
      break;

    case "notes":
      if (r.notesPages === undefined) return 0;
      minutes = c.NOTES_RATE * r.notesPages;
      break;

    case "question_set":
      if (
        r.questionCount === undefined ||
        r.calcCount === undefined ||
        r.questionCount === 0
      ) {
        return 0;
      }
      const calcShare = r.calcCount / r.questionCount;
      minutes =
        r.questionCount *
        (c.Q_BASE + (c.Q_CALC - c.Q_BASE) * calcShare);
      break;

    case "answer_set":
      if (r.answerWords === undefined) return 0;
      const wordMinutes = r.answerWords / c.WPM;
      const exhibitMinutes = (r.exhibitCount ?? 0) * c.IMG_MIN;
      const calcMinutes = (r.calcCount ?? 0) * c.CALC_REDO;
      minutes = wordMinutes + exhibitMinutes + calcMinutes;
      break;

    default:
      return 0;
  }

  return Math.round(minutes * k);
}

/**
 * Estimate total minutes for a module with a per-kind breakdown.
 * A module with no resources returns weightImpliedMinutes with hasMaterial false.
 * Round each resource's estimate before summing, so the module total matches
 * the sum of its parts exactly.
 */
export function estimateModule(
  m: ModuleInput,
  c: EffortConstants
): ModuleEstimate {
  const byKind: Record<string, number> = {};
  let total = 0;

  for (const resource of m.resources) {
    const minutes = estimateResource(resource, c);
    if (minutes > 0) {
      byKind[resource.kind] = (byKind[resource.kind] ?? 0) + minutes;
      total += minutes;
    }
  }

  // Module with no material uses weight-implied minutes, never zero.
  if (m.resources.length === 0) {
    return {
      ref: m.ref,
      total: m.weightImpliedMinutes,
      byKind: {},
      hasMaterial: false,
    };
  }

  return {
    ref: m.ref,
    total,
    byKind,
    hasMaterial: true,
  };
}
