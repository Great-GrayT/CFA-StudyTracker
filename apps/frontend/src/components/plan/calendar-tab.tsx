"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OfflineLine, RegionError, regionState } from "@/components/states/region-states";
import { usePrescription, useProjection } from "@/lib/hooks";
import { heatLevel, isMissed, monthCells, monthOf, monthPlannedMin, shiftMonth } from "@/lib/calendar";
import { kindLabel, minutesShort } from "@/lib/today";
import type { Plan, PrescribedTask, Projection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useOnline } from "@/hooks/use-online";

const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hoursFmt = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

// Shade steps of the claimed blue; the number on every day keeps it readable without colour.
const HEAT = [
  "bg-muted/40 text-muted-foreground",
  "bg-claimed/12",
  "bg-claimed/30",
  "bg-claimed/55",
];

const link = "text-claimed-ink underline underline-offset-4 focus-visible:ring-ring rounded-sm outline-hidden focus-visible:ring-2";

/**
 * Month heat calendar: shade is planned hours, a red outline marks a day
 * that was planned, has passed and was not finished. A day opens its tasks.
 */
export function CalendarTab({ plan, todayISO }: { plan: Plan; todayISO: string }) {
  const online = useOnline();
  const projection = useProjection(plan.id);
  const [month, setMonth] = useState(monthOf(todayISO));
  const [selected, setSelected] = useState(todayISO);

  const p = projection.data;
  const state = regionState(projection);
  const byDate = useMemo(() => new Map((p?.daily ?? []).map((d) => [d.date, d])), [p]);
  const cells = useMemo(() => monthCells(month), [month]);
  const maxMin = Math.max(0, ...cells.map((c) => (c ? (byDate.get(c)?.plannedMin ?? 0) : 0)));
  const holidayOn = (date: string) => (p?.holidays ?? []).some((h) => !h.cancelled && date >= h.start.slice(0, 10) && date <= h.end.slice(0, 10));
  const monthMin = p ? monthPlannedMin(p.daily, month) : 0;
  const monthExtras = p ? p.extras.filter((e) => e.date && monthOf(e.date) === month).length : 0;

  function goTo(next: string) {
    setMonth(next);
    // Keep the open day inside the month on screen.
    setSelected(next === monthOf(todayISO) ? todayISO : `${next}-01`);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="max-md:size-11" aria-label="Previous month" onClick={() => goTo(shiftMonth(month, -1))}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <h2 className="min-w-36 px-2 text-center text-[16px] font-semibold" aria-live="polite">
            {monthFmt.format(utc(`${month}-01`))}
          </h2>
          <Button variant="outline" size="icon" className="max-md:size-11" aria-label="Next month" onClick={() => goTo(shiftMonth(month, 1))}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        {month !== monthOf(todayISO) ? (
          <Button variant="outline" size="sm" className="max-md:h-11" onClick={() => { setMonth(monthOf(todayISO)); setSelected(todayISO); }}>
            This month
          </Button>
        ) : null}
      </div>

      {!online ? <OfflineLine /> : null}

      {state.loading ? (
        <Skeleton aria-label="Loading the calendar" className="h-72 w-full rounded-none" />
      ) : state.error && !p ? (
        <RegionError error={state.error} online={online} onRetry={() => void projection.refetch()} />
      ) : (
        <>
          <p className="text-muted-foreground text-[13px] tabular-nums">
            {hoursFmt.format(monthMin / 60)} h planned
            {monthExtras > 0 ? `, ${monthExtras} extra ${monthExtras === 1 ? "task" : "tasks"}` : ""}
          </p>
          <div className="grid grid-cols-7 gap-1 md:gap-1.5">
            {WEEKDAYS.map((w) => (
              <div key={w} aria-hidden="true" className="text-muted-foreground pb-1 text-center text-[12px]">
                {w}
              </div>
            ))}
            {cells.map((date, i) => {
              if (!date) return <div key={`pad-${i}`} aria-hidden="true" />;
              const d = byDate.get(date);
              const planned = d?.plannedMin ?? 0;
              const missed = d ? isMissed(d, todayISO) : false;
              const level = heatLevel(planned, maxMin);
              const isSel = date === selected;
              return (
                <button
                  key={date}
                  type="button"
                  aria-pressed={isSel}
                  aria-label={`${dayFmt.format(utc(date))}, ${planned > 0 ? `${hoursFmt.format(planned / 60)} hours planned` : "nothing planned"}${missed ? ", missed" : ""}${holidayOn(date) ? ", holiday" : ""}`}
                  onClick={() => setSelected(date)}
                  className={cn(
                    "focus-visible:ring-ring flex min-h-11 flex-col items-start justify-between rounded-sm p-1.5 text-left text-[12px] outline-hidden focus-visible:ring-2 md:min-h-16",
                    HEAT[level],
                    missed && "outline-alarm outline-2 -outline-offset-2",
                    holidayOn(date) && "border-border border border-dashed",
                    isSel && "ring-foreground ring-2",
                    date === todayISO && "font-semibold",
                  )}
                >
                  <span className="tabular-nums">{Number(date.slice(8))}</span>
                  {planned > 0 ? <span className="tabular-nums max-md:hidden">{hoursFmt.format(planned / 60)} h</span> : null}
                </button>
              );
            })}
          </div>
          <Legend />
          <DayTasks planId={plan.id} date={selected} todayISO={todayISO} projection={p} />
        </>
      )}
    </div>
  );
}

function Legend() {
  return (
    <ul className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
      <li className="flex items-center gap-1.5">
        Less
        {HEAT.map((c, i) => (
          <span key={i} aria-hidden="true" className={cn("size-3.5 rounded-sm", c.split(" ")[0])} />
        ))}
        More planned
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="outline-alarm size-3.5 rounded-sm outline-2 -outline-offset-2" />
        Missed
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="border-border size-3.5 rounded-sm border border-dashed" />
        Holiday
      </li>
    </ul>
  );
}

function DayTasks({
  planId,
  date,
  todayISO,
  projection,
}: {
  planId: string;
  date: string;
  todayISO: string;
  projection: Projection | undefined;
}) {
  const online = useOnline();
  const q = usePrescription(planId, date, date);
  const state = regionState(q);
  const day = q.data?.days[0];
  // A module's section, so a task can link to both.
  const topicOf = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const s of projection?.sections ?? []) for (const mod of s.modules) m.set(mod.readingId, { id: s.topicId, name: s.name });
    return m;
  }, [projection]);
  const heading = date === todayISO ? "Today" : dayFmt.format(utc(date));

  return (
    <section aria-labelledby="calendar-day" className="border-border flex flex-col gap-2 border-t pt-4">
      <div className="flex items-baseline justify-between gap-4">
        <h3 id="calendar-day" className="text-[16px] font-semibold">
          {heading}
        </h3>
        {day && day.totalMinutes > 0 ? (
          <span className="text-muted-foreground text-[13px] tabular-nums">{minutesShort(day.totalMinutes)}</span>
        ) : null}
      </div>
      {state.loading ? (
        <Skeleton aria-label="Loading the day" className="h-16 w-full rounded-none" />
      ) : state.error && !day ? (
        <RegionError error={state.error} online={online} onRetry={() => void q.refetch()} />
      ) : !day || day.tasks.length === 0 ? (
        <p className="text-muted-foreground text-[14px]">
          Nothing planned for this day.{" "}
          <Link href="/plan?tab=setup" className={link}>
            Change your hours
          </Link>
        </p>
      ) : (
        <ul className="border-border border-t">
          {day.tasks.map((t) => (
            <TaskLine key={t.id} task={t} date={date} todayISO={todayISO} topic={topicOf.get(t.readingIds[0] ?? "")} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskLine({
  task,
  date,
  todayISO,
  topic,
}: {
  task: PrescribedTask;
  date: string;
  todayISO: string;
  topic: { id: string; name: string } | undefined;
}) {
  const done = task.status === "done" || task.status === "completed";
  const reading = task.readingIds[0];
  const isMock = task.kind === "mock" || task.kind === "mock-review";
  return (
    <li className="border-border flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 border-b py-1.5 text-[14px]">
      <span className="text-muted-foreground w-24 shrink-0 text-[13px]">{kindLabel(task.kind)}</span>
      <span className={cn("min-w-0 flex-1 basis-48", done && "text-muted-foreground")}>
        {isMock ? (
          <Link href="/progress?tab=mocks" className={link}>
            {task.moduleTitle ?? "Mock exam"}
          </Link>
        ) : topic && reading ? (
          <>
            <Link href={`/syllabus/${topic.id}`} className={link}>
              {topic.name}
            </Link>
            {task.moduleTitle ? (
              <>
                {", "}
                <Link href={`/syllabus/${topic.id}?reading=${reading}`} className={link}>
                  {task.moduleTitle}
                </Link>
              </>
            ) : null}
          </>
        ) : (
          [task.topicName, task.moduleTitle].filter(Boolean).join(", ") || "Unassigned work"
        )}
        {task.extraReason ? <span className="text-muted-foreground"> (extra: {task.extraReason})</span> : null}
      </span>
      <span className="text-muted-foreground text-[13px] tabular-nums">
        {done ? `done ${minutesShort(task.actualMinutes ?? task.estimatedMinutes)}` : minutesShort(task.estimatedMinutes)}
      </span>
      {!done && date <= todayISO && !task.offPlan ? (
        <Link href={`/today?task=${task.id}&date=${date}`} className={cn(link, "inline-flex min-h-9 items-center max-md:min-h-11")}>
          Record
        </Link>
      ) : null}
    </li>
  );
}
