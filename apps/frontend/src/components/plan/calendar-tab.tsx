"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WeekStrip, weekDates } from "@/components/today/week-strip";
import { DayPlan } from "@/components/day-plan";
import { OfflineLine, RegionError, regionState } from "@/components/states/region-states";
import { usePrescription } from "@/lib/hooks";
import type { Plan, WeeklyAvailability } from "@/lib/types";
import { useOnline } from "@/hooks/use-online";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const rangeFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The week's plan for any week, read-only. Only the current week links on to Today, where work is recorded. */
export function CalendarTab({ plan, todayISO }: { plan: Plan; todayISO: string }) {
  const online = useOnline();
  const [anchor, setAnchor] = useState(todayISO);
  const week = useMemo(() => weekDates(anchor), [anchor]);
  const isCurrent = week.includes(todayISO);
  const [selected, setSelected] = useState(todayISO);

  const prescription = usePrescription(plan.id, week[0], week[6]);
  const state = regionState(prescription);

  // Moving weeks lands on the same day of the new week it can, so the day plan never shows a stale date.
  function goTo(nextAnchor: string) {
    const next = weekDates(nextAnchor);
    setAnchor(nextAnchor);
    setSelected(next.includes(todayISO) ? todayISO : next[0]);
  }

  const selectedDay = prescription.data?.days.find((d) => d.date === selected);
  const hours = plan.weeklyAvailability as WeeklyAvailability;
  const budget = (date: string) => {
    const key = DAY_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
    return (hours[key as keyof WeeklyAvailability] ?? 0) * 60;
  };
  const range = `${rangeFmt.format(new Date(`${week[0]}T00:00:00Z`))} to ${rangeFmt.format(new Date(`${week[6]}T00:00:00Z`))}`;
  const dayHeading = selected === todayISO ? "Today" : dayFmt.format(new Date(`${selected}T00:00:00Z`));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="max-md:size-11" aria-label="Previous week" onClick={() => goTo(shift(anchor, -7))}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button variant="outline" size="icon" className="max-md:size-11" aria-label="Next week" onClick={() => goTo(shift(anchor, 7))}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        {isCurrent ? (
          <Button asChild size="sm" className="max-md:h-11">
            <Link href="/today">Record in Today</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="max-md:h-11" onClick={() => goTo(todayISO)}>
            This week
          </Button>
        )}
      </div>

      {!online ? <OfflineLine /> : null}

      {state.loading ? (
        <Skeleton aria-label="Loading the week" className="h-16 w-full rounded-none" />
      ) : state.error && !prescription.data ? (
        <RegionError error={state.error} online={online} onRetry={() => void prescription.refetch()} />
      ) : (
        <WeekStrip
          heading={isCurrent ? "This week" : range}
          dates={week}
          days={prescription.data?.days}
          todayISO={todayISO}
          selected={selected}
          onSelect={setSelected}
          loading={false}
        />
      )}

      {!state.loading && !(state.error && !prescription.data) ? (
        <DayPlan day={selectedDay} heading={dayHeading} budgetMinutes={budget(selected)} />
      ) : null}
    </div>
  );
}
