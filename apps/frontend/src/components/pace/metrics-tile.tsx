"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Projection } from "@/lib/types";
import { keyFigures, planDays, verdictLine, type PlanDay } from "@/lib/pace-view";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { BudgetBar } from "./budget-bar";
import { PlanCalendar } from "./plan-calendar";
import { PlanLedger } from "./plan-ledger";
import { PlanRibbon, type RibbonZoom } from "./plan-ribbon";
import { StepLegend } from "./plan-shared";
import { Tile } from "./tile";
import s from "./plan-metrics.module.css";

function Figures({ p }: { p: Projection }) {
  const figs = keyFigures(p);
  if (!figs.length) return null;
  return (
    <ul className={s.figs}>
      {figs.map((f) => (
        <li key={f.note} className={cn(s.fig, f.alarm && s.figAlarm)}>
          <b>{f.value}</b>
          <span>{f.note}</span>
        </li>
      ))}
    </ul>
  );
}

const ZOOMS: { value: RibbonZoom; label: string }[] = [
  { value: "all", label: "Whole plan" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
];

/** The full view: budget, then the ribbon or the calendar, then the ledgers. */
function PlanSheet({ p, days }: { p: Projection; days: PlanDay[] }) {
  const [view, setView] = useState<"ribbon" | "calendar">("ribbon");
  const [zoom, setZoom] = useState<RibbonZoom>("all");
  const verdict = verdictLine(p);
  return (
    <div className={s.pm}>
      {verdict ? <p className={s.verdict}>{verdict}</p> : null}
      <BudgetBar p={p} />
      <div className={s.tools}>
        <SegmentedControl.Root type="single" value={view} onValueChange={(v) => v && setView(v as typeof view)} aria-label="Plan view">
          <SegmentedControl.Item value="ribbon">Ribbon</SegmentedControl.Item>
          <SegmentedControl.Item value="calendar">Calendar</SegmentedControl.Item>
        </SegmentedControl.Root>
        {view === "ribbon" ? (
          <SegmentedControl.Root type="single" value={zoom} onValueChange={(v) => v && setZoom(v as RibbonZoom)} aria-label="Ribbon zoom">
            {ZOOMS.map((z) => (
              <SegmentedControl.Item key={z.value} value={z.value}>
                {z.label}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        ) : null}
        <p className={s.note}>Hover or tap a day, or focus it and use the arrow keys. Up and down move a week.</p>
      </div>
      {view === "ribbon" ? <PlanRibbon days={days} gate={p.gate} height={200} zoom={zoom} /> : <PlanCalendar days={days} />}
      <StepLegend />
      <PlanLedger p={p} />
    </div>
  );
}

/** What the plan holds against the full requirement, when the work lands, and where each topic stands. */
export function MetricsTile({ p, className }: { p: Projection; className?: string }) {
  const days = useMemo(() => planDays(p), [p]);
  if (!p.totals) return null;
  const verdict = verdictLine(p);
  return (
    <Tile
      title="Plan metrics"
      hint="What the plan requires, what is done, and what is left."
      className={className}
      expandedHint="The hour budget, every day of the plan, and each step and topic."
      expanded={
        <div className="min-h-0 flex-1 overflow-auto">
          <PlanSheet p={p} days={days} />
        </div>
      }
    >
      <div className={s.pm}>
        {verdict ? <p className={s.verdict}>{verdict}</p> : null}
        <PlanRibbon days={days} gate={p.gate} height={120} />
        <StepLegend />
        <Figures p={p} />
      </div>
    </Tile>
  );
}
