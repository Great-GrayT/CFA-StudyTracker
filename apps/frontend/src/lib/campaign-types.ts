// The long-term projection's shape, as agreed with the engine.
//
// The numbers come from apps/backend/src/lib/FUNC-campaign.ts
// (`projectCampaign`), which runs the planner's own estimate, allocate,
// sequence, solve, reconcile and pack pipeline over the whole span to the
// exam instead of the fourteen-day horizon, and writes nothing.
//
// The client never re-derives the reading-versus-question split. That rule
// lives in the engine's pairing module and depends on review video being held
// back from the first pass, which is load bearing for the review phase's 1:4
// ratio. Everything here is taken from the five numbers the engine hands over.

/** The five things a period's minutes can be spent on. */
export type CampaignStage =
  | "firstPassReading"
  | "firstPassQuestions"
  | "reviewReading"
  | "reviewQuestions"
  | "mocks";

export type CampaignPeriod = {
  /** ISO date, inclusive. */
  start: string;
  /** ISO date, inclusive. */
  end: string;
  minutes: Record<CampaignStage, number>;
};

export type Campaign = {
  periods: CampaignPeriod[];
  examDate: string;
  /**
   * When the first pass is projected to finish, and how much room that
   * leaves. The thing a candidate most needs to watch slipping.
   */
  coverageProjection: { date: string; slackDays: number } | null;
  /** The practice ratio the candidate asked for, e.g. 2.0 for 1:2. */
  requestedQuestionMultiple: number;
  /** The ratio the calendar can actually reach. */
  budgetQuestionMultiple: number;
  calendarTooShort: boolean;
  /** "effort-return" | "curriculum-strict" | "curriculum-topic" today. Typed
      as a string because that is what the API guarantees; claiming a union
      the server does not enforce would be false confidence. */
  planMode: string;
  /** "decay-triggered" (default) | "after-coverage" | "weekly-interleave"
      | "fixed-date". */
  reviewPolicy: string;
};

/**
 * Stage order in the stack, and the words for each.
 *
 * First pass sits below review so the eye reads the campaign bottom-up in the
 * order it is lived. Mocks sit on top because they punctuate the plan rather
 * than being a phase of it.
 *
 * Note for anyone reading a mid-plan week and thinking the data is wrong:
 * period boundaries are NOT phase boundaries. The default review policy
 * injects review into first-pass days as soon as a unit's mastery decays, so
 * a single week legitimately carries all four study stages at once.
 */
export const STAGES: ReadonlyArray<{ key: CampaignStage; label: string; phase: string }> = [
  { key: "firstPassReading", label: "Reading", phase: "First pass" },
  { key: "firstPassQuestions", label: "Questions", phase: "First pass" },
  { key: "reviewReading", label: "Review video", phase: "Review" },
  { key: "reviewQuestions", label: "Questions", phase: "Review" },
  { key: "mocks", label: "Mock exams", phase: "Mocks" },
];

export function periodTotal(period: CampaignPeriod): number {
  return STAGES.reduce((sum, s) => sum + (period.minutes[s.key] ?? 0), 0);
}
