import type { QueryClient } from "@tanstack/react-query";
import { keys } from "./hooks";

/**
 * Every query a Setup save can change.
 *
 * Prefix-matched on the plan id, so each campaign period and each prescription
 * week is refetched, not just the one on screen. Other plans' keys are left
 * alone, and so is the packages catalogue, which a setup save does not change.
 */
export async function invalidateAfterSetup(qc: QueryClient, planId: string): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: keys.plan }),
    qc.invalidateQueries({ queryKey: ["campaign", planId] }),
    qc.invalidateQueries({ queryKey: ["prescription", planId] }),
    invalidateProjection(qc, planId),
  ]);
}

/** Every record, declaration and settings change moves the projection. */
export function invalidateProjection(qc: QueryClient, planId: string): Promise<void> {
  return qc.invalidateQueries({ queryKey: keys.projection(planId) });
}

/**
 * Everything an edit or delete of a record can move: the history itself, the
 * projection and prescription it replans, and the logs and mocks behind them.
 */
export function invalidateAfterEdit(qc: QueryClient, planId: string): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: keys.history(planId) }),
    qc.invalidateQueries({ queryKey: keys.projection(planId) }),
    qc.invalidateQueries({ queryKey: ["prescription", planId] }),
    qc.invalidateQueries({ queryKey: ["campaign", planId] }),
    qc.invalidateQueries({ queryKey: keys.logs(planId) }),
    qc.invalidateQueries({ queryKey: keys.progress(planId) }),
    qc.invalidateQueries({ queryKey: keys.mocks(planId) }),
    qc.invalidateQueries({ queryKey: keys.declarations(planId) }),
    qc.invalidateQueries({ queryKey: keys.coverage(planId) }),
  ]);
}
