"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { OfflineLine } from "@/components/states/region-states";
import { regionState } from "@/components/states/region-states";
import { PriorWork, type Declaration, type PriorWorkData } from "@/components/prior-work";
import { api, ApiError, messageForStatus } from "@/lib/api";
import { useCurriculum } from "@/lib/hooks";
import { invalidateAfterSetup } from "@/lib/plan-invalidation";
import { useOnline } from "@/hooks/use-online";
import type { Plan } from "@/lib/types";

/**
 * PriorWork wired to the plan: loads the saved answers, holds the draft, and
 * saves it with a replan. Settings and Plan Setup both use this; onboarding
 * uses the controlled PriorWork directly.
 */
export function PriorWorkForm({ plan, onSaved }: { plan: Plan; onSaved?: () => void }) {
  const qc = useQueryClient();
  const online = useOnline();
  const curriculum = useCurriculum(plan.levelId);
  const saved = useQuery({
    queryKey: ["prior-work", plan.id],
    queryFn: () => api.get<PriorWorkData>(`plans/${plan.id}/prior-work`),
  });
  const [draft, setDraft] = useState<Declaration[] | null>(null);
  const [saving, setSaving] = useState(false);

  const states = [curriculum, saved].map(regionState);
  const value = draft ?? saved.data?.declarations ?? [];

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await api.post(`plans/${plan.id}/prior-work`, { declarations: draft });
      toast.success(
        draft.length === 0
          ? "Cleared what you had already studied."
          : "Saved. The days ahead have been replanned around it.",
      );
      setDraft(null);
      await saved.refetch();
      await invalidateAfterSetup(qc, plan.id);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? messageForStatus(err.status) : "Could not save that. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!online ? <OfflineLine /> : null}
      <PriorWork
        topics={curriculum.data?.topics ?? []}
        sources={saved.data?.sources}
        value={value}
        disabled={saving}
        loading={states.some((s) => s.loading)}
        failed={states.some((s) => s.error) && !saved.data}
        onChange={setDraft}
      />
      {draft !== null ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving" : "Save and replan"}
            </Button>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
          </div>
          <p className="text-muted-foreground text-[13px]">
            This replaces whatever you declared before, rather than adding to it. Work you have logged
            inside the app is never touched.
          </p>
        </div>
      ) : null}
    </div>
  );
}
