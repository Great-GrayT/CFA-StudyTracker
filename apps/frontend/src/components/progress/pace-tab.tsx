"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { flattenCurriculum, useCurriculum, useHolidays, useLogs } from "@/lib/hooks";
import {
  buildSeries,
  missedDays,
  readPace,
  rollupSeries,
  sliceSeries,
  startOfUTCDay,
  type PaceRange,
} from "@/lib/pace";
import { usePaged } from "@/lib/paging";
import type { Plan } from "@/lib/types";
import { useRecord } from "@/components/record/record-provider";
import { OfflineLine, RegionError, regionState } from "@/components/states/region-states";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PaceChart } from "./pace-chart";
import { Pager } from "./pager";

const hours = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const plural = new Intl.PluralRules("en");
const outcomeWord = (n: number) => (plural.select(n) === "one" ? "outcome" : "outcomes");
const weekFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const RANGES: { value: PaceRange; label: string }[] = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All" },
];

// Shared by both toggle groups: a hairline segmented look at 4px, 44px on touch.
const toggleItem =
  "h-8 px-3 text-[13px] max-md:h-11 data-[state=on]:bg-accent data-[state=on]:font-semibold data-[state=on]:text-foreground";

export function PaceTab({ plan, ended, online }: { plan: Plan; ended: boolean; online: boolean }) {
  const [range, setRange] = useState<PaceRange>("all");
  const [by, setBy] = useState<"week" | "month">("week");
  const record = useRecord();

  const curriculum = useCurriculum(plan.levelId);
  const logs = useLogs(plan.id);
  const holidays = useHolidays(plan.id);

  const totalOutcomes = useMemo(() => flattenCurriculum(curriculum.data).length, [curriculum.data]);
  const inputs = useMemo(
    () =>
      logs.data && holidays.data && totalOutcomes > 0
        ? { plan, logs: logs.data, holidays: holidays.data, totalOutcomes }
        : null,
    [plan, logs.data, holidays.data, totalOutcomes],
  );

  const full = useMemo(() => (inputs ? buildSeries(inputs) : []), [inputs]);
  const series = useMemo(() => sliceSeries(full, range), [full, range]);
  const pace = useMemo(() => (inputs ? readPace(inputs) : null), [inputs]);
  const missed = useMemo(() => {
    if (!inputs || series.length === 0) return [];
    return missedDays({ ...inputs, from: new Date(`${series[0].date}T00:00:00Z`), to: startOfUTCDay(new Date()) });
  }, [inputs, series]);
  // Rolled up over the whole campaign, then cut to the range, so the first
  // row's "new" counts that period and not everything before it.
  const rows = useMemo(() => {
    const start = series[0]?.date ?? "";
    return rollupSeries(full, by).filter((r) => r.end >= start);
  }, [full, by, series]);
  // Thirty-odd weekly rows would push the page off a phone screen.
  const paged = usePaged(rows, 8);

  const states = [curriculum, logs, holidays].map(regionState);
  const failed = states.find((s) => s.error)?.error;
  const retry = () => {
    if (curriculum.isError) void curriculum.refetch();
    if (logs.isError) void logs.refetch();
    if (holidays.isError) void holidays.refetch();
  };

  if (!inputs) {
    if (failed) return <RegionError error={failed} online={online} onRetry={retry} />;
    if (curriculum.data && totalOutcomes === 0) {
      return (
        <EmptyState body="Your pace appears once your level's outcomes load.">
          <Button variant="outline" size="sm" onClick={() => void curriculum.refetch()}>
            Load them again
          </Button>
        </EmptyState>
      );
    }
    return <PaceTabSkeleton />;
  }

  // Before the plan's first day there is nothing to draw yet.
  if (series.length === 0) {
    return (
      <EmptyState body="Your pace line starts on your plan's first day. Record a session and it begins there.">
        <Button size="sm" onClick={() => record.open()}>
          Record a session
        </Button>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="pace-sentence" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <PaceSentence pace={pace!} ended={ended} />
            <p className="text-muted-foreground text-[13px] tabular-nums">
              {pace!.covered} of {pace!.totalOutcomes} outcomes covered
              {ended ? "" : `, ${pace!.target} due by yesterday`}
            </p>
            {!online ? <OfflineLine /> : null}
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            value={range}
            onValueChange={(v) => v && setRange(v as PaceRange)}
            aria-label="Time range"
          >
            {RANGES.map((r) => (
              <ToggleGroupItem key={r.value} value={r.value} className={toggleItem}>
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {failed ? <RegionError error={failed} online={online} onRetry={retry} /> : null}
        <PaceChart
          series={series}
          missed={missed}
          holidays={holidays.data ?? []}
          totalOutcomes={totalOutcomes}
        />
        {logs.data!.length === 0 ? (
          <p className="text-muted-foreground flex flex-wrap items-center gap-3 text-[13px]">
            Nothing recorded yet. Your first record starts the covered line.
            <Button size="sm" variant="outline" onClick={() => record.open()}>
              Record a session
            </Button>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="rollup-heading" className="border-border flex flex-col gap-3 border-t pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="rollup-heading" className="text-[16px] font-semibold">
            By {by}
          </h2>
          <ToggleGroup
            type="single"
            variant="outline"
            value={by}
            onValueChange={(v) => v && setBy(v as "week" | "month")}
            aria-label="Break down by"
          >
            <ToggleGroupItem value="week" className={toggleItem}>
              Week
            </ToggleGroupItem>
            <ToggleGroupItem value="month" className={toggleItem}>
              Month
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <Table className="text-[13px] tabular-nums">
          <caption className="sr-only">
            Outcomes covered against target at the end of each {by}, newest first
          </caption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-9 px-0 text-[12px]">{by === "week" ? "Week of" : "Month"}</TableHead>
              <TableHead className="h-9 text-right text-[12px]">New</TableHead>
              <TableHead className="h-9 text-right text-[12px]">Covered</TableHead>
              <TableHead className="h-9 text-right text-[12px] max-sm:hidden">Target</TableHead>
              <TableHead className="h-9 px-0 text-right text-[12px]">Ahead or behind</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.slice.map((r) => (
              <TableRow key={r.key} className="h-9 hover:bg-transparent max-md:h-11">
                <TableHead scope="row" className="h-auto px-0 font-normal text-foreground">
                  {by === "week"
                    ? weekFmt.format(new Date(`${r.key}T00:00:00Z`))
                    : monthFmt.format(new Date(`${r.key}-01T00:00:00Z`))}
                </TableHead>
                <TableCell className="text-right">{r.added}</TableCell>
                <TableCell className="text-right">{r.covered}</TableCell>
                <TableCell className="text-right max-sm:hidden">{r.target}</TableCell>
                <TableCell
                  className={cn("px-0 text-right", r.delta > 0 && "text-strong", r.delta < 0 && "text-alarm-ink")}
                >
                  {r.delta === 0 ? "On pace" : `${r.delta > 0 ? "+" : "−"}${Math.abs(r.delta)}`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager paged={paged} label={by === "week" ? "Weeks" : "Months"} />
      </section>
    </div>
  );
}

function PaceSentence({ pace, ended }: { pace: NonNullable<ReturnType<typeof readPace>>; ended: boolean }) {
  // The coach's one-sentence readout, so it is set in Newsreader.
  const cls = "font-prose text-[20px] leading-snug text-balance md:text-[26px]";
  if (ended) {
    return (
      <p id="pace-sentence" className={cls}>
        Your campaign closed with {pace.covered} of {pace.totalOutcomes} outcomes covered.
      </p>
    );
  }
  if (pace.delta === 0) {
    return (
      <p id="pace-sentence" className={cls}>
        You are exactly on pace.
      </p>
    );
  }
  const n = Math.abs(pace.delta);
  return (
    <p id="pace-sentence" className={cls}>
      <span className={cn("tabular-nums", pace.delta < 0 ? "text-alarm-ink" : "text-strong")}>
        {n} {outcomeWord(n)} {pace.delta < 0 ? "behind" : "ahead"}
      </span>
      {pace.delta < 0 ? `, about ${hours.format(pace.hoursBehind)} hours of work.` : "."}
    </p>
  );
}

function EmptyState({ body, children }: { body: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-8">
      <p className="text-[14px]">{body}</p>
      {children}
    </div>
  );
}

export function PaceTabSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading pace" className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-80 max-w-full rounded-sm" />
            <Skeleton className="h-4 w-56 rounded-sm" />
          </div>
          <Skeleton className="h-8 w-52 rounded-md" />
        </div>
        <Skeleton className="h-[200px] w-full rounded-none md:h-[240px]" />
        <Skeleton className="h-4 w-72 max-w-full rounded-sm" />
      </div>
      <div className="border-border flex flex-col gap-2 border-t pt-6">
        <Skeleton className="h-5 w-24 rounded-sm" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-full rounded-none" />
        ))}
      </div>
    </div>
  );
}
