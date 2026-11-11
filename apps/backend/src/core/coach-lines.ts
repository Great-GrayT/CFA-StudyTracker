/**
 * The coach's lines, assembled from the per-slot modules in `lines/`.
 *
 * This file is a barrel on purpose. The copy was one 688-line literal at 92
 * dialogues; at 200 a reviewer checking the comedy could not find the routing
 * and a reviewer checking the routing could not escape the comedy. The split is
 * by what question the copy answers, not by alphabet:
 *
 *   lines/prescription.ts  an ordinary study day, shape crossed with streak
 *   lines/rest.ts          days the plan gives away
 *   lines/rhythm.ts        the days either side of a break
 *   lines/endgame.ts       the last fortnight, the eve, the day, and after
 *   lines/nudge.ts         the evening prod when nothing is logged
 *   lines/debrief.ts       the night report on what actually happened
 *   lines/offplan.ts       real study aimed at the wrong material
 *
 * Every existing import of `LINES`, `DialogueKey` and `DialogueLine` from this
 * path keeps working, which is why the barrel exists rather than a flag day.
 */

import type { DialogueKey, DialogueLine } from "./lines/types.ts";
import { ALL_KEYS } from "./lines/types.ts";
import { POOLS as PRESCRIPTION } from "./lines/prescription.ts";
import { POOLS as REST } from "./lines/rest.ts";
import { POOLS as RHYTHM } from "./lines/rhythm.ts";
import { POOLS as ENDGAME } from "./lines/endgame.ts";
import { POOLS as NUDGE } from "./lines/nudge.ts";
import { POOLS as DEBRIEF } from "./lines/debrief.ts";
import { POOLS as OFFPLAN } from "./lines/offplan.ts";

export type { DialogueKey, DialogueLine, WeatherTag } from "./lines/types.ts";
export { ALL_KEYS } from "./lines/types.ts";

const ASSEMBLED: Record<string, DialogueLine[]> = {
  ...PRESCRIPTION,
  ...REST,
  ...RHYTHM,
  ...ENDGAME,
  ...NUDGE,
  ...DEBRIEF,
  ...OFFPLAN,
};

/**
 * Assembled at module load, checked against the explicit key list rather than
 * trusted. A pool left out of a module, or a module left out of the barrel,
 * throws here on import instead of surfacing as an undefined pool at half past
 * six in the morning in front of a candidate.
 */
function assemble(): Record<DialogueKey, DialogueLine[]> {
  const missing = ALL_KEYS.filter((k) => !Array.isArray(ASSEMBLED[k]));
  if (missing.length > 0) {
    throw new Error(`Dialogue states declared but with no copy behind them: ${missing.join(", ")}`);
  }

  const extra = Object.keys(ASSEMBLED).filter(
    (k) => !(ALL_KEYS as readonly string[]).includes(k)
  );
  if (extra.length > 0) {
    throw new Error(`Dialogue copy with no state to reach it: ${extra.join(", ")}`);
  }

  return ASSEMBLED as Record<DialogueKey, DialogueLine[]>;
}

export const LINES = assemble();
