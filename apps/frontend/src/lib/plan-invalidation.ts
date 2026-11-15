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
  ]);
}
