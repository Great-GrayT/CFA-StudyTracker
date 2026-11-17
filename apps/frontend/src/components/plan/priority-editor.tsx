"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { RegionError, regionState } from "@/components/states/region-states";
import { ApiError } from "@/lib/api";
import { usePatchPlanSettings, usePlannerState } from "@/lib/hooks";
import {
  DEFAULT_PRIORITY,
  PACKAGE_NAMES,
  PRIORITY_STEPS,
  hoursError,
  movePackage,
  priorityEqual,
  withDefaults,
  type Priority,
} from "@/lib/priority";
import { useOnline } from "@/hooks/use-online";

const nameOf = (slug: string) => PACKAGE_NAMES[slug] ?? slug;

/**
 * Which package leads each step, and how long the CFA LES reading takes.
 * Up and down buttons reorder, so it works by keyboard and on a phone.
 * Only packages on the plan take part; a package that is not simply skips.
 */
export function PriorityEditor({ planId }: { planId: string }) {
  const online = useOnline();
  const planner = usePlannerState(planId);
  const patch = usePatchPlanSettings(planId);
  const state = regionState(planner);

  const [draft, setDraft] = useState<Priority | null>(null);
  const [hours, setHours] = useState<string | null>(null);
  const [said, setSaid] = useState("");

  if (state.loading) return <Skeleton aria-label="Loading package priority" className="h-40 w-full rounded-none" />;
  if (state.error && !planner.data) {
    return <RegionError error={state.error} online={online} onRetry={() => void planner.refetch()} />;
  }

  const saved = withDefaults(planner.data?.stepPriority);
  const value = draft ?? saved;
  const savedHours = String(planner.data?.lesReadingHours ?? 120);
  const hoursValue = hours ?? savedHours;
  const hoursMsg = hours !== null ? hoursError(hours) : null;
  const dirty = (draft !== null && !priorityEqual(draft, saved)) || (hours !== null && hours !== savedHours);

  function move(step: string, i: number, by: -1 | 1) {
    const list = movePackage(value[step]!, i, by);
    setDraft({ ...value, [step]: list });
    setSaid(`${nameOf(list[i + by] ?? list[i]!)} is now number ${i + by + 1} in step ${step === "5" ? "5, mocks" : step}.`);
  }

  function reset() {
    setDraft(null);
    setHours(null);
    setSaid("");
  }

  function save() {
    if (hoursMsg) return;
    const body: { stepPriority?: Priority; lesReadingHours?: number } = {};
    if (draft && !priorityEqual(draft, saved)) body.stepPriority = draft;
    if (hours !== null && hours !== savedHours) body.lesReadingHours = Number(hours);
    patch.mutate(body, {
      onSuccess: () => {
        toast.success("Priority saved. The days ahead are replanned.");
        reset();
      },
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save that. Try again."),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground max-w-prose text-[14px]">
        For each step, the plan uses the first package on your plan that covers it. Move a package up to prefer it.
      </p>

      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {PRIORITY_STEPS.map(({ step, label }) => (
          <fieldset key={step} className="min-w-0">
            <legend className="mb-1 text-[13px] font-medium">{label}</legend>
            <ol className="border-border border-t">
              {value[step]!.map((slug, i, list) => (
                <li key={slug} className="border-border flex min-h-11 items-center gap-2 border-b md:min-h-9">
                  <span className="text-muted-foreground w-5 text-[13px] tabular-nums" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px]">{nameOf(slug)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-sm max-md:size-11"
                    disabled={i === 0 || patch.isPending}
                    aria-label={`Move ${nameOf(slug)} up in ${label.toLowerCase()}`}
                    onClick={() => move(step, i, -1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-sm max-md:size-11"
                    disabled={i === list.length - 1 || patch.isPending}
                    aria-label={`Move ${nameOf(slug)} down in ${label.toLowerCase()}`}
                    onClick={() => move(step, i, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ol>
          </fieldset>
        ))}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>

      <div className="grid max-w-xs gap-1.5">
        <Label htmlFor="les-hours" className="text-[13px]">
          CFA LES reading hours
        </Label>
        <Input
          id="les-hours"
          type="number"
          inputMode="numeric"
          min={50}
          max={400}
          className="w-28 tabular-nums max-md:h-11"
          value={hoursValue}
          aria-invalid={hoursMsg !== null}
          aria-describedby="les-hours-note"
          onChange={(e) => setHours(e.target.value)}
        />
        <p id="les-hours-note" className={hoursMsg ? "text-alarm-ink text-[13px]" : "text-muted-foreground text-[13px]"}>
          {hoursMsg ?? "Total time to read the LES notes for the whole level. Used when LES leads a step."}
        </p>
      </div>

      {dirty ? (
        <div className="flex flex-wrap gap-2">
          <Button className="max-md:h-11" onClick={save} disabled={patch.isPending || hoursMsg !== null}>
            {patch.isPending ? "Saving" : "Save priority"}
          </Button>
          <Button variant="outline" className="max-md:h-11" onClick={reset} disabled={patch.isPending}>
            Cancel
          </Button>
        </div>
      ) : priorityEqual(saved, DEFAULT_PRIORITY) ? null : (
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="max-md:h-11"
            disabled={patch.isPending}
            onClick={() => patch.mutate({ stepPriority: DEFAULT_PRIORITY }, { onSuccess: () => toast.success("Priority reset.") })}
          >
            Reset to default order
          </Button>
        </div>
      )}
    </div>
  );
}
