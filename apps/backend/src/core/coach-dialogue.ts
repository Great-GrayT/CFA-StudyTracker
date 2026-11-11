import type { CoachState } from "./coach-state";
import type { Slot } from "./slots";

export type DialogueKey =
  | "REST_DAY"
  | "DAY_LIGHT"
  | "DAY_NORMAL"
  | "DAY_HEAVY"
  | "SLIP_1"
  | "DRIFT"
  | "SERIOUS"
  | "CRISIS"
  | "NUDGE_FIRST"
  | "NUDGE_STREAK"
  | "DAY_DONE"
  | "DAY_OVER"
  | "DAY_PARTIAL"
  | "DAY_LOST";

export const ALL_DIALOGUE_KEYS: DialogueKey[] = [
  "REST_DAY",
  "DAY_LIGHT",
  "DAY_NORMAL",
  "DAY_HEAVY",
  "SLIP_1",
  "DRIFT",
  "SERIOUS",
  "CRISIS",
  "NUDGE_FIRST",
  "NUDGE_STREAK",
  "DAY_DONE",
  "DAY_OVER",
  "DAY_PARTIAL",
  "DAY_LOST",
];

export type DialogueVars = {
  name: string;
  daysToExam: number;
  streak: number;
  todayMinutes: number;
  taskCount: number;
  coveragePercent: number;
  finishDate: string;
  droppedCount: number;
  firstTask: string;
  n?: number;
};

const DIALOGUES: Record<
  DialogueKey,
  { subject: string; opening: string; pressure: string | null; close: string }
> = {
  REST_DAY: {
    subject: "Rest day",
    opening: "No tasks today.",
    pressure: null,
    close: "Back tomorrow with {taskCount} tasks.",
  },
  DAY_LIGHT: {
    subject: "Today: {todayMinutes} min",
    opening: "A short one today.",
    pressure: "{daysToExam} days to the exam.",
    close: "Start with {firstTask}.",
  },
  DAY_NORMAL: {
    subject: "Today: {taskCount} tasks, {todayMinutes} min",
    opening: "Here is today.",
    pressure: "{daysToExam} days left, {coveragePercent}% covered.",
    close: "Start with {firstTask}.",
  },
  DAY_HEAVY: {
    subject: "Today is a big one: {todayMinutes} min",
    opening: "Today is heavier than usual.",
    pressure: "Splitting it across the evening is fine. Skipping it is not.",
    close: "Start with {firstTask}.",
  },
  SLIP_1: {
    subject: "You missed yesterday. Today: {todayMinutes} min",
    opening: "Yesterday is gone and the work is not.",
    pressure: "Yesterday's tasks are in today's list. That makes today heavier.",
    close: "Start with {firstTask}.",
  },
  DRIFT: {
    subject: "{streak} days missed. The plan has moved.",
    opening: "Three days of silence. The plan has absorbed what it can.",
    pressure: "You are {streak} days behind and the backlog is now in today's list.",
    close: "Start with {firstTask}.",
  },
  SERIOUS: {
    subject: "{streak} days missed. Your finish date moved to {finishDate}.",
    opening: "This is the {streak}th day in a row with nothing logged.",
    pressure: "At this rate you finish {finishDate}, which is after your exam. {droppedCount} items have already been dropped to fit.",
    close: "Start with {firstTask}. One task. Now.",
  },
  CRISIS: {
    subject: "{streak} days. Read the arithmetic.",
    opening: "A week. Nothing logged.",
    pressure: "{daysToExam} days remain and {coveragePercent}% is covered. The plan can no longer fit what is left. Either the hours go up or the exam date moves.",
    close: "Two choices in the app: add hours, or change the date. Doing neither is also a choice.",
  },
  NUDGE_FIRST: {
    subject: "Nothing logged today",
    opening: "{todayMinutes} minutes are still on today's list. The day closes at midnight and what is not logged is counted as missed. There is still time.",
    pressure: null,
    close: "There is still time.",
  },
  NUDGE_STREAK: {
    subject: "Nothing logged today, and that would make it {streak}",
    opening: "This would be day {streak}. One task logged tonight keeps the streak at {streak} rather than {streak+1}, and the difference compounds.",
    pressure: null,
    close: "One task logged tonight is the difference.",
  },
  DAY_DONE: {
    subject: "Done: {todayMinutes} min",
    opening: "Everything on today's list is logged. {coveragePercent}% covered, {daysToExam} days to go.",
    pressure: null,
    close: "See tomorrow.",
  },
  DAY_OVER: {
    subject: "Done, and then some",
    opening: "You logged past the plan today. Credited in full. Worth knowing: a day like this is not repeatable, and the plan assumes your real weekly hours, not your best day.",
    pressure: null,
    close: "Pace sustainably.",
  },
  DAY_PARTIAL: {
    subject: "Partly done: {n} of {taskCount}",
    opening: "You logged {n} of {taskCount} tasks. The rest moves to tomorrow, which makes tomorrow heavier.",
    pressure: null,
    close: "Prepare for tomorrow.",
  },
  DAY_LOST: {
    subject: "Day closed with nothing logged",
    opening: "Today is closed. It counts as missed, and the streak is now {streak}. {todayMinutes} minutes of work moved to tomorrow.",
    pressure: null,
    close: "See tomorrow's plan.",
  },
};

export function dialogueFor(slot: Slot, state: CoachState): DialogueKey | null {
  if (slot === "prescription") {
    return dialogueForPrescription(state);
  } else if (slot === "nudge") {
    return dialogueForNudge(state);
  } else if (slot === "debrief") {
    return dialogueForDebrief(state);
  }
  return null;
}

function dialogueForPrescription(state: CoachState): DialogueKey {
  if (state.shape === "rest") {
    return "REST_DAY";
  }

  if (state.streak === "on-track") {
    if (state.shape === "light") return "DAY_LIGHT";
    if (state.shape === "normal") return "DAY_NORMAL";
    if (state.shape === "heavy") return "DAY_HEAVY";
    return "DAY_NORMAL";
  }

  if (state.streak === "slip") return "SLIP_1";
  if (state.streak === "drifting") return "DRIFT";
  if (state.streak === "serious") return "SERIOUS";
  if (state.streak === "crisis") return "CRISIS";

  return "DAY_NORMAL";
}

function dialogueForNudge(state: CoachState): DialogueKey | null {
  if (state.logging !== "nothing") {
    return null;
  }

  if (state.shape === "rest") {
    return null;
  }

  if (state.streak === "on-track") {
    return "NUDGE_FIRST";
  }

  return "NUDGE_STREAK";
}

function dialogueForDebrief(state: CoachState): DialogueKey | null {
  if (state.shape === "rest") {
    return null;
  }

  if (state.logging === "nothing") return "DAY_LOST";
  if (state.logging === "partial") return "DAY_PARTIAL";
  if (state.logging === "complete") return "DAY_DONE";
  if (state.logging === "over") return "DAY_OVER";

  return "DAY_DONE";
}

export function renderDialogue(
  key: DialogueKey,
  vars: Partial<DialogueVars>
): { subject: string; opening: string; pressure: string | null; close: string } {
  const dialogue = DIALOGUES[key];

  return {
    subject: substitute(dialogue.subject, vars),
    opening: substitute(dialogue.opening, vars),
    pressure: dialogue.pressure !== null ? substitute(dialogue.pressure, vars) : null,
    close: substitute(dialogue.close, vars),
  };
}

function substitute(text: string, vars: Partial<DialogueVars>): string {
  return text.replace(/{(\w+)(?:\+(\d+))?}/g, (match, key: string, offset?: string) => {
    if (offset) {
      const baseVal = vars[key as keyof DialogueVars];
      if (baseVal === undefined) {
        throw new Error(`Variable '${key}' used in '${key}+${offset}' is not supplied`);
      }
      if (typeof baseVal !== "number") {
        throw new Error(`Variable '${key}' must be a number for arithmetic`);
      }
      return String(baseVal + parseInt(offset, 10));
    }

    const value = vars[key as keyof DialogueVars];
    if (value === undefined) {
      throw new Error(`Variable '${key}' is named in copy but not supplied`);
    }
    return String(value);
  });
}
