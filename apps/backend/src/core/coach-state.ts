// Pure state classification for email coach. No DB, no clock, no randomness.
// Classifies a candidate's plan state into three independent dimensions
// that drive email content selection.

export type StreakBand = "on-track" | "slip" | "drifting" | "serious" | "crisis";
export type DayShape = "rest" | "light" | "normal" | "heavy" | "catch-up";
export type LoggingState = "nothing" | "partial" | "complete" | "over";

export type CoachState = {
  streak: StreakBand;
  shape: DayShape;
  logging: LoggingState;
  streakDays: number; // raw count, carried through for copy
};

export type CoachInput = {
  streakDays: number;
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
    streakDays: input.streakDays,
  };
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
