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
  // The coach's three local times; null means the defaults. The debrief is the
  // end of the study day.
  coachSchedule: { prescription: string; nudge: string; debrief: string } | null;
  // Local day the plan was last built from. Ahead of today once today closed.
  horizonGeneratedFor: string | null;
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

export type PlanMode = "curriculum-strict" | "curriculum-topic";

export type ReviewPolicy =
  | "decay-triggered"
  | "after-coverage"
  | "weekly-interleave"
  | "fixed-date";

/** The constants the step engine still lets a candidate set. */
export type Tuning = {
  planMode: PlanMode;
  reviewPolicy: ReviewPolicy;
  reviewStartDate: string | null;
  answerReviewWordsPerMinute: number;
  step2Multiplier: number;
  step4Multiplier: number;
  accuracyTarget: number;
  mockPassTarget: number;
  exemptionMultiplier: number;
  reviewShare: number;
};

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
  /** Earliest missed day (YYYY-MM-DD) whose work this cell carries, else null. */
  postponedFrom: string | null;
  /** A session the candidate logged themselves, not one the plan asked for. */
  offPlan: boolean;
  /** Engine step 1 to 4, null for mocks and tasks written before the engine. */
  step: number | null;
  round: number | null;
  /** Questions the package sets for this task, when known. */
  questionCount: number | null;
  /** Why an extra task was added, null for base work. */
  extraReason: string | null;
  answerReviewDone: boolean;
  mockRef: string | null;
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

// Step engine projection (GET plans/:id/projection).
export type StepNo = 1 | 2 | 3 | 4;
export type WindowStatus = "done" | "planned" | "overdue" | "in-progress";
export type ProjectionWindow = {
  step: StepNo;
  start: string | null;
  due: string | null;
  doneOn: string | null;
  status: WindowStatus;
};
/** One module's question work at step 2 or 4: the latest round and the time it was worth. */
export type StepPerformance = {
  round: number;
  answered: number;
  correct: number;
  minutes: number;
  adequateMin: number;
  passed: boolean;
  /** m: questions that fill adequateMin at perQ minutes each. Optional so an older server still renders. */
  adequateQ?: number;
  /** q: pending extra questions the plan holds for this round. */
  extraPendingQ?: number;
  /** Minutes per question including answer review. */
  perQ?: number;
};
/** Module-wide question totals; mock counts are the topic's, as mocks are scored per topic. */
export type ModuleTotals = { answered: number; correct: number; mockAnswered: number; mockCorrect: number };
export type Tally = { answered: number; correct: number };
export type ProjectionSection = {
  topicId: string;
  name: string;
  examWeight: number;
  /** Steps 2 and 4: questions the plan requires, answered and correct so far. Optional for older servers. */
  questions?: { required: number; answered: number; correct: number };
  steps: {
    step: StepNo;
    plannedMin: number;
    donePassedMin: number;
    spentUnpassedMin: number;
    planTodayMin: number;
  }[];
  modules: {
    readingId: string;
    name: string;
    windows: ProjectionWindow[];
    performance: { s2: StepPerformance | null; s4: StepPerformance | null };
    totals?: ModuleTotals;
  }[];
  performance: {
    initial: Tally | null;
    review: Tally | null;
    mocks: Tally | null;
    extras: { tasks: number; minutes: number };
  };
};
export type StepRules = {
  step2Multiplier: number;
  step4Multiplier: number;
  accuracyTarget: number;
  mockPassTarget: number;
  exemptionMultiplier: number;
  reviewShare: number;
};
/** Step 5 is mocks. */
export type PlanTotals = {
  requiredMin: number;
  doneMin: number;
  leftMin: number;
  byStep: Record<"1" | "2" | "3" | "4" | "5", { requiredMin: number; doneMin: number }>;
  questions: { required: number; answered: number; correct: number };
  daysLeft: number;
  minPerDayNeeded: number;
  minPerDayAvailable: number;
  workDays?: number;
};
export type FitTrim = { readingId: string | null; step: number; minutes: number; reason: string };
export type ProjectionExtra = {
  taskId: string | null;
  readingId: string;
  step: number;
  reason: string;
  questions: number | null;
  minutes: number;
  date: string | null;
};
export type Projection = {
  asOf: string;
  exam: string;
  gate: string;
  fit: {
    crash: number;
    cancelledHolidayIds: string[];
    feasible: boolean;
    belowPass: boolean;
    trims: FitTrim[];
  };
  rules?: StepRules;
  totals?: PlanTotals;
  calendar?: { start: string; mocks: { date: string; done: boolean; title: string | null }[] };
  sections: ProjectionSection[];
  readiness: number;
  readinessPlanToday: number;
  daily: {
    date: string;
    plannedMin: number;
    doneMin: number;
    byStep: Record<"1" | "2" | "3" | "4" | "5", number>;
  }[];
  holidays: { id: string; start: string; end: string; cancelled: boolean }[];
  mocks: { done: number; planned: number; firstDate: string | null };
  extras: ProjectionExtra[];
};

export type DeclarationItem = {
  readingId: string;
  step: StepNo;
  confidence?: number;
  answered?: number;
  correct?: number;
  /** YYYY-MM-DD the work was done. The server defaults it to the plan's first day. */
  date?: string;
};
export type MockSession = {
  ref: string;
  title: string;
  questionCount: number | null;
  topicMix: { topicId: string; name: string; order: number; questions: number }[];
  done: boolean;
  packageId?: string;
  packageName?: string;
};
export type PlanSettingsPatch = {
  stepPriority?: Record<string, string[]>;
  lesReadingHours?: number;
  belowPassAccepted?: boolean;
};

// GET plans/:id/history?topicId=X: everything done per module and engine step.
export type HistoryMaterial = { label: string; url: string | null };
export type HistoryTaskRecord = {
  type: "task";
  id: string;
  date: string;
  recordedAt: string;
  kind: string;
  step: number | null;
  round: number | null;
  status: "done" | "partial";
  offPlan: boolean;
  extraReason: string | null;
  packageId: string | null;
  packageName: string | null;
  materials: HistoryMaterial[];
  estimatedMinutes: number;
  actualMinutes: number | null;
  answerReviewDone: boolean;
  answerReviewMinutes: number | null;
  answered: number;
  correct: number;
  confidence: number | null;
  note: string | null;
};
export type HistoryDeclarationRecord = {
  type: "declaration";
  step: StepNo;
  /** YYYY-MM-DD the self-stated work counts on; records are sorted by it. */
  date: string;
  createdAt: string;
  updatedAt: string;
  confidence: number | null;
  answered: number | null;
  correct: number | null;
};
export type HistoryRecord = HistoryTaskRecord | HistoryDeclarationRecord;
export type HistoryQuestions = {
  n: number;
  m: number;
  q: number;
  answered: number;
  correct: number;
  adequateMin: number;
  minutes: number;
  passed: boolean;
};
export type HistoryStep = {
  step: StepNo;
  status: "done" | "in-progress" | "not-started";
  round: number | null;
  doneMin: number;
  targetMin: number;
  questions: HistoryQuestions | null;
  records: HistoryRecord[];
};
export type HistoryMock = {
  id: string;
  date: string;
  createdAt: string;
  sessionRef: string | null;
  packageName: string | null;
  scorePercent: number;
  answered: number;
  correct: number;
};
export type HistoryResponse = {
  topicId: string;
  mocks: HistoryMock[];
  modules: { readingId: string; name: string; order: number; steps: HistoryStep[] }[];
};
