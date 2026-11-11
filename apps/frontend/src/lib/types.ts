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

export type PushDevice = { id: string; endpoint: string; createdAt: string };
