import { test, expect } from "vitest";
import type { FactorNode, FactorTree, FactorKey } from "./calibration";
import { updateFactor, factorFor } from "./calibration";

// Alpha for EWMA with half-life 14:
// alpha = 1 - 2^(-1/14)
// 2^(-1/14) ≈ 0.951833
// alpha ≈ 0.048167
const ALPHA = 1 - Math.pow(2, -1 / 14);

// Create empty node (no observations)
const EMPTY: FactorNode = { kObs: 0, n: 0 };

// Create tree with a specific factor at (provider, kind) level
function treeWith(key: FactorKey, factor: number): FactorTree {
  const globalNode: FactorNode = { kObs: factor, n: 1 };
  const tree: FactorTree = {
    global: globalNode,
    byProviderKind: {},
    byProviderKindTopic: {},
  };

  if (key.topic) {
    const keyStr = `${key.provider}|${key.kind}|${key.topic}`;
    tree.byProviderKindTopic[keyStr] = { kObs: factor, n: 1 };
  } else {
    const keyStr = `${key.provider}|${key.kind}`;
    tree.byProviderKind[keyStr] = { kObs: factor, n: 1 };
  }

  return tree;
}

// Compute kHat (the blended factor accounting for shrinkage)
function blended(node: FactorNode, parentFactor: number): number {
  const m = 5;
  return (node.n * node.kObs + m * parentFactor) / (node.n + m);
}

test("with no observations the factor is its parent's", () => {
  const tree: FactorTree = {
    global: { kObs: 1.4, n: 1 },
    byProviderKind: {},
    byProviderKindTopic: {},
  };
  // (provider, kind) has no observations, should fall back to global
  expect(factorFor(tree, { provider: "mm", kind: "lecture" })).toBeCloseTo(
    1.4,
    2
  );
});

test("ten identical observations at ratio 1.5 hold kObs at 1.5", () => {
  let node = EMPTY;
  for (let i = 0; i < 10; i++)
    node = updateFactor(node, { estimated: 60, actual: 90 });
  // With first observation initializing kObs and all subsequent at same value,
  // kObs stays constant at 1.5
  expect(node.kObs).toBeCloseTo(1.5, 1);
  expect(node.n).toBe(10);
});

test("a forgotten timer cannot dominate the learned factor", () => {
  let node = EMPTY;
  // Five observations at ratio 1.0
  for (let i = 0; i < 5; i++)
    node = updateFactor(node, { estimated: 60, actual: 60 });

  const before = node.kObs;
  expect(before).toBe(1.0);

  // One observation at ratio 400, clamped to 4.0
  node = updateFactor(node, { estimated: 60, actual: 24000 });

  // With clamp:
  // kObs = alpha * 4.0 + (1 - alpha) * 1.0
  // ≈ 0.048167 * 4.0 + 0.951833 * 1.0
  // ≈ 0.19267 + 0.95183 ≈ 1.14450
  const expectedClamped = ALPHA * 4.0 + (1 - ALPHA) * 1.0;
  expect(node.kObs).toBeCloseTo(expectedClamped, 4);
  expect(node.kObs).toBeLessThan(before * 1.6);

  // Verify clamp was necessary by computing unclamped
  const unclamped = ALPHA * 400 + (1 - ALPHA) * 1.0;
  expect(unclamped).toBeGreaterThan(node.kObs * 10);
});

test("five observations put the blend halfway between node and parent", () => {
  let node = EMPTY;
  // Five observations at ratio 2.0 (actual 120, estimated 60)
  for (let i = 0; i < 5; i++)
    node = updateFactor(node, { estimated: 60, actual: 120 });

  expect(node.n).toBe(5);
  expect(node.kObs).toBe(2.0);

  // kHat(5) = (5 * kObs + 5 * parentFactor) / 10 = (kObs + parentFactor) / 2
  // With parent = 1.0: kHat = (2.0 + 1.0) / 2 = 1.5
  const result = blended(node, 1.0);
  expect(result).toBeCloseTo(1.5, 1);
});

test("a deeper node falls back to its parent until it has observations", () => {
  const tree = treeWith({ provider: "mm", kind: "lecture" }, 1.4);
  // Query a deeper level with no observations
  expect(factorFor(tree, { provider: "mm", kind: "lecture", topic: "qm" })).toBeCloseTo(
    1.4,
    2
  );
});

test("updateFactor does not mutate its input", () => {
  const prior = { kObs: 1.0, n: 3 };
  const priorCopy = { ...prior };

  updateFactor(prior, { estimated: 60, actual: 90 });

  expect(prior).toEqual(priorCopy);
});

test("observation count increments with each update", () => {
  let node = EMPTY;
  expect(node.n).toBe(0);

  node = updateFactor(node, { estimated: 60, actual: 90 });
  expect(node.n).toBe(1);

  node = updateFactor(node, { estimated: 60, actual: 90 });
  expect(node.n).toBe(2);

  node = updateFactor(node, { estimated: 60, actual: 90 });
  expect(node.n).toBe(3);
});

test("clamp enforces lower bound of 0.25", () => {
  let node = EMPTY;
  // Ratio 0.1 (actual 6, estimated 60), should clamp to 0.25
  node = updateFactor(node, { estimated: 60, actual: 6 });
  expect(node.kObs).toBe(0.25);
});

test("clamp enforces upper bound of 4.0", () => {
  let node = EMPTY;
  // Ratio 10 (actual 600, estimated 60), should clamp to 4.0
  node = updateFactor(node, { estimated: 60, actual: 600 });
  expect(node.kObs).toBe(4.0);
});
