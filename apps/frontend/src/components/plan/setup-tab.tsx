"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RegionError } from "@/components/states/region-states";
import { PlannerSettings } from "@/components/planner-settings";
import { api, ApiError, messageForStatus } from "@/lib/api";
import { useHolidays, usePlanPackages } from "@/lib/hooks";
import { hoursBetween, startOfUTCDay } from "@/lib/pace";
import { invalidateAfterSetup } from "@/lib/plan-invalidation";
import { WEEKDAYS, type Plan, type WeeklyAvailability, type PackageRole } from "@/lib/types";
import { useOnline } from "@/hooks/use-online";
import { ExamDateEditor } from "./exam-date-editor";
import { HolidaysEditor } from "./holidays-editor";
import { HoursEditor } from "./hours-editor";
import { PackagesEditor, type PackageDraft } from "./packages-editor";
import { PriorWorkForm } from "./prior-work-form";

const hoursFmt = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const sameRoles = (a: PackageRole[], b: PackageRole[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Every input that shapes the plan, one column of sections.
 *
 * Each section saves its own edit. Drafts (hours, packages, prior work) are
 * held here until Save, and every successful save runs invalidateAfterSetup,
 * so Campaign, Calendar and Today never disagree with what was just saved.
 */
export function SetupTab({ plan }: { plan: Plan }) {
  const qc = useQueryClient();
  const online = useOnline();
  const planId = plan.id;

  const holidays = useHolidays(planId);
  const planPackages = usePlanPackages(planId);

  const [hoursDraft, setHoursDraft] = useState<WeeklyAvailability | null>(null);
  const [packagesDraft, setPackagesDraft] = useState<PackageDraft[] | null>(null);
  const [saving, setSaving] = useState<"hours" | "packages" | null>(null);

  const hours = hoursDraft ?? plan.weeklyAvailability;
  const weeklyTotal = WEEKDAYS.reduce((sum, day) => sum + (hours[day] ?? 0), 0);
  const hoursDirty = hoursDraft !== null && WEEKDAYS.some((d) => hoursDraft[d] !== plan.weeklyAvailability[d]);

  // What the hours leave before the exam, after holidays come off. The same
  // figure Pace uses, so the line and the pace sentence agree.
  const weeksLeft = useMemo(() => {
    if (!holidays.data) return null;
    const today = startOfUTCDay(new Date());
    const exam = startOfUTCDay(new Date(plan.examDate));
    const ranges = holidays.data.map((h) => ({
      start: startOfUTCDay(new Date(h.startDate)),
      end: startOfUTCDay(new Date(h.endDate)),
    }));
    return hoursBetween(hours, today, exam, ranges);
  }, [hours, plan.examDate, holidays.data]);

  const savedPackages: PackageDraft[] = (planPackages.data ?? []).map((p) => ({
    packageId: p.packageId,
    roles: p.roles,
  }));
  const packages = packagesDraft ?? savedPackages;
  const packagesDirty =
    packagesDraft !== null &&
    (packagesDraft.length !== savedPackages.length ||
      packagesDraft.some((d) => {
        const s = savedPackages.find((x) => x.packageId === d.packageId);
        return !s || !sameRoles(s.roles, d.roles);
      }));

  async function run(kind: "hours" | "packages", task: () => Promise<void>, failure: string) {
    setSaving(kind);
    try {
      await task();
      await invalidateAfterSetup(qc, planId);
    } catch (err) {
      toast.error(err instanceof ApiError ? messageForStatus(err.status) : failure);
    } finally {
      setSaving(null);
    }
  }

  function saveHours() {
    if (!hoursDraft) return;
    void run(
      "hours",
      async () => {
        await api.patch(`plans/${planId}`, { weeklyAvailability: hoursDraft });
        toast.success("Hours saved. Pace updated.");
        setHoursDraft(null);
      },
      "Failed to save hours.",
    );
  }

  function savePackages() {
    if (!packagesDraft) return;
    void run(
      "packages",
      async () => {
        const kept = new Set(packagesDraft.map((d) => d.packageId));
        for (const s of savedPackages) {
          if (!kept.has(s.packageId)) await api.del(`plans/${planId}/packages/${s.packageId}`);
        }
        for (const d of packagesDraft) {
          const s = savedPackages.find((x) => x.packageId === d.packageId);
          if (!s || !sameRoles(s.roles, d.roles)) {
            await api.post(`plans/${planId}/packages`, { packageId: d.packageId, roles: d.roles });
          }
        }
        toast.success("Packages saved.");
        setPackagesDraft(null);
        await planPackages.refetch();
      },
      "Failed to save packages.",
    );
  }

  return (
    <div className="flex flex-col">
      <Section title="Exam date">
        <ExamDateEditor plan={plan} />
      </Section>

      <Section
        title="Weekly hours"
        aside={<span className="tabular-nums text-muted-foreground text-[13px]">{weeklyTotal} h a week</span>}
      >
        <HoursEditor
          value={hours}
          disabled={saving !== null}
          onChange={(next) => setHoursDraft(next)}
        />
        <p className="text-[14px] text-muted-foreground">
          {weeksLeft === null ? (
            "Working out what is left before the exam."
          ) : (
            <>
              {weeklyTotal} hours a week leaves about{" "}
              <span className="text-foreground tabular-nums">{hoursFmt.format(weeksLeft)}</span> hours before the exam.
            </>
          )}
        </p>
        {hoursDirty ? (
          <SaveBar
            label="Save hours"
            saving={saving === "hours"}
            disabled={saving !== null && saving !== "hours"}
            onSave={saveHours}
            onCancel={() => setHoursDraft(null)}
          />
        ) : null}
      </Section>

      <Section title="Holidays">
        <HolidaysEditor planId={planId} />
      </Section>

      <Section title="Packages">
        {planPackages.isPending ? (
          <Skeleton aria-label="Loading packages" className="h-24 w-full rounded-none" />
        ) : planPackages.error && !planPackages.data ? (
          <RegionError error={planPackages.error} online={online} onRetry={() => void planPackages.refetch()} />
        ) : (
          <>
            <PackagesEditor
              selected={packages}
              disabled={saving !== null}
              onChange={(next) => setPackagesDraft(next)}
            />
            {packagesDirty ? (
              <SaveBar
                label="Save packages"
                saving={saving === "packages"}
                disabled={saving !== null && saving !== "packages"}
                onSave={savePackages}
                onCancel={() => setPackagesDraft(null)}
              />
            ) : null}
          </>
        )}
      </Section>

      {/* Owns its own heading and saves on each change, so it sits outside Section. */}
      <div className="border-border border-t py-8">
        <PlannerSettings plan={plan} onSaved={() => void invalidateAfterSetup(qc, planId)} />
      </div>

      <div className="border-border border-t py-8">
        <PriorWorkForm plan={plan} />
      </div>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = `setup-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="border-border flex flex-col gap-4 border-t py-8 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={id} className="text-[16px] font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function SaveBar({
  label,
  saving,
  disabled,
  onSave,
  onCancel,
  note,
}: {
  label: string;
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
  onCancel: () => void;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={onSave} disabled={saving || disabled}>
          {saving ? "Saving" : label}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
      {note ? <p className="text-muted-foreground text-[13px]">{note}</p> : null}
    </div>
  );
}
