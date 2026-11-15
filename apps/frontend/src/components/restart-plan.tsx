"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Starting the plan over, from Settings.
//
// Collapsed, like Delete account: it retires the schedule the candidate is
// following, so it takes a deliberate second click. It is not destructive,
// though. The old plan is retired, not deleted, so one confirmation is enough
// and no typed phrase is asked for.

// Must match the onboarding page's key, so setup opens at step one rather than
// resuming an earlier draft.
const DRAFT_KEY = "cfa-onboarding-draft";

export function RestartPlan({ planId }: { planId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestart() {
    setPending(true);
    setError(null);
    try {
      await api.post(`plans/${planId}/restart`, {});
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // Storage blocked: setup just resumes the old draft, which is harmless.
      }
      // Every cached query belongs to the retired plan.
      queryClient.clear();
      router.replace("/onboarding");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Your plan was not restarted. Nothing changed.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        Set up your level, exam date, hours and packages again from the first step, as if you had
        just signed up.
      </p>

      <Collapsible
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setError(null);
        }}
      >
        <CollapsibleTrigger asChild>
          <Button variant="outline" aria-expanded={open}>
            Start over
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="mt-4 flex max-w-md flex-col gap-4">
          <ul className="text-[14px] leading-relaxed list-disc pl-5">
            <li>Your current schedule stops and a new one is built from your answers.</li>
            <li>
              Work you logged stays saved and in your exports, but the new plan does not count it.
              Tell setup what you have already studied and it will.
            </li>
            <li>Your packages stay as they are.</li>
          </ul>

          <div>
            <Button onClick={handleRestart} disabled={pending}>
              {pending ? "Starting over" : "Start over now"}
            </Button>
          </div>

          {error && (
            <p role="alert" className="text-alarm-ink text-[13px]">
              {error}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
