// Response shapes from the backend, hand-written rather than generated.
//
// These mirror apps/backend's route handlers. Where a field is surprising, the
// comment says why rather than restating the type.

export type WeeklyAvailability = {
  mon: number;
  tue: number;
  wed: number;
  thu: number;
  fri: number;
  sat: number;
  sun: number;
};

export const WEEKDAYS: Array<keyof WeeklyAvailability> = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export const WEEKDAY_LABELS: Record<keyof WeeklyAvailability, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** How much of the study coach one delivery channel sends. */
export type CoachPreference = "all" | "debrief-only" | "off";

export type Plan = {
  id: string;
  userId: string;
  levelId: "I" | "II" | "III";
  examDate: string;
  startDate: string;
  weeklyAvailability: WeeklyAvailability;
  isActive: boolean;
  createdAt: string;
  // IANA zone the coach times its messages to. Set from the chosen city, and
  // overridable for the candidate who studies in one zone and sits the exam in
  // another.
  timeZone: string;
  // One per channel: wanting the full written briefing by email and only the
  // night summary on a phone is an ordinary preference.
  emailCoach: CoachPreference;
  pushCoach: CoachPreference;
  // City-level only, user-entered, and all null until they say.
  city: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  // How the plan is built. The mode picks the reading sequence, the policy
  // decides when review starts, and reviewStartDate is read only under the
  // date-picked policy.
  planMode: PlanMode;
  reviewPolicy: ReviewPolicy;
  reviewStartDate: string | null;
};

export type PlanMode = "effort-return" | "curriculum-strict" | "curriculum-topic";

export type ReviewPolicy =
  | "decay-triggered"
  | "after-coverage"
  | "weekly-interleave"
  | "fixed-date";

/** Every constant the planner reads. Names match core/tuning.ts exactly. */
export type Tuning = {
  planMode: PlanMode;
  reviewPolicy: ReviewPolicy;
  reviewStartDate: string | null;
  firstPassQuestionMultiple: number;
  questionMultipleFloor: number;
  coverageDeadlineWeeks: number;
  reviewQuestionMultiple: number;
  minNewUnitReadMinutes: number;
  answerReviewWordsPerMinute: number;
  weeklyInterleaveShare: number;
  reviewInjectionCapShare: number;
  masteryWeightAccuracy: number;
  masteryWeightCoverage: number;
  masteryWeightConfidence: number;
  masteryHalfLifeDays: number;
  masteryBar: number;
  readingWriteOffBar: number;
  confidenceTriggerValue: number;
  accuracyFloor: number;
  accuracyMinSample: number;
};

/** The numeric fields only, which is what the form edits and sends. */
export type TuningNumbers = Omit<Tuning, "planMode" | "reviewPolicy" | "reviewStartDate">;

/**
 * The planner block from GET /api/settings: what is set, what each constant is
 * allowed to be, and the figures that only exist as the output of a planning
 * run.
 */
export type PlannerSettings = {
  tuning: Tuning;
  rejected: Array<{ field: string; reason: string }>;
  ranges: Record<string, { min: number; max: number }>;
  defaults: Tuning;
  modes: PlanMode[];
  policies: ReviewPolicy[];
  requestedQuestionMultiple: number;
  effectiveQuestionMultiple: number | null;
  calendarTooShort: boolean;
  injectionCap: number | null;
  reviewReason: string | null;
  coverageProjection: { date: string; slackDays: number } | null;
  writeOffs: Array<{ ref: string; mastery: number; readingMinutesDropped: number }>;
  underPractised: Array<{ ref: string; shortfallMinutes: number }>;
};

/** One match from the city lookup, which returns several so the candidate picks. */
export type GeocodeMatch = {
  city: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timeZone: string;
  admin1: string | null;
};

export type Los = { id: string; text: string; order: number };
export type Reading = { id: string; name: string; order: number; los: Los[] };
export type Topic = {
  id: string;
  name: string;
  order: number;
  examWeightMin: number;
  examWeightMax: number;
  readings: Reading[];
};
export type Curriculum = {
  levelId: string;
  curriculumVersion: string;
  topics: Topic[];
};

export type LevelSummary = {
  id: "I" | "II" | "III";
  curriculumVersion: string;
  topicCount: number;
  losCount: number;
  available: boolean;
  topics: Array<{
    id: string;
    name: string;
    order: number;
    examWeightMin: number;
    examWeightMax: number;
    readingCount: number;
    losCount: number;
  }>;
};

export type LogEntry = {
  id: string;
  planId: string;
  losId: string;
  packageId: string | null;
  date: string;
  confidence: number;
  questionsAnswered: number;
  questionsCorrect: number;
  note: string | null;
};

export type MockExam = {
  id: string;
  planId: string;
  date: string;
  scorePercent: number;
  packageId: string | null;
  note: string | null;
};

export type StudyPackage = { id: string; name: string; userId: string | null };
export type PackageRole = "content" | "questions" | "mocks";
export type PlanPackage = { packageId: string; roles: PackageRole[]; name?: string };
export type Holiday = { id: string; startDate: string; endDate: string; note: string | null };

export type StudyNextItem = {
  losId: string;
  status: "not-started" | "covered" | "flagged";
  lastRatedAt?: string;
  order: number;
};

export type Progress = {
  coveragePercent: number;
  studyNext: StudyNextItem[];
  // Named `today` but newCoverage and reviewWork are lifetime totals, and
  // actualCumulative counts log rows while targetCumulative counts distinct
  // outcomes. The client computes its own behind/ahead figure from the log
  // history instead of rendering `delta`. See lib/pace.ts.
  today: {
    targetCumulative: number;
    newCoverage: number;
    reviewWork: number;
    actualCumulative: number;
    delta: number;
    percent: number;
  };
  paceRealistic: boolean;
  diversityNudges: string[];
  recommendedSplit: { contentHours: number; practiceHours: number };
  history: Array<{ date: string; targetCumulative: number; actualCumulative: number }>;
  missedDays: string[];
};

export type CronRun = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean;
  plansProcessed: number;
  plansFailed: number;
  plansSkipped: number;
  manual: boolean;
  error: string | null;
};

export type CronStatus = {
  schedule: string;
  nextRunAt: string;
  lastRunAt: string | null;
  stalled: boolean;
  limit: number;
  runs: CronRun[];
};

export type PushDevice = { id: string; endpoint: string; label: string | null; createdAt: string };

/**
 * One thing to open and do, named the way the provider names it rather than
 * by the outcome it serves. A candidate cannot watch an outcome.
 */
export type PrescribedMaterial = {
  action: string;
  label: string;
  packageName: string;
  url: string | null;
  questionCount: number | null;
};

export type PrescribedTask = {
  id: string;
  order: number;
  kind: string;
  status: string;
  estimatedMinutes: number;
  /** Minutes the candidate reported, null until submitted. */
  actualMinutes: number | null;
  /** Confidence the task was recorded with, null until recorded. */
  confidence: number | null;
  readingIds: string[];
  topicName: string | null;
  moduleTitle: string | null;
  materials: PrescribedMaterial[];
};

export type PrescribedDay = {
  date: string;
  /** Minutes the plan asks for on this day. */
  totalMinutes: number;
  /** Minutes of that which are finished. */
  doneMinutes: number;
  doneTasks: number;
  totalTasks: number;
  /**
   * Outcomes logged on this day that no task scheduled for it covers.
   * Counted, not timed: a log entry never records a duration.
   */
  offPlanLogs: number;
  tasks: PrescribedTask[];
};

export type Prescription = {
  planId: string;
  from: string;
  to: string;
  days: PrescribedDay[];
};
