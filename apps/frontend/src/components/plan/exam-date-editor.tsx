"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { api, ApiError, messageForStatus } from "@/lib/api";
import { invalidateAfterSetup } from "@/lib/plan-invalidation";
import type { Plan } from "@/lib/types";

// Calendar dates travel as YYYY-MM-DD and are built from local parts, so the
// picker never shifts the exam a day by the reader's time zone.
const fromISO = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

export function ExamDateEditor({ plan }: { plan: Plan }) {
  const qc = useQueryClient();
  const saved = plan.examDate.slice(0, 10);
  const [draft, setDraft] = useState<Date | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const value = draft ?? fromISO(saved);
  const dirty = draft !== undefined && format(draft, "yyyy-MM-dd") !== saved;

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await api.patch(`plans/${plan.id}`, { examDate: format(draft, "yyyy-MM-dd") });
      toast.success("Exam date saved.");
      setDraft(undefined);
      await invalidateAfterSetup(qc, plan.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? messageForStatus(err.status) : "Failed to save exam date.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-muted-foreground" id="exam-date-label">
          Exam
        </span>
        <DatePicker
          id="exam-date"
          value={value}
          onChange={(d) => setDraft(d)}
          disabled={saving}
          placeholder="Pick the exam date"
          aria-describedby="exam-date-label"
        />
      </div>

      {dirty ? (
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving" : "Save exam date"}
          </Button>
          <Button variant="outline" onClick={() => setDraft(undefined)} disabled={saving}>
            Cancel
          </Button>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[14px]">
        <dt className="text-muted-foreground">Level</dt>
        <dd>Level {plan.levelId}</dd>
        <dt className="text-muted-foreground">Started</dt>
        <dd className="tabular-nums">{fromISO(plan.startDate).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</dd>
      </dl>
    </div>
  );
}
