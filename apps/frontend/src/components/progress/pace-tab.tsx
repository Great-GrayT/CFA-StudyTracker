"use client";

import { useProjection } from "@/lib/hooks";
import { hasAnyProgress } from "@/lib/pace-view";
import type { Plan } from "@/lib/types";
import { useRecord } from "@/components/record/record-provider";
import { OfflineLine, RegionError, regionState } from "@/components/states/region-states";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { VerdictStrip } from "@/components/pace/verdict-strip";
import { PlanTile } from "@/components/pace/plan-tile";
import { CoverageTile } from "@/components/pace/coverage-tile";
import { TrackingTile } from "@/components/pace/tracking-tile";
import { PerformanceTile } from "@/components/pace/performance-tile";
import s from "@/components/pace/pace.module.css";

/** Progress, Pace tab: a compact bento over the step engine's projection. */
export function PaceTab({ plan, ended, online }: { plan: Plan; ended: boolean; online: boolean }) {
  const q = useProjection(plan.id);
  const record = useRecord();
  const state = regionState(q);

  if (!q.data) {
    if (state.error) return <RegionError error={state.error} online={online} onRetry={() => void q.refetch()} />;
    return <PaceTabSkeleton />;
  }
  const p = q.data;

  if (p.sections.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 py-8">
        <p className="text-[14px]">Your sections appear once your level&apos;s modules load.</p>
        <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
          Load them again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {ended ? (
        <p className="text-muted-foreground text-[13px]">The exam has passed. This is where the plan ended.</p>
      ) : null}
      {!online ? <OfflineLine /> : null}
      {state.error ? <RegionError error={state.error} online={online} onRetry={() => void q.refetch()} /> : null}
      <VerdictStrip p={p} />
      {!hasAnyProgress(p) ? (
        <p className="text-muted-foreground flex flex-wrap items-center gap-3 text-[13px]">
          Nothing recorded yet. Your first record starts the done bars.
          <Button size="sm" variant="outline" onClick={() => record.open()}>
            Record a session
          </Button>
        </p>
      ) : null}
      <div className={s.bento}>
        <PlanTile p={p} className={s.plan} />
        <CoverageTile p={p} />
        <TrackingTile p={p} />
        <PerformanceTile p={p} className={s.wide} />
      </div>
    </div>
  );
}

export function PaceTabSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading pace" className="flex flex-col gap-3">
      <div className="flex gap-6">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-sm" />
        ))}
      </div>
      <div className={s.bento}>
        <Skeleton className={`${s.plan} h-[420px] rounded-lg`} />
        <Skeleton className="h-[200px] rounded-lg" />
        <Skeleton className="h-[200px] rounded-lg" />
        <Skeleton className={`${s.wide} h-[140px] rounded-lg`} />
      </div>
    </div>
  );
}
