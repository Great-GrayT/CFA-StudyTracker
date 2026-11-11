import type { CoachState, HorizonBand, Phase } from "./coach-state";
import type { Slot } from "./slots";
import type { DialogueKey, DialogueLine, WeatherTag } from "./coach-lines";
import { LINES, ALL_KEYS } from "./coach-lines";

export type { DialogueKey } from "./coach-lines";

export const ALL_DIALOGUE_KEYS: readonly DialogueKey[] = ALL_KEYS;

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
  /** Length in days of the holiday block in play. Zero when none is. */
  restDays: number;
  /** Which day of that block today is, 1-based. Zero when today is not one. */
  dayOfBlock: number;
  /**
   * Tasks completed today.
   *
   * Named `n` for historical reasons and kept that way because the debrief copy
   * already reads "{n} of {taskCount}". Holiday copy must use `dayOfBlock`
   * instead: the two meanings collided here once, and a single variable serving
   * both printed the task count as a holiday day number.
   */
  n: number;
};

/**
 * What the tag filter needs.
 *
 * `horizon` and `phase` always exist. `weather` is optional twice over: the
 * candidate may not have told us where they are, and the lookup may have
 * failed. Either way the absence is normal rather than exceptional.
 */
export type LineContext = {
  horizon: HorizonBand;
  phase: Phase;
  weather?: WeatherTag[];
};

/**
 * Which state this slot is in.
 *
 * Four dimensions decide it, in a deliberate precedence order:
 *
 *   horizon   how far the exam is, which outranks everything near the end
 *   holiday   whether today sits inside, beside, or after a break
 *   shape     what the plan actually asks for today
 *   streak    how many days have been missed
 *
 * Streak and shape CROSS rather than one overriding the other, because resting
 * while on track and resting while four days behind are not the same joke, and
 * a heavy day lands differently when the candidate is already drowning.
 *
 * Returns null when no email should be sent at all, which is a correct outcome
 * rather than an error: a nudge on a rest day, a nudge once something is
 * logged, or anything at all after the exam has passed.
 */
export function dialogueFor(slot: Slot, state: CoachState): DialogueKey | null {
  if (slot === "prescription") return prescriptionKey(state);
  if (slot === "nudge") return nudgeKey(state);
  return debriefKey(state);
}

function prescriptionKey(state: CoachState): DialogueKey {
  const behind = state.streak !== "on-track";

  // The endgame outranks every other dimension. On these three days the state
  // of the backlog is no longer actionable, so copy about it would be cruelty
  // with no behaviour attached.
  if (state.horizon === "past") return "P_PAST";
  if (state.horizon === "exam-day") return "P_EXAM_DAY";
  if (state.horizon === "exam-eve") return "P_EXAM_EVE";

  // Rest wins next, because a day with no work cannot be made to carry work by
  // being behind. Where in the break it falls decides which rest line it is.
  if (state.shape === "rest") {
    if (state.holiday === "mid-break") return "P_REST_MID";
    if (state.holiday === "last-day") return "P_REST_LAST";
    return behind ? "P_REST_BEHIND" : "P_REST_CLEAN";
  }

  // The final week outranks the day's shape. Inside seven days the shape of one
  // day stops being the story and the distance to the exam becomes it.
  if (state.horizon === "final-week") {
    return behind ? "P_FINAL_WEEK_BEHIND" : "P_FINAL_WEEK";
  }

  // Coming back from a break is the day that decides whether a planned rest
  // quietly became a streak, so it gets its own voice rather than a generic one.
  if (state.holiday === "first-day-back") {
    return behind ? "P_BACK_BEHIND" : "P_BACK_CLEAN";
  }

  // The last day before a break is the only day where "do it now" is literally
  // true, since tomorrow has no slot to push into. It yields to a deep streak
  // though: at four days missed the streak is the more urgent fact.
  if (
    state.holiday === "starts-tomorrow" &&
    state.streak !== "serious" &&
    state.streak !== "crisis"
  ) {
    return "P_HOLIDAY_AHEAD";
  }

  // Catch-up implies requeued work, which implies a missed day, so there is no
  // on-track variant to reach.
  if (state.shape === "catch-up") {
    if (state.streak === "slip") return "P_CATCHUP_SLIP";
    if (state.streak === "drifting") return "P_CATCHUP_DRIFT";
    return "P_CATCHUP_DEEP";
  }

  if (state.shape === "heavy") return behind ? "P_HEAVY_BEHIND" : "P_HEAVY";

  if (state.shape === "light") {
    if (!behind) return "P_LIGHT";
    return state.streak === "slip" ? "P_LIGHT_SLIP" : "P_LIGHT_BEHIND";
  }

  // A normal day is where the full streak escalation lives.
  switch (state.streak) {
    case "on-track":
      return "P_NORMAL";
    case "slip":
      return "P_SLIP";
    case "drifting":
      return "P_DRIFT";
    case "serious":
      return "P_SERIOUS";
    case "crisis":
      return "P_CRISIS";
  }
}

function nudgeKey(state: CoachState): DialogueKey | null {
  // Nothing to nudge about on a rest day, or once the candidate has logged.
  if (state.shape === "rest") return null;
  if (state.logging !== "nothing") return null;

  // No prodding on the eve, the day, or after. On the eve the only thing a
  // nudge can add is anxiety, and anxiety the night before costs marks.
  if (state.horizon === "exam-eve") return null;
  if (state.horizon === "exam-day") return null;
  if (state.horizon === "past") return null;

  // Inside the final week an unused evening cannot be recovered later, because
  // there is no later. That is a different message, not a louder one.
  if (state.horizon === "final-week") return "N_FINAL_WEEK";

  switch (state.streak) {
    case "on-track":
      return "N_FIRST";
    case "slip":
      return "N_SLIP";
    case "drifting":
      return "N_DRIFT";
    case "serious":
      return "N_SERIOUS";
    case "crisis":
      return "N_CRISIS";
  }
}

function debriefKey(state: CoachState): DialogueKey | null {
  if (state.horizon === "past") return null;
  // Nothing to report on the day itself: the candidate sat an exam and the app
  // has no idea how it went.
  if (state.horizon === "exam-day") return null;
  if (state.horizon === "exam-eve") return "D_EXAM_EVE";

  if (state.shape === "rest") {
    // Work logged on a day the plan gave away is worth noticing. Silence here
    // would mean the one time a candidate went beyond the plan went unseen.
    return state.logging === "nothing" ? null : "D_REST_BONUS";
  }

  const behind = state.streak !== "on-track";

  switch (state.logging) {
    case "nothing":
      return behind ? "D_LOST_STREAK" : "D_LOST_FIRST";
    case "partial":
      return behind ? "D_PARTIAL_BEHIND" : "D_PARTIAL";
    case "complete":
      // A complete day after a streak is the one moment worth celebrating, and
      // it needs its own voice: the coach has to notice the comeback or the
      // pressure everywhere else reads as indiscriminate.
      return behind ? "D_DONE_COMEBACK" : "D_DONE";
    case "over":
      return "D_OVER";
  }
}

/**
 * Which variant of a state's pool to use, chosen by the local date.
 *
 * Deterministic rather than random, for two reasons. A test can pin a date and
 * assert exact copy, which randomness would make impossible. And consecutive
 * days rotate, so the candidate does not read the same joke twice running,
 * which is what kills this kind of voice fastest.
 */
export function variantIndex(localDate: string, poolSize: number): number {
  let hash = 0;
  for (let i = 0; i < localDate.length; i++) {
    hash = (hash * 31 + localDate.charCodeAt(i)) % 2147483647;
  }
  return hash % poolSize;
}

/**
 * The lines in a pool that this context may see.
 *
 * Untagged lines are always eligible. A tagged line only appears when the
 * candidate is in one of its bands or phases, which is how exam proximity
 * colours the copy without multiplying the state count.
 *
 * With no context every line is eligible, which is what preview and the
 * render-everything tests want. Production always passes a context.
 */
export function eligibleLines(key: DialogueKey, context?: LineContext): DialogueLine[] {
  const pool = LINES[key];
  if (!context) return pool;

  const eligible = pool.filter((line) => {
    if (line.horizon !== undefined && !line.horizon.includes(context.horizon)) return false;
    if (line.phase !== undefined && !line.phase.includes(context.phase)) return false;
    // A weather-tagged line needs a reading that overlaps its tags. No reading
    // at all means no weather lines, which is the correct degraded behaviour
    // rather than a reason to fail.
    if (line.weather !== undefined) {
      const observed = context.weather ?? [];
      if (!line.weather.some((w) => observed.includes(w))) return false;
    }
    return true;
  });

  // Cannot happen while the untagged-floor test passes, and if it ever does the
  // right failure is a loud one rather than an email with no body.
  if (eligible.length === 0) {
    throw new Error(`No line in ${key} is eligible at horizon ${context.horizon}`);
  }
  return eligible;
}

export function lineFor(
  key: DialogueKey,
  localDate: string,
  context?: LineContext
): DialogueLine {
  const pool = eligibleLines(key, context);
  return pool[variantIndex(localDate, pool.length)];
}

export function renderDialogue(
  key: DialogueKey,
  vars: Partial<DialogueVars>,
  localDate = "2027-01-04",
  context?: LineContext
): { subject: string; opening: string; pressure: string | null; close: string } {
  const line = lineFor(key, localDate, context);

  return {
    subject: substitute(line.subject, vars),
    opening: substitute(line.opening, vars),
    pressure: line.pressure !== null ? substitute(line.pressure, vars) : null,
    close: substitute(line.close, vars),
  };
}

/**
 * Substitution throws on an unsupplied variable rather than rendering an empty
 * string. An email reading "You are  days behind" is worse than an error a
 * developer sees, because the candidate sees the former and nobody sees that it
 * was meant to say something.
 */
function substitute(text: string, vars: Partial<DialogueVars>): string {
  return text.replace(/{(\w+)(?:\+(\d+))?}/g, (_match, key: string, offset?: string) => {
    const value = vars[key as keyof DialogueVars];
    if (value === undefined) {
      throw new Error(`Variable '${key}' is named in copy but not supplied`);
    }
    if (offset) {
      if (typeof value !== "number") {
        throw new Error(`Variable '${key}' must be a number for arithmetic`);
      }
      return String(value + parseInt(offset, 10));
    }
    return String(value);
  });
}
