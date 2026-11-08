// Coverage maths, kept out of the component so it can be tested as logic and
// reused by the treemap fallback and the table view without importing React.

export type TopicCoverage = {
  topicId: string;
  name: string;
  weightMin: number;
  weightMax: number;
  covered: number;
  total: number;
};

/**
 * Exam weight still unclaimed in a topic, in percentage points.
 *
 * The midpoint stands in for the official range, which is why the range itself
 * is always printed beside the bar: the midpoint is a sort key, not a fact.
 *
 * A topic with no outcomes counts as fully uncovered rather than dividing by
 * zero. That is the honest reading: an unseeded topic is not finished.
 */
export function uncoveredWeightPoints(t: TopicCoverage): number {
  const midpoint = (t.weightMin + t.weightMax) / 2;
  const coveredFraction = t.total === 0 ? 0 : t.covered / t.total;
  return midpoint * (1 - coveredFraction);
}

/**
 * Orders topics by what is actually at stake. This is what makes the hero
 * readable without reading every row: a heavily weighted untouched topic
 * reaches the top by construction.
 */
export function sortByStake(topics: TopicCoverage[]): TopicCoverage[] {
  return [...topics].sort((a, b) => uncoveredWeightPoints(b) - uncoveredWeightPoints(a));
}

/**
 * Coverage across the level, weighted by exam weight rather than a flat
 * outcome count. Finishing every outcome in a 5 percent topic while a 20
 * percent topic sits untouched must not read as most of the way done.
 */
export function weightedCoveragePercent(topics: TopicCoverage[]): number {
  const totalWeight = topics.reduce((sum, t) => sum + (t.weightMin + t.weightMax) / 2, 0);
  if (totalWeight === 0) return 0;
  const uncovered = topics.reduce((sum, t) => sum + uncoveredWeightPoints(t), 0);
  return ((totalWeight - uncovered) / totalWeight) * 100;
}
