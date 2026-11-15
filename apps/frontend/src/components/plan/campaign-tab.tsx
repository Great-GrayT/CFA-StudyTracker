"use client";

import { CampaignChart } from "@/components/campaign-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { OfflineLine, RegionError, regionState } from "@/components/states/region-states";
import { useCampaign } from "@/lib/hooks";
import { useOnline } from "@/hooks/use-online";

/** The whole run to the exam: the stacked chart and its projection, from the planner. */
export function CampaignTab({ planId }: { planId: string }) {
  const online = useOnline();
  const campaign = useCampaign(planId, 7);
  const state = regionState(campaign);

  if (state.loading) {
    return <Skeleton aria-label="Loading the whole run" className="h-[280px] w-full rounded-none" />;
  }
  if (state.error && !campaign.data) {
    return <RegionError error={state.error} online={online} onRetry={() => void campaign.refetch()} />;
  }
  return (
    <div className="flex flex-col gap-4">
      {!online ? <OfflineLine /> : null}
      <CampaignChart campaign={campaign.data} />
    </div>
  );
}
