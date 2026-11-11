// Pure state classification for email coach. No DB, no clock, no randomness.
// Classifies a candidate's plan state into three independent dimensions
// that drive email content selection.

export type StreakBand = "on-track" | "slip" | "drifting" | "serious" | "crisis";
export type DayShape = "rest" | "light" | "normal" | "heavy" | "catch-up";
export type LoggingState = "nothing" | "partial" | "complete" | "over";

/**
 * How close the exam is. The same streak means completely different things at
 * 200 days and at 9: "drifting" in month one is recoverable and "drifting" in
 * the final fortnight is the whole story. Without this the coach sounds equally
 * alarmed all year, which teaches the candidate to ignore it.
 */
export type HorizonBand =
  | "far"
  | "mid"
  | "near"
  | "imminent"
  | "final-week"
  | "exam-eve"
  | "exam-day"
  | "past";

/**
 * Where the plan is in its own arc, from the prescription engine's phases.
 * Build is first-pass learning, Consolidate is review plus mocks, Sharpen is
 * the final stretch where no new coverage is scheduled at all.
 */
export type Phase = "build" | "consolidate" | "sharpen";

/**
 * Holiday context, which is richer than "is today a holiday".
 * A break starting tomorrow, a break in progress, and the first day back all
 * deserve different handling, and the day back is the one that decides whether
 * a holiday becomes a streak.
 */
export type HolidayContext = "none" | "starts-tomorrow" | "mid-break" | "last-day" | "first-day-back";

export type CoachState = {
  streak: StreakBand;
  shape: DayShape;
  logging: LoggingState;
  horizon: HorizonBand;
  phase: Phase;
  holiday: HolidayContext;
  streakDays: number; // raw count, carried through for copy
  daysToExam: number; // raw count, carried through for copy
};

export type CoachInput = {
  streakDays: number;
  daysToExam: number;
  planTotalDays: number; // start to exam, so the phase can be proportional
  planElapsedDays: number;
  holidayStartsTomorrow: boolean;
  holidayYesterday: boolean;
  holidayTomorrow: boolean;
  taskMinutes: number;
  availableMinutes: number;
  isHoliday: boolean;
  hasRequeued: boolean;
  hasMock: boolean;
  taskCount: number;
  tasksDone: number;
  extraLogged: number;
};

export function classify(input: CoachInput): CoachState {
  const streak = classifyStreak(input.streakDays);
  const shape = classifyShape(input);
  const logging = classifyLogging(input.tasksDone, input.taskCount, input.extraLogged);

  return {
    streak,
    shape,
    logging,
    horizon: classifyHorizon(input.daysToExam),
    phase: classifyPhase(input),
    holiday: classifyHoliday(input),
    streakDays: input.streakDays,
    daysToExam: input.daysToExam,
  };
}

function classifyHorizon(daysToExam: number): HorizonBand {
  if (daysToExam < 0) return "past";
  if (daysToExam === 0) return "exam-day";
  // The eve is its own band rather than a magic number in the decision tree,
  // because it is the one day the coach deliberately stops applying pressure.
  if (daysToExam === 1) return "exam-eve";
  if (daysToExam <= 7) return "final-week";
  if (daysToExam <= 21) return "imminent";
  if (daysToExam <= 60) return "near";
  if (daysToExam <= 120) return "mid";
  return "far";
}

/**
 * Proportional rather than date-pinned, so a twelve week crash plan and a forty
 * week plan both pass through all three phases. Only the final stretch is
 * absolute, because its content (mocks, no new coverage) is exam-relative.
 */
function classifyPhase(input: CoachInput): Phase {
  if (input.daysToExam <= 42) return "sharpen";
  const fraction = input.planTotalDays > 0 ? input.planElapsedDays / input.planTotalDays : 0;
  return fraction < 0.55 ? "build" : "consolidate";
}

function classifyHoliday(input: CoachInput): HolidayContext {
  if (input.isHoliday) {
    if (!input.holidayTomorrow) return "last-day";
    return "mid-break";
  }
  if (input.holidayYesterday) return "first-day-back";
  if (input.holidayStartsTomorrow) return "starts-tomorrow";
  return "none";
}

function classifyStreak(streakDays: number): StreakBand {
  if (streakDays === 0) return "on-track";
  if (streakDays === 1) return "slip";
  if (streakDays <= 3) return "drifting";
  if (streakDays <= 6) return "serious";
  return "crisis";
}

function classifyShape(input: CoachInput): DayShape {
  // rest: no availability at all, or today is a holiday
  if (input.availableMinutes === 0 || input.isHoliday) {
    return "rest";
  }

  // catch-up: today's list contains requeued work from a missed day
  if (input.hasRequeued) {
    return "catch-up";
  }

  // heavy: over 150 scheduled minutes, or the list contains a mock
  if (input.taskMinutes > 150 || input.hasMock) {
    return "heavy";
  }

  // light: under 45 scheduled minutes
  if (input.taskMinutes < 45) {
    return "light";
  }

  // normal: anything else
  return "normal";
}

function classifyLogging(tasksDone: number, taskCount: number, extraLogged: number): LoggingState {
  // nothing: no task done
  if (tasksDone === 0) {
    return "nothing";
  }

  // partial: some done, not all
  if (tasksDone < taskCount) {
    return "partial";
  }

  // all done: check for extra logging
  // over: all done AND extra items logged beyond the plan
  if (extraLogged > 0) {
    return "over";
  }

  // complete: all done, no extra
  return "complete";
}
