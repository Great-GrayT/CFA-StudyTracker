// Pure sequencing engine. No DB, no HTTP, no framework.
// Chooses the order units are read in, given the plan mode the candidate set.
//
// This module exists because of a specific defect. ordering.ts checks topic
// cohesion BEFORE the phase band, which makes cohesion a tiebreak rather than
// a structure: a topic area runs to exhaustion and the next one starts
// wherever the day happens to end, so a single week could read Ethics, then
// Quantitative Methods, then the head of Financial Statement Analysis. Nothing
// in that engine knows the curriculum has an order, because SchedulableGroup
// carries no ordinal for the topic area at all.
//
// The fix is to carry one. topicOrder is supplied by the caller from the
// Topic.order column rather than parsed out of ref, because parsing an order
// out of a string identifier is how planners come to read Ethics before Quant.

import type { SchedulableGroup, Strategy } from "./ordering";
import { orderModules } from "./ordering";
import type { PlanMode } from "./tuning";

export type SequencableGroup = SchedulableGroup & {
  topicOrder: number; // curriculum position of this unit's topic area
};

/**
 * Greedy topological sort over the prerequisite graph, picking the lowest
 * (topicOrder, moduleOrder, ref) among the units whose prerequisites are all
 * placed.
 *
 * Topic cohesion is not a term here. Ordering by topicOrder first makes
 * cohesion a consequence: a topic area cannot be left and returned to unless a
 * prerequisite forces it, which is the one case where leaving it is correct.
 */
function sequenceByCurriculum(groups: SequencableGroup[]): SequencableGroup[] {
  const remaining = new Map(groups.map((g) => [g.ref, g]));
  const result: SequencableGroup[] = [];

  while (remaining.size > 0) {
    const ready: SequencableGroup[] = [];
    for (const group of remaining.values()) {
      if (group.prereqRefs.every((ref) => !remaining.has(ref))) {
        ready.push(group);
      }
    }

    if (ready.length === 0) {
      const cycledRefs = Array.from(remaining.keys()).sort();
      throw new Error(
        `Prerequisite cycle detected among groups: ${cycledRefs.join(", ")}`,
      );
    }

    ready.sort((a, b) => {
      if (a.topicOrder !== b.topicOrder) return a.topicOrder - b.topicOrder;
      if (a.moduleOrder !== b.moduleOrder) return a.moduleOrder - b.moduleOrder;
      return a.ref.localeCompare(b.ref);
    });

    const best = ready[0];
    result.push(best);
    remaining.delete(best.ref);
  }

  return result;
}

/**
 * Order units for the first pass according to the plan mode.
 *
 * `effort-return` is today's engine, delegated unchanged so the candidate can
 * switch back and compare against something that really is the old behaviour.
 *
 * `curriculum-strict` and `curriculum-topic` share this sequence exactly. They
 * diverge only later, in whether the review phase may reorder anything, which
 * is reviewQueue's decision and not this function's.
 *
 * Throws if a prerequisite cycle makes any order impossible.
 */
export function sequenceUnits(
  groups: SequencableGroup[],
  mode: PlanMode,
  legacyStrategy: Strategy = "curriculum",
): SequencableGroup[] {
  if (mode === "effort-return") {
    // orderModules returns SchedulableGroup, but every element is one of the
    // inputs, so the topicOrder each carries survives the round trip.
    //
    // legacyStrategy is StudyPlan.orderingStrategy. It is no longer a
    // candidate-facing choice, but inside this mode it is still the thing that
    // picks the leading sort term, and dropping it would silently reduce three
    // old behaviours to one. Throws on an unrecognised value, as it always
    // did, which is what makes a corrupt strategy a loud failure rather than a
    // quiet fallback.
    return orderModules(groups, legacyStrategy) as SequencableGroup[];
  }

  // The two curriculum modes share this sequence exactly and ignore
  // legacyStrategy: a candidate who asked for curriculum order gets it.
  return sequenceByCurriculum(groups);
}
