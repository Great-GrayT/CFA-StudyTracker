import { adequateMinutes, step1Minutes } from "./catalog";
import { MIN_PER_QUESTION } from "./rules";
import type { Declaration } from "./state";
import type { ModuleCatalog } from "./types";

/**
 * Minutes a stated step counts as study on its date, at the rates the engine credits it with. One
 * helper so the projection's done minutes and the schedule's day capacity agree.
 */
export function declaredMinutes(m: ModuleCatalog, d: Declaration): number {
  if (d.step === 1) return d.confidence !== null && d.confidence <= 2 ? 0 : step1Minutes(m);
  if (d.step === 3) return m.options[3][0]?.minutes ?? 0;
  const step = d.step as 2 | 4;
  if (d.answered === null) return adequateMinutes(m, step);
  const o = m.options[step][0];
  const perQ = (o?.minutesPerQuestion ?? MIN_PER_QUESTION) + (o?.answerReviewPerQuestion ?? MIN_PER_QUESTION / 3);
  return d.answered * perQ;
}
