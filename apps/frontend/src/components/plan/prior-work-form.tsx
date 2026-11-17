"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { OfflineLine, regionState } from "@/components/states/region-states";
import { StartingPoint } from "@/components/plan/starting-point";
import { ApiError } from "@/lib/api";
import { useCurriculum, useDeclarations, useDeclare, useRemoveDeclaration } from "@/lib/hooks";
import { itemsError } from "@/lib/starting-point";
import { useOnline } from "@/hooks/use-online";
import type { DeclarationItem, Plan } from "@/lib/types";

/**
 * StartingPoint wired to the plan: shows what is already stated, collects new
 * steps, and saves them with a replan. A stored step can be
 * removed, which the server refuses while a later step depends on it.
 */
export function PriorWorkForm({ plan, onSaved }: { plan: Plan; onSaved?: () => void }) {
  const online = useOnline();
  const curriculum = useCurriculum(plan.levelId);
  const stored = useDeclarations(plan.id);
  const declare = useDeclare(plan.id);
  const remove = useRemoveDeclaration(plan.id);
  const [draft, setDraft] = useState<DeclarationItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const states = [curriculum, stored].map(regionState);
  const msg = itemsError(draft);

  async function removeStored(item: DeclarationItem) {
    setError(null);
    try {
      await remove.mutateAsync({ readingId: item.readingId, step: item.step });
      toast.success("Removed. The days ahead have been replanned.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove that. Try again.");
    }
  }

  async function save() {
    if (draft.length === 0 || msg) return;
    setError(null);
    try {
      await declare.mutateAsync(draft);
      toast.success("Saved. The days ahead have been replanned around it.");
      setDraft([]);
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!online ? <OfflineLine /> : null}
      <StartingPoint
        topics={curriculum.data?.topics ?? []}
        stored={stored.data ?? []}
        value={draft}
        disabled={declare.isPending || remove.isPending}
        onRemove={online ? removeStored : undefined}
        loading={states.some((s) => s.loading)}
        failed={states.some((s) => s.error) && !(curriculum.data && stored.data)}
        onChange={setDraft}
      />
      {error ? (
        <p className="text-alarm-ink text-[13px]" role="alert">
          {error}
        </p>
      ) : null}
      {draft.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button className="max-md:h-11" onClick={save} disabled={declare.isPending || msg !== null || !online}>
            {declare.isPending ? "Saving" : "Save and replan"}
          </Button>
          <Button variant="outline" className="max-md:h-11" onClick={() => setDraft([])} disabled={declare.isPending}>
            Cancel
          </Button>
        </div>
      ) : null}
      <p className="text-muted-foreground text-[13px]">
        Work you have recorded in the app is never touched.
      </p>
    </div>
  );
}
