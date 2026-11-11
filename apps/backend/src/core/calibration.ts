// Pure calibration engine: learn individual pace multiplier from logged durations.
// No DB, no HTTP, no framework. Tasks 7-8 import factorFor to adjust effort estimates.

export type FactorNode = {
  kObs: number; // EWMA of clamped ratios
  n: number; // observation count
};

export type FactorKey = {
  provider: string;
  kind: string;
  topic?: string;
};

export type FactorTree = {
  global: FactorNode;
  byProviderKind: Record<string, FactorNode>;
  byProviderKindTopic: Record<string, FactorNode>;
};

// Alpha for EWMA with half-life 14 observations.
// Half-life means after 14 observations, weight on oldest observation drops to 0.5.
// alpha = 1 - 2^(-1/14) ≈ 0.048167
const EWMA_ALPHA = 1 - Math.pow(2, -1 / 14);

// Shrinkage blending weight: at n=5 observations, node and parent evidence carry equal weight.
const SHRINKAGE_M = 5;

// Clamp ratio to prevent forgotten timers and zero-durations from dominating.
// Min 0.25 (candidate runs 4x estimated), max 4.0 (candidate runs 1/4x estimated).
function clampRatio(actual: number, estimated: number): number {
  const ratio = actual / estimated;
  return Math.max(0.25, Math.min(4.0, ratio));
}

/**
 * Update a factor node with one new observation (actual vs estimated duration).
 * Pure: returns a new node, never mutates the input.
 * Order matters: clamp BEFORE EWMA, never after. Clamping the average lets one
 * extreme move it first and be trimmed second, defeating the point of the clamp.
 */
export function updateFactor(
  prior: FactorNode,
  observation: { estimated: number; actual: number }
): FactorNode {
  const r = clampRatio(observation.actual, observation.estimated);

  // On first observation, initialize kObs with the clamped ratio.
  // On subsequent observations, blend with EWMA.
  const kObs =
    prior.n === 0
      ? r
      : EWMA_ALPHA * r + (1 - EWMA_ALPHA) * prior.kObs;

  return {
    kObs,
    n: prior.n + 1,
  };
}

/**
 * Query a factor from the tree, descending the hierarchy and falling back to
 * parent level if a node has no observations.
 *
 * Hierarchy levels and fallback:
 * - (provider, kind, topic): if has observations, use its blended kHat; else parent
 * - (provider, kind): if has observations, use its blended kHat; else global
 * - global: factor is kObs directly (no parent to blend with)
 *
 * Blending: kHat = (n * kObs + m * parentFactor) / (n + m) with m = 5
 */
export function factorFor(tree: FactorTree, key: FactorKey): number {
  if (key.topic) {
    // Deeper level: (provider, kind, topic)
    const deepKeyStr = `${key.provider}|${key.kind}|${key.topic}`;
    const deepNode = tree.byProviderKindTopic[deepKeyStr];

    if (deepNode && deepNode.n > 0) {
      // Has observations: blend with parent factor
      const parentFactor = factorFor(tree, {
        provider: key.provider,
        kind: key.kind,
      });
      return (
        (deepNode.n * deepNode.kObs + SHRINKAGE_M * parentFactor) /
        (deepNode.n + SHRINKAGE_M)
      );
    }

    // No observations: fall back to parent factor
    return factorFor(tree, { provider: key.provider, kind: key.kind });
  }

  // Mid level: (provider, kind)
  const midKeyStr = `${key.provider}|${key.kind}`;
  const midNode = tree.byProviderKind[midKeyStr];

  if (midNode && midNode.n > 0) {
    // Has observations: blend with global factor
    return (
      (midNode.n * midNode.kObs + SHRINKAGE_M * tree.global.kObs) /
      (midNode.n + SHRINKAGE_M)
    );
  }

  // No observations: fall back to global factor
  return tree.global.kObs;
}
