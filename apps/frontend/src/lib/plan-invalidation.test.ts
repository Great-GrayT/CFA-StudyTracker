import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { keys } from "./hooks";
import { invalidateAfterSetup, invalidateProjection } from "./plan-invalidation";

const planId = "plan-1";

function seed(qc: QueryClient, key: readonly unknown[]) {
  qc.setQueryData(key, { seeded: true });
}

describe("invalidateAfterSetup", () => {
  it("invalidates the plan, its campaign and prescriptions, and leaves unrelated keys alone", async () => {
    const qc = new QueryClient();
    const campaign = keys.campaign(planId, 7);
    const weekA = keys.prescription(planId, "2026-11-09", "2026-11-15");
    const weekB = keys.prescription(planId, "2026-11-16", "2026-11-22");
    const packages = keys.packages;

    for (const key of [keys.plan, campaign, weekA, weekB, packages]) seed(qc, key);

    await invalidateAfterSetup(qc, planId);

    expect(qc.getQueryState(keys.plan)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(campaign)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(weekA)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(weekB)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(packages)?.isInvalidated).toBe(false);
  });

  it("does not touch another plan's campaign or prescriptions", async () => {
    const qc = new QueryClient();
    const otherCampaign = keys.campaign("plan-2", 7);
    const otherWeek = keys.prescription("plan-2", "2026-11-09", "2026-11-15");
    seed(qc, otherCampaign);
    seed(qc, otherWeek);

    await invalidateAfterSetup(qc, planId);

    expect(qc.getQueryState(otherCampaign)?.isInvalidated).toBe(false);
    expect(qc.getQueryState(otherWeek)?.isInvalidated).toBe(false);
  });
});

describe("projection invalidation", () => {
  it("a setup save invalidates the projection of that plan only", async () => {
    const qc = new QueryClient();
    seed(qc, keys.projection(planId));
    seed(qc, keys.projection("plan-2"));
    await invalidateAfterSetup(qc, planId);
    expect(qc.getQueryState(keys.projection(planId))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.projection("plan-2"))?.isInvalidated).toBe(false);
  });

  it("invalidateProjection touches the projection and nothing else", async () => {
    const qc = new QueryClient();
    seed(qc, keys.projection(planId));
    seed(qc, keys.packages);
    await invalidateProjection(qc, planId);
    expect(qc.getQueryState(keys.projection(planId))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.packages)?.isInvalidated).toBe(false);
  });
});
