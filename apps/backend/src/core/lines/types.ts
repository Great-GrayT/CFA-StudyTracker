/**
 * Shared shape for every dialogue line, plus the full key union.
 *
 * Voice, for anyone adding lines: theatrical, sarcastic, visibly delighted by
 * the candidate's predicament, and built on famous lines bent out of shape. The
 * menace only works because the arithmetic underneath is true, so every number
 * in these strings comes from a real variable and never from invention.
 */

import type { HorizonBand, Phase } from "../coach-state.ts";

/**
 * Coarse weather buckets for the candidate's own city.
 *
 * Deliberately coarse, and deliberately about today rather than a forecast. The
 * whole voice rests on the arithmetic underneath being true: a coach that says
 * "lovely clear day" during a storm loses the authority that makes every other
 * line land, and does not get it back. Buckets we can be confident about beat
 * precision we cannot.
 *
 * `dark-early` comes from daylight length rather than conditions, because a
 * sixteen-hundred sunset is a better predictor of an evening at the desk than
 * any amount of rain.
 */
export type WeatherTag =
  | "rain"
  | "snow"
  | "storm"
  | "heat"
  | "cold"
  | "clear-warm"
  | "dark-early";

export type DialogueLine = {
  subject: string;
  opening: string;
  pressure: string | null;
  close: string;
  /**
   * Optional eligibility tags. A line with no tags is always eligible; a tagged
   * line is only offered when the candidate is in one of the listed bands or
   * phases.
   *
   * This exists so exam proximity can colour the copy without multiplying the
   * state count. Crossing five streak bands by five shapes by eight horizons by
   * three phases is six hundred states, which nobody can write or review. Tags
   * let one state hold a line that only appears in the last fortnight while the
   * untagged lines in the same pool carry the rest of the year.
   *
   * Invariant, enforced by test: every pool keeps at least three UNTAGGED lines,
   * so no combination of context can filter a pool down to nothing.
   */
  horizon?: HorizonBand[];
  phase?: Phase[];
  /**
   * Weather in the candidate's own city, when they have told us where that is
   * and the lookup succeeded.
   *
   * Weather is a tag and never a state, for one reason: the forecast service
   * will be unreachable on some mornings, and a missed email is a far worse
   * outcome than a generic one. An absent reading means weather-tagged lines are
   * simply not offered, and the untagged floor carries the day as usual.
   */
  weather?: WeatherTag[];
};

export type DialogueKey =
  // Prescription for an ordinary day: shape crossed with streak band
  | "P_NORMAL" | "P_SLIP" | "P_DRIFT" | "P_SERIOUS" | "P_CRISIS"
  | "P_LIGHT" | "P_LIGHT_SLIP" | "P_LIGHT_BEHIND"
  | "P_HEAVY" | "P_HEAVY_BEHIND"
  | "P_CATCHUP_SLIP" | "P_CATCHUP_DRIFT" | "P_CATCHUP_DEEP"
  // Days the plan gives away, and the transitions either side of them
  | "P_REST_CLEAN" | "P_REST_BEHIND"
  | "P_REST_MID" | "P_REST_LAST" | "P_HOLIDAY_AHEAD"
  | "P_BACK_CLEAN" | "P_BACK_BEHIND"
  // The endgame, where the horizon stops being background and becomes the point
  | "P_FINAL_WEEK" | "P_FINAL_WEEK_BEHIND"
  | "P_EXAM_EVE" | "P_EXAM_DAY" | "P_PAST"
  // Evening nudge, only when the day is live and nothing is logged
  | "N_FIRST" | "N_SLIP" | "N_DRIFT" | "N_SERIOUS" | "N_CRISIS"
  | "N_FINAL_WEEK"
  // Night debrief, keyed by what was logged against what was asked
  | "D_LOST_FIRST" | "D_LOST_STREAK"
  | "D_PARTIAL" | "D_PARTIAL_BEHIND"
  | "D_DONE" | "D_DONE_COMEBACK" | "D_OVER"
  | "D_REST_BONUS" | "D_EXAM_EVE"
  // Real study pointed at the wrong material. Separate from every "nothing"
  // state because these candidates worked, and copy that calls them idle is
  // the bug these keys exist to fix.
  | "N_OFF_PLAN" | "D_OFF_PLAN" | "D_OFF_PLAN_BEHIND";

/**
 * Every key, listed explicitly rather than derived from the assembled table.
 *
 * This is deliberate and it is load bearing. The obvious alternative,
 * `Object.keys(LINES)`, is circular: a pool accidentally left out of the barrel
 * would shrink the key list too, so every test that iterates the list would
 * still pass while the state silently had no copy behind it. Listing the keys
 * here means the barrel is checked against an independent source of truth.
 *
 * The guard below makes a key in the union but missing from this array a
 * compile error, so the two cannot drift.
 */
export const ALL_KEYS = [
  "P_NORMAL", "P_SLIP", "P_DRIFT", "P_SERIOUS", "P_CRISIS",
  "P_LIGHT", "P_LIGHT_SLIP", "P_LIGHT_BEHIND",
  "P_HEAVY", "P_HEAVY_BEHIND",
  "P_CATCHUP_SLIP", "P_CATCHUP_DRIFT", "P_CATCHUP_DEEP",
  "P_REST_CLEAN", "P_REST_BEHIND",
  "P_REST_MID", "P_REST_LAST", "P_HOLIDAY_AHEAD",
  "P_BACK_CLEAN", "P_BACK_BEHIND",
  "P_FINAL_WEEK", "P_FINAL_WEEK_BEHIND",
  "P_EXAM_EVE", "P_EXAM_DAY", "P_PAST",
  "N_FIRST", "N_SLIP", "N_DRIFT", "N_SERIOUS", "N_CRISIS", "N_FINAL_WEEK",
  "D_LOST_FIRST", "D_LOST_STREAK",
  "D_PARTIAL", "D_PARTIAL_BEHIND",
  "D_DONE", "D_DONE_COMEBACK", "D_OVER",
  "D_REST_BONUS", "D_EXAM_EVE",
  "N_OFF_PLAN", "D_OFF_PLAN", "D_OFF_PLAN_BEHIND",
] as const satisfies readonly DialogueKey[];

// Fails to compile if the union gains a key that ALL_KEYS does not list.
type Unlisted = Exclude<DialogueKey, (typeof ALL_KEYS)[number]>;
const _everyKeyIsListed: Unlisted extends never ? true : Unlisted = true;
void _everyKeyIsListed;
