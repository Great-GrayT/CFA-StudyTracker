"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePatchPlanSettings, usePlannerState, useProjection } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { fitNotes, fitState } from "@/lib/fit";
import { cn } from "@/lib/utils";

const focus = "focus-visible:ring-ring rounded-sm outline-hidden focus-visible:ring-2";

/**
 * Whether the setup can reach a pass. While it cannot and the candidate has
 * not agreed, a warning with two ways out; after they agree, a quiet badge
 * that keeps the fact one tap from Pace.
 */
export function FitBanner({ planId, className }: { planId: string | undefined; className?: string }) {
  const projection = useProjection(planId);
  const planner = usePlannerState(planId);
  const patch = usePatchPlanSettings(planId);

  const p = projection.data;
  if (!p || !planner.data) return null;
  const state = fitState(p.fit, planner.data.belowPassAccepted);
  if (state === "ok") return null;
  const notes = fitNotes(p.fit, p.holidays);

  if (state === "below-pass") {
    return (
      <p className={cn("text-[13px]", className)}>
        <Link
          href="/progress?tab=pace"
          className={cn(
            focus,
            "text-alarm-ink inline-flex min-h-9 items-center gap-1.5 font-medium underline-offset-4 hover:underline max-md:min-h-11",
          )}
        >
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          Below-pass plan
        </Link>
      </p>
    );
  }

  function accept() {
    patch.mutate(
      { belowPassAccepted: true },
      {
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save that. Try again."),
      },
    );
  }

  return (
    <section aria-label="Plan fit" className={cn("border-border flex flex-col gap-2 border-y py-3", className)}>
      <p className="text-alarm-ink flex items-start gap-1.5 text-[14px] font-medium" role="alert">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Your setup cannot fit a passing plan before the exam.
      </p>
      {notes.length > 0 ? (
        <ul className="text-muted-foreground text-[13px] md:pl-[22px]">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm" className="max-md:h-11">
          <Link href="/plan?tab=setup">Change setup</Link>
        </Button>
        <Button size="sm" className="max-md:h-11" disabled={patch.isPending} onClick={accept}>
          {patch.isPending ? "Saving" : "Continue with the best plan"}
        </Button>
      </div>
    </section>
  );
}
