// Pure scheduling engine. No DB, no HTTP, no framework.
// Orders modules for study based on prerequisites and strategy, using
// a greedy topological sort.

export type SchedulableGroup = {
  ref: string; // unique group identifier
  readingRefs: string[]; // module refs this group covers
  prereqRefs: string[]; // group refs that must come before this one
  phaseBand: number; // study phase (1, 2, 3...)
  moduleOrder: number; // order within topic
  priorityRank: number; // effort-versus-return ranking
  weight: number; // exam weight as percentage
  estimatedMinutes: number; // minutes of material available
  weightImpliedMinutes: number; // exam-weight share of study plan
  confidence?: number; // optional confidence figure for the confidence strategy
};

export type Strategy = "curriculum" | "weight" | "confidence";

// Return per hour divides by max(estimatedMinutes, weightImpliedMinutes)
// so a module cannot win on cheapness caused by missing material.
function returnPerHour(group: SchedulableGroup): number {
  const denominator = Math.max(group.estimatedMinutes, group.weightImpliedMinutes);
  if (denominator <= 0) return 0;
  return group.weight / denominator;
}

// Extract topic from ref (e.g., "qm" from "qm/lm1").
function topic(ref: string): string {
  const parts = ref.split("/");
  return parts.length > 0 ? parts[0] : ref;
}

// Compare two groups lexicographically over the sort keys.
// lastTopic is used for topic cohesion (prefer continuing the same topic).
function compareGroups(
  a: SchedulableGroup,
  b: SchedulableGroup,
  strategy: Strategy,
  lastTopic: string | null
): number {
  // Topic cohesion: prefer continuing the topic we just placed.
  const aTopicContinues = lastTopic !== null && topic(a.ref) === lastTopic;
  const bTopicContinues = lastTopic !== null && topic(b.ref) === lastTopic;
  if (aTopicContinues && !bTopicContinues) return -1;
  if (!aTopicContinues && bTopicContinues) return 1;

  // First term: strategy-dependent.
  let aFirst: number;
  let bFirst: number;

  if (strategy === "curriculum") {
    aFirst = a.phaseBand;
    bFirst = b.phaseBand;
  } else if (strategy === "weight") {
    aFirst = a.weight;
    bFirst = b.weight;
  } else if (strategy === "confidence") {
    aFirst = a.confidence ?? 3;
    bFirst = b.confidence ?? 3;
  } else {
    throw new Error(`Unknown strategy: ${strategy}`);
  }

  if (aFirst !== bFirst) {
    // For weight, higher is better (reverse). For curriculum and confidence, lower is better.
    if (strategy === "weight") {
      return bFirst - aFirst;
    } else {
      return aFirst - bFirst;
    }
  }

  // Module order within topic.
  if (a.moduleOrder !== b.moduleOrder) {
    return a.moduleOrder - b.moduleOrder;
  }

  // Priority rank (higher is better, so reverse).
  if (a.priorityRank !== b.priorityRank) {
    return b.priorityRank - a.priorityRank;
  }

  // Return per hour (higher is better, so reverse).
  const aRph = returnPerHour(a);
  const bRph = returnPerHour(b);
  if (aRph !== bRph) {
    return bRph - aRph;
  }

  // Ref as deterministic last resort.
  return a.ref.localeCompare(b.ref);
}

/**
 * Order modules for study using a greedy topological sort.
 * Groups are iterated in order, respecting prerequisites. The sort key
 * is lexicographic over: phase band, topic cohesion, module order, priority
 * rank, return per hour, and ref. Which term leads depends on the strategy.
 *
 * Throws if a cycle is detected (no ready group while groups remain).
 */
export function orderModules(
  groups: SchedulableGroup[],
  strategy: Strategy
): SchedulableGroup[] {
  const remaining = new Map(groups.map((g) => [g.ref, g]));
  const result: SchedulableGroup[] = [];
  let lastTopic: string | null = null;

  while (remaining.size > 0) {
    // Find all ready groups (all prerequisites placed).
    const ready: SchedulableGroup[] = [];
    for (const group of remaining.values()) {
      const allPrereqsSatisfied = group.prereqRefs.every(
        (prereqRef) => !remaining.has(prereqRef)
      );
      if (allPrereqsSatisfied) {
        ready.push(group);
      }
    }

    // Cycle detection: no ready group while groups remain.
    if (ready.length === 0) {
      const cycledRefs = Array.from(remaining.keys()).sort();
      throw new Error(`Prerequisite cycle detected among groups: ${cycledRefs.join(", ")}`);
    }

    // Sort ready groups by the comparison function.
    ready.sort((a, b) => compareGroups(a, b, strategy, lastTopic));

    // Pick the best ready group.
    const best = ready[0];
    result.push(best);
    remaining.delete(best.ref);
    lastTopic = topic(best.ref);
  }

  return result;
}
